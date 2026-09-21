// Olivia memory pipeline — Phase 1 service layer.
//
// Responsibilities
//   1. Lazily create / read `ConversationCursor` rows.
//   2. Load a bounded window of recent `Message` rows for OpenAI input,
//      with a "pin the latest layering table" rule so the FE auto-insert
//      logic keeps working even when the table message scrolls out of the
//      window.
//   3. Compress older messages into a rolling summary using the cheap
//      `OLIVIA_MEMORY_MODEL`, scheduled fire-and-forget after the user-
//      facing stream completes.
//   4. Record per-turn token / cost usage onto the cursor and provide
//      helpers to mark / invalidate the OpenAI `previous_response_id`
//      chain.
//
// All exported functions are safe to call without the new memory feature
// flag — they are pure DB / OpenAI side-effects that no other code path
// depends on yet. The legacy "send full history" flow continues to work
// when these are never called.

import OpenAI from "openai";
import https from "https";
import ConversationCursor from "../models/conversationCursorModel.js";
import Message from "../models/messageModel.js";
import { OLIVIA_MEMORY_MODEL } from "../constants/models.js";
import { isEllisThreadMessageForModel } from "../constants/ellisUiMessages.js";
import {
  OLIVIA_CHAIN_MAX_TURNS,
  OLIVIA_CHAIN_MAX_INPUT_TOKENS,
  OLIVIA_SKIP_MEMORY_BLOCK_ON_CHAIN,
} from "../constants/oliviaMemory.js";
import {
  isDashboardStoryBibleArtifact,
  DASHBOARD_ARTIFACT_KIND_STORY_BIBLE,
} from "../constants/dashboardChatArtifacts.js";
import { logApiUsageRaw, estimateCost } from "../utils/logApiUsage.js";
import { hasDetectedNewScenesTableRow } from "../utils/oliviaLayeringParse.js";

// Threshold of uncompressed messages past `summarizedThroughMessageId`
// before the post-stream hook will fire a new compression run. Keeps the
// compressor from running on every turn for short threads.
const COMPRESSION_TRIGGER_COUNT = 10;

// Maximum age (days) for an OpenAI response id before we proactively
// skip it instead of round-tripping a 4xx. OpenAI documents ~30 days of
// retention; we pick something inside that window so we never hit it.
const RESPONSE_ID_MAX_AGE_DAYS = 25;

// Default window size used by `loadWindowedHistory` when the cursor has
// no override set. Also mirrored as the schema default on the model.
const DEFAULT_RECENT_WINDOW = 10;

// Regex used by the "pin the latest layering table" rule. Matches the
// markdown header row produced by `buildFifteenSceneTable` in the
// controller. The FE looks for these tables to drive auto-insert UI.
const LAYERING_TABLE_HEADER_RE = /\|\s*Scene\s*#\s*\|/i;

/** Pin only Phase-1 tables with NEW Scene rows — not the 15-spine recap. */
const isLayeringTablePinContent = (content) =>
  typeof content === "string" && hasDetectedNewScenesTableRow(content);

/** Max extra rows prepended outside the trailing window (layering + kit + bible). */
const MAX_COLD_START_PINS = 3;

// ---------------------------------------------------------------------------
// OpenAI client helpers
// ---------------------------------------------------------------------------

const getHttpsAgent = () => {
  const isProduction = process.env.NODE_ENV === "production";
  let rejectUnauthorized;
  if (process.env.REJECT_UNAUTHORIZED !== undefined) {
    rejectUnauthorized = process.env.REJECT_UNAUTHORIZED !== "false";
  } else {
    rejectUnauthorized = isProduction;
  }
  return new https.Agent({ rejectUnauthorized });
};

const getOpenAIClient = (apiKey) => {
  const agent = getHttpsAgent();
  return new OpenAI({ apiKey, httpAgent: agent, httpsAgent: agent });
};

// ---------------------------------------------------------------------------
// Cursor lookup / creation
// ---------------------------------------------------------------------------

/**
 * Return the cursor for a thread, creating it on the fly if missing.
 * Idempotent and safe under concurrent calls: uses `findOneAndUpdate`
 * with `upsert: true` so two simultaneous first-turn requests for the
 * same thread converge on a single row.
 */
export const getOrCreateCursor = async (
  threadId,
  novelId,
  userId,
  options = {}
) => {
  if (!threadId) throw new Error("getOrCreateCursor: threadId is required");

  const setOnInsert = {
    threadId,
    novelId: novelId || null,
    userId,
  };
  if (options.recentWindowSize != null) {
    setOnInsert.recentWindowSize = options.recentWindowSize;
  }

  return ConversationCursor.findOneAndUpdate(
    { threadId },
    { $setOnInsert: setOnInsert },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// ---------------------------------------------------------------------------
// Windowed history loader
// ---------------------------------------------------------------------------

/**
 * Filter mirroring the rule applied by `responsesApiService` — never
 * send UI-only welcome / full-review rows to the model. Ellis insert-confirms
 * stay in history so a "yes" after the next-chapter cue has conversation context.
 */
const isModelEligible = (msg) => isEllisThreadMessageForModel(msg);

/**
 * Load the trailing `windowSize` messages eligible for OpenAI input.
 * Always returns the messages in chronological order.
 *
 * Pin rule: if the most recent assistant message containing a markdown
 * layering table (`| Scene # |` header) falls *outside* the window, it
 * is prepended verbatim so the model continues to see the table the
 * writer is currently iterating on. Without this pin, long sessions
 * regress when the user references "the table above".
 *
 * Returns an array of plain message docs (`.lean()`-style) with
 * `_id`, `role`, `content`, `metadata`, `attachments`, `timestamp`,
 * `fileUrl/fileKey/fileType/fileName`, `cachedContentParts` fields
 * preserved so the existing `buildMessageContent` helper still works.
 */
export const loadWindowedHistory = async (
  threadId,
  windowSize = DEFAULT_RECENT_WINDOW
) => {
  if (!threadId) return [];

  // 1. Pull the trailing window plus a small overhead to absorb
  //    excluded UI messages without dropping below the requested count.
  const overhead = Math.max(5, Math.floor(windowSize / 2));
  const recent = await Message.find({ threadId })
    .sort({ timestamp: -1, _id: -1 })
    .limit(windowSize + overhead)
    .lean();

  // 2. Filter UI-only rows AND restore chronological order.
  const ordered = recent.filter(isModelEligible).reverse();
  const window = ordered.slice(-windowSize);

  // 3. Pin critical messages that fell outside the window (bounded).
  const windowIds = new Set(window.map((m) => String(m._id)));
  const pinCandidates = [];

  const containsTable = (msg) =>
    msg.role === "assistant" && isLayeringTablePinContent(msg.content);

  if (!window.some(containsTable)) {
    const tableCandidates = await Message.find({
      threadId,
      role: "assistant",
      content: { $regex: LAYERING_TABLE_HEADER_RE },
      metadata: { $not: { $elemMatch: { excludeFromModelInput: true } } },
    })
      .sort({ timestamp: -1, _id: -1 })
      .limit(20)
      .lean();
    const layeringPin = tableCandidates.find(
      (m) =>
        isLayeringTablePinContent(m.content) &&
        !m.metadata?.excludeFromModelInput
    );
    if (layeringPin && !windowIds.has(String(layeringPin._id))) {
      pinCandidates.push(layeringPin);
    }
  }

  const starterKitInWindow = window.some((m) => m.metadata?.isStarterKit);
  if (!starterKitInWindow) {
    const starterKitPin = await Message.findOne({
      threadId,
      "metadata.isStarterKit": true,
      metadata: { $not: { $elemMatch: { excludeFromModelInput: true } } },
    })
      .sort({ timestamp: -1, _id: -1 })
      .lean();
    if (
      starterKitPin &&
      !windowIds.has(String(starterKitPin._id)) &&
      !starterKitPin.metadata?.excludeFromModelInput
    ) {
      pinCandidates.push(starterKitPin);
    }
  }

  const storyBibleInWindow = window.some(
    (m) =>
      m.metadata?.kind === DASHBOARD_ARTIFACT_KIND_STORY_BIBLE ||
      (m.role === "assistant" && isDashboardStoryBibleArtifact(m.content))
  );
  if (!storyBibleInWindow) {
    const taggedBiblePin = await Message.findOne({
      threadId,
      role: "assistant",
      "metadata.kind": DASHBOARD_ARTIFACT_KIND_STORY_BIBLE,
      metadata: { $not: { $elemMatch: { excludeFromModelInput: true } } },
    })
      .sort({ timestamp: -1, _id: -1 })
      .lean();

    let biblePin = taggedBiblePin;
    if (!biblePin) {
      const recentAssistant = await Message.find({
        threadId,
        role: "assistant",
        metadata: { $not: { $elemMatch: { excludeFromModelInput: true } } },
      })
        .sort({ timestamp: -1, _id: -1 })
        .limit(40)
        .lean();
      biblePin = recentAssistant.find((m) => isDashboardStoryBibleArtifact(m.content));
    }

    if (
      biblePin &&
      !windowIds.has(String(biblePin._id)) &&
      !biblePin.metadata?.excludeFromModelInput
    ) {
      pinCandidates.push(biblePin);
    }
  }

  if (pinCandidates.length === 0) return window;

  const seenPinIds = new Set();
  const pins = pinCandidates
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() ||
        String(a._id).localeCompare(String(b._id))
    )
    .filter((m) => {
      const id = String(m._id);
      if (seenPinIds.has(id) || windowIds.has(id)) return false;
      seenPinIds.add(id);
      return true;
    })
    .slice(0, MAX_COLD_START_PINS);

  return pins.length > 0 ? [...pins, ...window] : window;
};

// ---------------------------------------------------------------------------
// Rolling summary compressor
// ---------------------------------------------------------------------------

/**
 * Render a chat slice into a single string the cheap summarizer can
 * consume. Assistant turns can be megabytes of scene prose — we cap
 * each turn at ~2k chars so the compressor stays bounded and cheap.
 */
const renderForSummarizer = (messages) =>
  messages
    .map((m) => {
      const role = m.role === "assistant" ? "Olivia" : m.role === "user" ? "Writer" : m.role;
      const body =
        typeof m.content === "string" ? m.content.slice(0, 2000) : "";
      return `[${role}] ${body}`;
    })
    .join("\n\n");

const buildSummaryPrompt = (priorSummary, sliceText) => {
  const head = priorSummary
    ? `You are maintaining a running summary of an Olivia AI writing-coach conversation. Update the existing summary with the new turns below.\n\n=== EXISTING SUMMARY ===\n${priorSummary}\n\n=== NEW TURNS ===\n${sliceText}\n\n`
    : `You are maintaining a running summary of an Olivia AI writing-coach conversation. Produce a fresh summary covering the turns below.\n\n=== TURNS ===\n${sliceText}\n\n`;

  return (
    head +
    "Return a tight, faithful summary in 6 bullets max plus 1 short paragraph. " +
    "Preserve concrete facts: scene numbers/titles discussed, decisions confirmed, " +
    "open threads, character names mentioned, POV choices, structural choices, " +
    "and any 'next step' the writer agreed to. Do NOT invent details. Plain text only."
  );
};

/**
 * Run the rolling-summary compressor on a thread if it is overdue.
 *
 * Concurrency: gated by a Mongo-side `pendingCompression` flag flipped
 * via `findOneAndUpdate`, so two simultaneous post-stream hooks on the
 * same thread converge on one compressor run. On any failure the flag
 * is cleared but the summary is left untouched.
 *
 * `openaiKey` is required — pass through the shared key used by the
 * stream. The compressor uses `OLIVIA_MEMORY_MODEL` rather than the
 * agent model.
 *
 * Fire-and-forget at the call site: never `await` this from inside the
 * stream handler.
 */
export const compressIfDue = async ({
  threadId,
  novelId,
  userId,
  userEmail,
  openaiKey,
  triggerCount = COMPRESSION_TRIGGER_COUNT,
}) => {
  if (!threadId || !openaiKey) return;

  let cursor = await getOrCreateCursor(threadId, novelId, userId);
  if (!cursor) return;

  // Count uncompressed eligible messages. If we have fewer than the
  // trigger threshold, bail without touching the DB further.
  const uncompressedFilter = { threadId };
  if (cursor.summarizedThroughMessageId) {
    uncompressedFilter._id = { $gt: cursor.summarizedThroughMessageId };
  }
  const eligibleCount = await Message.countDocuments({
    ...uncompressedFilter,
    $or: [
      { "metadata.excludeFromModelInput": { $exists: false } },
      { "metadata.excludeFromModelInput": false },
    ],
  });

  if (eligibleCount < triggerCount) return;

  // Try to claim the compression slot atomically.
  const claimed = await ConversationCursor.findOneAndUpdate(
    { threadId, pendingCompression: { $ne: true } },
    { $set: { pendingCompression: true } },
    { new: true }
  );

  if (!claimed) return;

  try {
    // Reserve the slice we'll compress: everything past the cursor up to
    // (but not including) the trailing window, so users keep seeing
    // crisp recall on the most recent turns.
    const slice = await Message.find(uncompressedFilter)
      .sort({ timestamp: 1, _id: 1 })
      .lean();

    const eligible = slice.filter(isModelEligible);
    if (eligible.length < triggerCount) {
      // Someone else compressed concurrently; nothing to do.
      return;
    }

    // Keep the trailing window unsummarized — it still rides as raw
    // input in cold-start fallback, plus the FE always renders it.
    const windowSize = cursor.recentWindowSize || DEFAULT_RECENT_WINDOW;
    const toSummarize = eligible.slice(0, Math.max(0, eligible.length - windowSize));
    if (toSummarize.length === 0) return;

    const sliceText = renderForSummarizer(toSummarize);
    const prompt = buildSummaryPrompt(cursor.rollingSummary || "", sliceText);

    const openai = getOpenAIClient(openaiKey);
    const response = await openai.responses.create({
      model: OLIVIA_MEMORY_MODEL,
      instructions:
        "You are a precise summarizer that preserves names, scene numbers, and decisions. Never invent facts.",
      input: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const newSummary =
      (response.output || [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content || [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text)
        .join("\n")
        .trim() || cursor.rollingSummary || "";

    if (userId && response.usage) {
      logApiUsageRaw({
        userId,
        userEmail,
        endpoint: "olivia-memory-compress",
        model: OLIVIA_MEMORY_MODEL,
        promptTokens: response.usage.input_tokens || 0,
        cachedInputTokens:
          response.usage.input_tokens_details?.cached_tokens || 0,
        completionTokens: response.usage.output_tokens || 0,
      });
    }

    const lastSummarized = toSummarize[toSummarize.length - 1];

    await ConversationCursor.updateOne(
      { threadId },
      {
        $set: {
          rollingSummary: newSummary,
          summarizedThroughMessageId: lastSummarized._id,
          summarizedThroughTimestamp: lastSummarized.timestamp,
          lastCompressedAt: new Date(),
        },
      }
    );
  } catch (err) {
    console.error(
      "memoryService.compressIfDue failed (non-blocking):",
      err?.message || err
    );
  } finally {
    // Always release the slot — even on failure.
    await ConversationCursor.updateOne(
      { threadId },
      { $set: { pendingCompression: false } }
    ).catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// Token / cost accounting
// ---------------------------------------------------------------------------

/**
 * Record a turn's token usage onto the cursor. Increments cumulative
 * counters AND snapshots the last-turn values for the admin dashboard.
 * Computes the dollar cost via `estimateCost` so we don't depend on
 * downstream pricing lookups when summing across rows.
 *
 * `legacyEstimateTokens` is an upper-bound estimate of what the legacy
 * "send full history" path would have spent on the same turn; the diff
 * is logged as `estimatedTokensSaved` for reporting.
 */
export const recordTurnUsage = async ({
  threadId,
  model,
  promptTokens = 0,
  cachedInputTokens = 0,
  completionTokens = 0,
  legacyEstimateTokens = 0,
}) => {
  if (!threadId) return;

  const cost = estimateCost({
    model,
    inputTokens: promptTokens,
    cachedInputTokens,
    outputTokens: completionTokens,
  });

  const tokensSaved = Math.max(
    0,
    (legacyEstimateTokens || 0) - (promptTokens || 0)
  );

  await ConversationCursor.updateOne(
    { threadId },
    {
      $inc: {
        totalPromptTokens: promptTokens,
        totalCachedInputTokens: cachedInputTokens,
        totalCompletionTokens: completionTokens,
        totalCost: cost,
        estimatedTokensSaved: tokensSaved,
      },
      $set: {
        lastPromptTokens: promptTokens,
        lastCompletionTokens: completionTokens,
        lastTurnAt: new Date(),
      },
    }
  ).catch((err) =>
    console.error(
      "memoryService.recordTurnUsage failed (non-blocking):",
      err?.message || err
    )
  );
};

// ---------------------------------------------------------------------------
// OpenAI response-id chain management
// ---------------------------------------------------------------------------

/**
 * Stamp the cursor with the OpenAI `response.id` from a freshly
 * completed stream. The next turn passes this as
 * `previous_response_id` so OpenAI replays implicit prior-turn context
 * cheaply (we don't have to resend it).
 */
export const markResponseChain = async (threadId, responseId) => {
  if (!threadId || !responseId) return;

  await ConversationCursor.updateOne(
    { threadId },
    {
      $set: {
        lastResponseId: responseId,
        lastResponseIdAt: new Date(),
        lastResponseIdExpired: false,
      },
    }
  ).catch((err) =>
    console.error(
      "memoryService.markResponseChain failed (non-blocking):",
      err?.message || err
    )
  );
};

/**
 * Flip the cursor into "chain expired" mode so the next turn falls
 * back to summary + windowed history instead of `previous_response_id`.
 * Called when an OpenAI 4xx referencing the response id is observed.
 */
export const invalidateResponseChain = async (threadId) => {
  if (!threadId) return;
  await ConversationCursor.updateOne(
    { threadId },
    {
      $set: {
        lastResponseId: null,
        lastResponseIdExpired: true,
        chainTurnCount: 0,
      },
    }
  ).catch(() => {});
};

/**
 * Whether the next turn should pass `previous_response_id` to OpenAI.
 * Returns false when the chain is expired, over turn/token limits, or missing.
 */
export const shouldUseResponseChain = (cursor) => {
  if (!cursor) return false;
  if (cursor.lastResponseIdExpired) return false;
  if (!cursor.lastResponseId) return false;

  if ((cursor.chainTurnCount || 0) >= OLIVIA_CHAIN_MAX_TURNS) return false;

  if (
    (cursor.lastPromptTokens || 0) >= OLIVIA_CHAIN_MAX_INPUT_TOKENS
  ) {
    return false;
  }

  if (cursor.lastResponseIdAt) {
    const ageMs = Date.now() - new Date(cursor.lastResponseIdAt).getTime();
    if (ageMs > RESPONSE_ID_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return false;
  }

  return true;
};

/**
 * Increment chain turn counter after a successful chained stream.
 */
export const incrementChainTurnCount = async (threadId) => {
  if (!threadId) return;
  await ConversationCursor.updateOne(
    { threadId },
    { $inc: { chainTurnCount: 1 } }
  ).catch(() => {});
};

/**
 * Reset chain state (invalidate response id + zero turn count).
 */
export const resetChain = async (threadId) => {
  await invalidateResponseChain(threadId);
};

/**
 * Stamp when the memory block was last assembled for this thread.
 */
export const stampLastMutationAtAssembly = async (threadId, lastMutationTs) => {
  if (!threadId || !lastMutationTs) return;
  await ConversationCursor.updateOne(
    { threadId },
    { $set: { lastMutationTsAtAssembly: new Date(lastMutationTs) } }
  ).catch(() => {});
};

/**
 * True when the memory block can be omitted on a chain-hot turn because
 * novel content has not changed since the last assembly.
 */
export const shouldSkipMemoryBlockOnChain = (cursor, lastMutationTs, options = {}) => {
  if (options.requiresCanonExpansion) return false;
  if (!OLIVIA_SKIP_MEMORY_BLOCK_ON_CHAIN) return false;
  if (!cursor?.lastMutationTsAtAssembly || !lastMutationTs) return false;
  const assembledAt = new Date(cursor.lastMutationTsAtAssembly).getTime();
  const mutatedAt = new Date(lastMutationTs).getTime();
  return mutatedAt <= assembledAt;
};

/**
 * Record diagnostic snapshot fields on the cursor after a turn.
 */
export const recordTurnDiagnostics = async ({
  threadId,
  memoryBlockChars = 0,
  chainUsed = false,
}) => {
  if (!threadId) return;
  await ConversationCursor.updateOne(
    { threadId },
    {
      $set: {
        lastMemoryBlockChars: memoryBlockChars,
        lastChainUsed: chainUsed,
      },
    }
  ).catch(() => {});
};

/**
 * Resolve a `previous_response_id` to actually pass to OpenAI on the
 * next turn, or `null` if the chain is missing / expired / too old.
 */
export const resolveChainHeadResponseId = (cursor) => {
  if (!cursor) return null;
  if (cursor.lastResponseIdExpired) return null;
  if (!cursor.lastResponseId) return null;

  if (cursor.lastResponseIdAt) {
    const ageMs = Date.now() - new Date(cursor.lastResponseIdAt).getTime();
    if (ageMs > RESPONSE_ID_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;
  }

  return cursor.lastResponseId;
};

/**
 * Heuristic check: did this OpenAI error reference our previous
 * response id specifically? We treat any 4xx mentioning "previous_response"
 * or the literal id as a chain-invalidation signal.
 */
export const isPreviousResponseIdError = (err, responseId) => {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status && (status < 400 || status >= 500)) return false;
  const haystack = `${err.message || ""} ${err?.error?.message || ""}`.toLowerCase();
  if (haystack.includes("previous_response_id")) return true;
  if (haystack.includes("previous response")) return true;
  if (responseId && haystack.includes(responseId.toLowerCase())) return true;
  return false;
};

export const _internal = {
  COMPRESSION_TRIGGER_COUNT,
  RESPONSE_ID_MAX_AGE_DAYS,
  DEFAULT_RECENT_WINDOW,
  MAX_COLD_START_PINS,
  LAYERING_TABLE_HEADER_RE,
  isLayeringTablePinContent,
  isModelEligible,
  shouldUseResponseChain,
};
