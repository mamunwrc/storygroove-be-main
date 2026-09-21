// NEW DEFAULT: OpenAI Responses API implementation
// Replaces the Assistants API (threads/runs) with stateless /v1/responses calls.
// Conversation history is managed in our MongoDB Message collection.

import OpenAI from "openai";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getFileFromS3 } from "./s3Service.js";
import { getStoryPrompts } from "../utils/getStoryPrompts.js";
import { getCharacterPrompts } from "../utils/getCharacterPrompts.js";
import StoryResponse from "../models/storyResponseModel.js";
import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import Character from "../models/characterModel.js";
import Message from "../models/messageModel.js";
import Thread from "../models/threadModel.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import {
  storeEllisSceneReviews,
  storeOliviaSceneSuggestions,
  parseJSONResponse,
} from "./openaiService.js";
import { logApiUsage, logApiUsageRaw, estimateCost } from "../utils/logApiUsage.js";
import { resolveSceneTitleForOutline } from "../utils/resolveSceneTitleForOutline.js";
import { SIMONE_PAUSED_MESSAGE } from "../constants/simoneSession.js";
import {
  OLIVIA_MODEL,
  ELLIS_MODEL,
} from "../constants/models.js";
import { isEllisThreadMessageForModel } from "../constants/ellisUiMessages.js";
import {
  getOrCreateCursor,
  loadWindowedHistory,
  compressIfDue,
  recordTurnUsage,
  markResponseChain,
  invalidateResponseChain,
  resolveChainHeadResponseId,
  isPreviousResponseIdError,
  shouldUseResponseChain,
  shouldSkipMemoryBlockOnChain,
  incrementChainTurnCount,
  resetChain,
  stampLastMutationAtAssembly,
  recordTurnDiagnostics,
} from "./memoryService.js";
import { OLIVIA_CHAIN_MAX_INPUT_TOKENS, SIMONE_RECENT_WINDOW_SIZE } from "../constants/oliviaMemory.js";
import { ELLIS_RECENT_WINDOW_SIZE } from "../constants/ellisMemory.js";
import {
  isDashboardStoryBibleArtifact,
  DASHBOARD_ARTIFACT_KIND_STORY_BIBLE,
} from "../constants/dashboardChatArtifacts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root of the backend package (storygroove-be/)
const appDir = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
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
  const httpsAgent = getHttpsAgent();
  return new OpenAI({
    apiKey,
    httpAgent: httpsAgent,
    httpsAgent: httpsAgent,
  });
};

/**
 * Extract plain text from a Responses API output array.
 */
export const extractTextFromOutput = (output) => {
  if (!output || !Array.isArray(output)) return "";
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
};

const DOSSIER_SECTION_EMOJIS = {
  1: "🧬",
  2: "📋",
  3: "👤",
  4: "🧠",
  5: "🗣",
  6: "🏡",
  7: "🛠",
  8: "🤝",
  9: "💔",
  10: "⚔",
  11: "🎯",
  12: "🧭",
  13: "🔐",
  14: "🌱",
  15: "🎒",
  16: "⏳",
  17: "🚀",
};

const normalizeCharacterDossierText = (text) => {
  if (!text || typeof text !== "string") return "";
  let out = String(text);

  // Add missing section emoji for lines like "1. Archetype and Role"
  // while preserving already emoji-prefixed lines.
  out = out.replace(/^(\d+)\.\s+(.+)$/gm, (match, sectionNumber, sectionTitle) => {
    const num = Number(sectionNumber);
    const emoji = DOSSIER_SECTION_EMOJIS[num];
    if (!emoji) return match;

    const title = sectionTitle.trim();
    const normalizedTitle = title.replace(/^\*+\s*/, "").replace(/\s*\*+$/, "").trim();
    const hasLeadingEmoji = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(normalizedTitle);
    if (hasLeadingEmoji) return match;

    return `${sectionNumber}. ${emoji} ${title}`;
  });

  // Ensure summary section includes the book emoji once.
  out = out.replace(
    /^\s*(?:\*\*)?\s*(?:📖\s*)?Summary Note of Character\s*(?:\*\*)?\s*$/gim,
    "📖 Summary Note of Character"
  );

  return out;
};

// ---------------------------------------------------------------------------
// Core Responses API wrapper
// ---------------------------------------------------------------------------

/**
 * Low-level wrapper around openai.responses.create().
 * Handles built-in tool calls (code_interpreter, file_search) automatically.
 * For custom function calls, implements the submit-and-retry loop.
 */
const functionCallsFromOutput = (output = []) =>
  (output || []).filter((item) => item.type === "function_call");

const runFunctionCallOutputs = async (functionCalls, resolveFunctionCall) => {
  const outputs = [];
  for (const fc of functionCalls) {
    let output = JSON.stringify({
      error: "Function not implemented on the client side.",
    });
    if (typeof resolveFunctionCall === "function") {
      try {
        const result = await resolveFunctionCall(fc);
        output = typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        output = JSON.stringify({ error: err?.message || String(err) });
      }
    }
    outputs.push({
      type: "function_call_output",
      call_id: fc.call_id,
      output,
    });
  }
  return outputs;
};

const mergeStreamUsage = (a, b) => {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    input_tokens_details: {
      cached_tokens:
        (a.input_tokens_details?.cached_tokens || 0) +
        (b.input_tokens_details?.cached_tokens || 0),
    },
  };
};

/**
 * Low-level wrapper around openai.responses.create().
 * Handles built-in tool calls (code_interpreter, file_search) automatically.
 * For custom function calls, implements the submit-and-retry loop.
 */
export const callResponsesAPI = async ({
  openai,
  model = OLIVIA_MODEL,
  instructions,
  input,
  tools = [],
  temperature = 0.3,
  maxToolRounds = 10,
  logParams,
  resolveFunctionCall = null,
  /**
   * Optional Responses API `text` config — e.g. a strict json_schema response
   * format: { format: { type: "json_schema", name, schema, strict: true } }.
   * Passed straight through to `openai.responses.create`.
   */
  text = undefined,
}) => {
  let currentInput = [...input];
  let rounds = 0;

  while (rounds < maxToolRounds) {
    const response = await openai.responses.create({
      model,
      instructions,
      input: currentInput,
      tools: tools.length > 0 ? tools : undefined,
      temperature,
      ...(text ? { text } : {}),
    });

    if (logParams) {
      logApiUsage(response, { ...logParams, model });
    }

    const functionCalls = functionCallsFromOutput(response.output);

    if (functionCalls.length === 0) {
      return response;
    }

    currentInput.push(...response.output);
    currentInput.push(
      ...(await runFunctionCallOutputs(functionCalls, resolveFunctionCall))
    );

    rounds++;
  }

  throw new Error("Max tool-call rounds exceeded in callResponsesAPI");
};

// ---------------------------------------------------------------------------
// Output sanitiser — strips trailing model-hallucinated token noise
// ---------------------------------------------------------------------------

const TRAILING_NOISE_RE =
  /(?<=\*\*)\s*numerus\w*.*$/is;

const KNOWN_NOISE_FRAGMENTS = [
  "numerusform",
  "final code snipped",
  "final code omitted",
  "user to=all",
  "usercontent to=",
];

/**
 * Strip trailing garbage tokens the model occasionally appends after an
 * otherwise valid response. Detected heuristically: known noise fragments
 * that are clearly not natural-language output.
 */
const sanitiseModelOutput = (text) => {
  if (!text || typeof text !== "string") return text;

  let cleaned = text.replace(TRAILING_NOISE_RE, "");

  for (const frag of KNOWN_NOISE_FRAGMENTS) {
    const idx = cleaned.toLowerCase().indexOf(frag.toLowerCase());
    if (idx !== -1) {
      cleaned = cleaned.slice(0, idx).trimEnd();
    }
  }

  return cleaned;
};

// ---------------------------------------------------------------------------
// Interactive chat (Simone / Olivia)
// ---------------------------------------------------------------------------

/** UI-only thread rows (welcome, full reviews) must not be sent to the model. */
const filterMessagesForModelInput = (history) =>
  (history || []).filter((msg) => isEllisThreadMessageForModel(msg));

/**
 * Send a chat message using the Responses API.
 * 1. Stores user message in DB
 * 2. Loads full conversation history from DB
 * 3. Sends to /v1/responses
 * 4. Stores assistant reply in DB
 * Returns the assistant message document.
 */
export const chatWithResponsesAPI = async ({
  openaiKey,
  threadId,
  userMessage,
  instructions,
  model = OLIVIA_MODEL,
  tools = [],
  temperature = 0.3,
  userId,
  userEmail,
  attachments = [],
}) => {
  const openai = getOpenAIClient(openaiKey);

  await Message.create({
    threadId,
    role: "user",
    content: userMessage,
    attachments: Array.isArray(attachments) ? attachments : [],
    timestamp: new Date(),
  });

  const history = await Message.find({ threadId }).sort({ timestamp: 1 });
  const historyForModel = filterMessagesForModelInput(history);

  const input = await Promise.all(
    historyForModel.map(async (msg) => ({
      role: msg.role,
      content: await buildMessageContent(msg),
    }))
  );

  const response = await callResponsesAPI({
    openai,
    model,
    instructions,
    input,
    tools,
    temperature,
    logParams: userId ? { userId, userEmail, endpoint: "chat" } : undefined,
  });

  const assistantText = sanitiseModelOutput(extractTextFromOutput(response.output));

  const assistantMsg = await Message.create({
    threadId,
    role: "assistant",
    content: assistantText,
    metadata: { responseId: response.id },
    timestamp: new Date(),
  });

  return assistantMsg;
};

/** Build cold-start input: summary + optional memory block + windowed history. */
const buildColdStartInput = async ({
  threadId,
  cursor,
  memoryBlockMessage,
}) => {
  const window = await loadWindowedHistory(
    threadId,
    cursor?.recentWindowSize || 10
  );
  const windowParts = await Promise.all(
    window.map(async (msg) => ({
      role: msg.role,
      content: await buildMessageContent(msg),
    }))
  );

  const summaryPart =
    cursor?.rollingSummary && cursor.rollingSummary.trim()
      ? [
          {
            role: "system",
            content: `CONVERSATION SUMMARY (older context that has scrolled out of the live window):\n${cursor.rollingSummary}`,
          },
        ]
      : [];

  const memoryParts = memoryBlockMessage ? [memoryBlockMessage] : [];
  return [...summaryPart, ...memoryParts, ...windowParts];
};

const isContextWindowError = (err) => {
  if (!err) return false;
  const haystack = `${err.message || ""} ${err?.error?.message || ""}`.toLowerCase();
  return (
    haystack.includes("context window") ||
    haystack.includes("context_length") ||
    haystack.includes("maximum context")
  );
};


/**
 * Send a chat message using the Responses API with token-level SSE streaming.
 * The Express `res` object must be passed in; SSE headers are set here.
 *
 * SSE event shapes sent to the client:
 *   data: {"token":"..."}          — each text delta
 *   data: {"done":true,"message":{id,role,content,created_at,threadId}}
 *   data: {"error":"..."}          — on failure
 */
export const chatWithResponsesAPIStream = async ({
  openaiKey,
  threadId,
  userMessage,
  instructions,
  model = OLIVIA_MODEL,
  tools = [],
  temperature = 0.3,
  res,
  userId,
  userEmail,
  attachments = [],
  agentName,
  // -------------------------------------------------------------------
  // New Olivia memory pipeline (Phase 1)
  // -------------------------------------------------------------------
  /**
   * When true, route through the windowed-history + rolling-summary
   * + `previous_response_id` chain. Off by default to preserve legacy
   * behavior for the dashboard Olivia agent and other callers. The
   * Book Editor controllers set this from `isOliviaMemoryV2Enabled()` (constants/oliviaMemory.js).
   */
  useMemoryPipeline = false,
  /**
   * Required when `useMemoryPipeline` is true so the cursor can be
   * scoped to the right novel. Safe to omit otherwise.
   */
  novelId = null,
  /**
   * Optional pre-assembled "memory block" message (system role). Phase 2's
   * `contextAssembler` will populate this; in Phase 1 it stays `null`
   * and the cold-start fallback simply replays a window of raw history.
   */
  memoryBlockMessage = null,
  /** Outline/bible supplements — sent even when full memory block is chain-skipped. */
  supplementBlockMessage = null,
  /** Lead-character dossiers when full memory block is chain-skipped. */
  chainHotMemoryBlockMessage = null,
  /**
   * Endpoint label used for `logApiUsageRaw`. Defaults to the legacy
   * value so existing dashboards don't change.
   */
  usageEndpoint = "chat-stream",
  /** When set, used to skip re-sending memory block on unchanged chain-hot turns. */
  lastMutationTs = null,
  /** When true, always re-send memory block (canon/dossier Q&A). */
  requiresCanonExpansion = false,
  /**
   * Optional hook to enrich assistant Message metadata after stream completes.
   * Return plain object merged into metadata (e.g. coaching full-pass snapshot).
   */
  resolveAssistantMetadata = null,
  /**
   * Optional hook to transform the final assistant text after sanitiseModelOutput
   * but before metadata resolution, persistence, and the `done` event. Receives
   * `{ text, userMessage }` and returns the (possibly modified) string. Used to
   * deterministically enforce coaching close rules (no branching offers).
   */
  transformAssistantText = null,
  /**
   * When set, request structured JSON via Responses API json_schema format.
   * Example: { name: "EllisChapterReview", schema: ELLIS_CHAPTER_REVIEW_SCHEMA }
   */
  structuredOutput = null,
  /** Optional metadata stored on the persisted user Message (UI flags, etc.). */
  userMessageMetadata = null,
  /**
   * Extra input blocks sent to the model on this turn only — not persisted.
   * Example: chapter manuscript body for Ellis chapter review after a short trigger.
   */
  ephemeralModelContext = null,
  /** Optional SSE payload written immediately after headers (e.g. turnNavigation). */
  sseBootstrap = null,
  /**
   * Handle custom Responses API function_call items (e.g. load_manuscript_scenes).
   * Receives the function_call item; return a string (or JSON-serializable value).
   */
  resolveFunctionCall = null,
  maxToolRounds = 3,
}) => {
  // Flush SSE headers immediately so the client establishes the connection
  // while DB/S3/OpenAI prep work runs server-side.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();
  if (sseBootstrap) {
    res.write(sseBootstrap);
  }

  let fullText = "";
  let clientDisconnected = false;
  let streamUsage = null;
  let responseId = null;

  const onClose = () => { clientDisconnected = true; };
  res.on("close", onClose);

  try {
    const openai = getOpenAIClient(openaiKey);

    const userMsgFields = {
      threadId,
      role: "user",
      content: userMessage,
      attachments: Array.isArray(attachments) ? attachments : [],
      timestamp: new Date(),
    };
    if (userMessageMetadata && typeof userMessageMetadata === "object") {
      userMsgFields.metadata = userMessageMetadata;
    }
    const userMsgDoc = await Message.create(userMsgFields);

    // -----------------------------------------------------------------
    // Build the `input` array.
    //
    // V2 path (Olivia memory pipeline):
    //   - If we have a fresh `previous_response_id`, send only the
    //     optional memory block + the new user message. OpenAI replays
    //     prior context implicitly.
    //   - Otherwise: rolling-summary + windowed-history + new user.
    //
    // Legacy path: full history (unchanged).
    // -----------------------------------------------------------------
    let input;
    let cursor = null;
    let chainHeadId = null;
    let chainUsed = false;
    let legacyEstimateTokens = 0;
    let effectiveMemoryBlock = memoryBlockMessage;
    let cursorOptions = {};

    const appendContextToInput = (baseInput, contextBlocks) => {
      const blocks = (contextBlocks || []).filter(Boolean);
      if (!blocks.length) return baseInput;
      if (Array.isArray(baseInput)) return [...blocks, ...baseInput];
      return [...blocks, baseInput];
    };

    const appendEphemeralModelContext = (baseInput) => {
      const blocks = (ephemeralModelContext || []).filter(Boolean);
      if (!blocks.length || !Array.isArray(baseInput)) return baseInput;
      return [...baseInput, ...blocks];
    };

    if (useMemoryPipeline && threadId && userId) {
      cursorOptions =
        agentName === "simone"
          ? { recentWindowSize: SIMONE_RECENT_WINDOW_SIZE }
          : agentName === "ellis_editor"
            ? { recentWindowSize: ELLIS_RECENT_WINDOW_SIZE }
            : {};
      cursor = await getOrCreateCursor(
        threadId,
        novelId || null,
        userId,
        cursorOptions
      );

      if (!shouldUseResponseChain(cursor) && cursor?.lastResponseId) {
        await resetChain(threadId);
        cursor = await getOrCreateCursor(
          threadId,
          novelId || null,
          userId,
          cursorOptions
        );
      }

      chainHeadId = shouldUseResponseChain(cursor)
        ? resolveChainHeadResponseId(cursor)
        : null;
      chainUsed = Boolean(chainHeadId);

      const allHistory = await Message.find({ threadId }).select("content").lean();
      legacyEstimateTokens = Math.round(
        allHistory.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4
      );

      if (
        chainHeadId &&
        shouldSkipMemoryBlockOnChain(cursor, lastMutationTs, {
          requiresCanonExpansion,
        })
      ) {
        effectiveMemoryBlock = chainHotMemoryBlockMessage || null;
      }

      const alwaysOnContext = supplementBlockMessage
        ? [supplementBlockMessage]
        : [];

      if (chainHeadId) {
        const newUserPart = {
          role: "user",
          content: await buildMessageContent(userMsgDoc),
        };
        const contextBlocks = [
          ...(effectiveMemoryBlock ? [effectiveMemoryBlock] : []),
          ...alwaysOnContext,
        ];
        input = appendContextToInput([newUserPart], contextBlocks);
      } else {
        input = await buildColdStartInput({
          threadId,
          cursor,
          memoryBlockMessage: effectiveMemoryBlock,
        });
        input = appendContextToInput(input, alwaysOnContext);
        if (effectiveMemoryBlock && lastMutationTs) {
          stampLastMutationAtAssembly(threadId, lastMutationTs).catch(() => {});
        }
      }

      if (chainHeadId && effectiveMemoryBlock && lastMutationTs) {
        stampLastMutationAtAssembly(threadId, lastMutationTs).catch(() => {});
      }
    } else {
      // Legacy path — every other caller (Simone, dashboard Olivia, etc.).
      const history = await Message.find({ threadId }).sort({ timestamp: 1 });
      const historyForModel = filterMessagesForModelInput(history);
      input = await Promise.all(
        historyForModel.map(async (msg) => ({
          role: msg.role,
          content: await buildMessageContent(msg),
        }))
      );
      input = appendEphemeralModelContext(input);
    }

    if (useMemoryPipeline && threadId && userId) {
      input = appendEphemeralModelContext(input);
    }

    const createPayload = {
      model,
      instructions,
      input,
      tools: tools.length > 0 ? tools : undefined,
      temperature,
      stream: true,
    };
    if (structuredOutput?.schema) {
      createPayload.text = {
        format: {
          type: "json_schema",
          name: structuredOutput.name || "StructuredOutput",
          schema: structuredOutput.schema,
          strict: structuredOutput.strict !== false,
        },
      };
    }
    if (useMemoryPipeline && chainHeadId) {
      createPayload.previous_response_id = chainHeadId;
    }

    let stream;
    try {
      stream = await openai.responses.create(createPayload);
    } catch (createErr) {
      // If the previous_response_id is stale/invalid, mark it as
      // expired and retry once in cold-start mode.
      if (
        useMemoryPipeline &&
        chainHeadId &&
        (isPreviousResponseIdError(createErr, chainHeadId) ||
          isContextWindowError(createErr))
      ) {
        console.warn(
          JSON.stringify({
            scope: "responsesApiService",
            op: "chainReset",
            threadId,
            novelId: novelId ? String(novelId) : null,
            reason: isContextWindowError(createErr)
              ? "context_window"
              : "previous_response_id",
          })
        );
        await resetChain(threadId);
        cursor = await getOrCreateCursor(
          threadId,
          novelId || null,
          userId,
          cursorOptions
        );
        chainHeadId = null;
        chainUsed = false;

        const retryInput = appendEphemeralModelContext(
          await buildColdStartInput({
            threadId,
            cursor,
            memoryBlockMessage: memoryBlockMessage,
          })
        );
        if (memoryBlockMessage && lastMutationTs) {
          stampLastMutationAtAssembly(threadId, lastMutationTs).catch(() => {});
        }

        stream = await openai.responses.create({
          ...createPayload,
          input: retryInput,
          previous_response_id: undefined,
        });
      } else {
        throw createErr;
      }
    }

    const consumeStream = async (readable, { live = true } = {}) => {
      let roundText = "";
      let roundUsage = null;
      let roundId = null;
      let roundOutput = [];
      for await (const event of readable) {
        if (event.type === "response.output_text.delta" && event.delta) {
          roundText += event.delta;
          if (live && !clientDisconnected) {
            res.write(`data: ${JSON.stringify({ token: event.delta })}\n\n`);
          }
        }
        if (event.type === "response.output_item.done" && event.item) {
          roundOutput.push(event.item);
        }
        if (event.type === "response.completed") {
          if (event.response?.usage) roundUsage = event.response.usage;
          if (event.response?.id) roundId = event.response.id;
          if (Array.isArray(event.response?.output) && event.response.output.length) {
            roundOutput = event.response.output;
          }
        }
      }
      return { roundText, roundUsage, roundId, roundOutput };
    };

    const createToolFollowUpStream = async (toolOutputs, parentResponseId) => {
      try {
        return await openai.responses.create({
          ...createPayload,
          input: toolOutputs,
          previous_response_id: parentResponseId || undefined,
        });
      } catch (toolErr) {
        const canRetry =
          Boolean(parentResponseId) &&
          (isPreviousResponseIdError(toolErr, parentResponseId) ||
            isContextWindowError(toolErr));
        if (!canRetry) throw toolErr;
        console.warn(
          JSON.stringify({
            scope: "responsesApiService",
            op: "chainReset",
            threadId,
            novelId: novelId ? String(novelId) : null,
            reason: isContextWindowError(toolErr)
              ? "context_window"
              : "previous_response_id",
            phase: "tool_follow_up",
          })
        );
        if (useMemoryPipeline && threadId) {
          await resetChain(threadId);
          chainHeadId = null;
          chainUsed = false;
        }
        const packNote = toolOutputs
          .map((item) => String(item.output || "").trim())
          .filter(Boolean)
          .join("\n\n");
        const originalInput = Array.isArray(createPayload.input)
          ? createPayload.input
          : createPayload.input
            ? [createPayload.input]
            : [];
        const fallbackInput = appendContextToInput(
          originalInput,
          packNote ? [{ role: "user", content: packNote }] : []
        );
        const { previous_response_id: _droppedChainId, ...retryPayload } =
          createPayload;
        return openai.responses.create({
          ...retryPayload,
          input: fallbackInput,
        });
      }
    };

    const toolsPossible = typeof resolveFunctionCall === "function";
    // Stream deltas live even when tools exist. Ellis always has
    // load_manuscript_chapters; buffering the round (`live: false`) then
    // dumping the whole reply as one token made chat pop in instead of stream.
    // Function-call rounds almost never emit output_text.
    let round = await consumeStream(stream, { live: true });
    streamUsage = mergeStreamUsage(streamUsage, round.roundUsage);
    if (round.roundId) responseId = round.roundId;

    let toolRounds = 0;
    while (toolsPossible && toolRounds < maxToolRounds) {
      const functionCalls = functionCallsFromOutput(round.roundOutput);
      if (!functionCalls.length) break;
      const toolOutputs = await runFunctionCallOutputs(
        functionCalls,
        resolveFunctionCall
      );
      stream = await createToolFollowUpStream(toolOutputs, responseId);
      round = await consumeStream(stream, { live: true });
      streamUsage = mergeStreamUsage(streamUsage, round.roundUsage);
      if (round.roundId) responseId = round.roundId;
      toolRounds++;
    }

    if (!functionCallsFromOutput(round.roundOutput).length) {
      fullText += round.roundText;
    }

    const cleanedText = sanitiseModelOutput(fullText);

    let finalText = cleanedText;
    if (typeof transformAssistantText === "function") {
      try {
        const transformed = transformAssistantText({
          text: cleanedText,
          userMessage,
        });
        if (typeof transformed === "string" && transformed.trim()) {
          finalText = transformed;
        }
      } catch (transformErr) {
        console.error("transformAssistantText error:", transformErr);
      }
    }

    let assistantMetadata = responseId ? { responseId } : {};
    if (typeof resolveAssistantMetadata === "function") {
      try {
        const extra = await resolveAssistantMetadata({
          fullText: finalText,
          userMessage,
        });
        if (extra && typeof extra === "object") {
          assistantMetadata = { ...assistantMetadata, ...extra };
        }
      } catch (metaErr) {
        console.error("resolveAssistantMetadata error:", metaErr);
      }
    }

    if (
      agentName === "olivia" &&
      isDashboardStoryBibleArtifact(finalText) &&
      !assistantMetadata.kind
    ) {
      assistantMetadata = {
        ...assistantMetadata,
        kind: DASHBOARD_ARTIFACT_KIND_STORY_BIBLE,
      };
    }

    const assistantMsg = await Message.create({
      threadId,
      role: "assistant",
      content: finalText,
      metadata: assistantMetadata,
      timestamp: new Date(),
    });

    if (userId && streamUsage) {
      const promptTokens = streamUsage.input_tokens || 0;
      if (promptTokens > OLIVIA_CHAIN_MAX_INPUT_TOKENS + 20000) {
        console.warn(
          JSON.stringify({
            scope: "responsesApiService",
            op: "highTokenUsage",
            userId: String(userId),
            endpoint: usageEndpoint,
            threadId,
            novelId: novelId ? String(novelId) : null,
            promptTokens,
            chainTurnCount: cursor?.chainTurnCount ?? null,
            chainUsed,
          })
        );
      }
      logApiUsageRaw({
        userId,
        userEmail,
        endpoint: usageEndpoint,
        model,
        promptTokens,
        cachedInputTokens:
          streamUsage.input_tokens_details?.cached_tokens || 0,
        completionTokens: streamUsage.output_tokens || 0,
      });
    }

    // -----------------------------------------------------------------
    // Post-stream memory-pipeline hooks (V2 only)
    //   1. Stamp the new response.id onto the cursor for chaining.
    //   2. Record per-turn token/cost usage onto the cursor.
    //   3. Fire-and-forget the rolling-summary compressor.
    // -----------------------------------------------------------------
    if (useMemoryPipeline && threadId) {
      if (responseId) {
        markResponseChain(threadId, responseId).catch(() => {});
      }
      if (chainUsed) {
        incrementChainTurnCount(threadId).catch(() => {});
      }
      const memoryBlockChars =
        effectiveMemoryBlock?.content?.length ||
        memoryBlockMessage?.content?.length ||
        0;
      recordTurnDiagnostics({
        threadId,
        memoryBlockChars,
        chainUsed,
      }).catch(() => {});
      if (streamUsage) {
        recordTurnUsage({
          threadId,
          model,
          promptTokens: streamUsage.input_tokens || 0,
          cachedInputTokens:
            streamUsage.input_tokens_details?.cached_tokens || 0,
          completionTokens: streamUsage.output_tokens || 0,
          legacyEstimateTokens,
        }).catch(() => {});
      }
      // Run on next tick so the user-facing stream end isn't blocked.
      setImmediate(() => {
        compressIfDue({
          threadId,
          novelId,
          userId,
          userEmail,
          openaiKey,
        }).catch(() => {});
      });
    }

    // Per-Simone-session cost accumulator. Cap is read from ApiUsageSettings
    // (admin API Usage → Settings). If simoneSessionSpendCap is 0, pausing is disabled.
    // Uses `streamUsage` from the completed Responses API event (actual billed
    // input/output including cached prefix tokens) — unchanged under chaining.
    if (agentName === "simone" && streamUsage) {
      try {
        const settings = await ApiUsageSettings.getSettings();
        let cap = settings.simoneSessionSpendCap;
        cap = cap === null || cap === undefined ? 3 : Number(cap);
        if (!Number.isFinite(cap) || cap < 0) cap = 3;

        if (cap > 0) {
          const turnCost = estimateCost({
            model,
            inputTokens: streamUsage.input_tokens || 0,
            cachedInputTokens:
              streamUsage.input_tokens_details?.cached_tokens || 0,
            outputTokens: streamUsage.output_tokens || 0,
          });

          const updatedThread = await Thread.findOneAndUpdate(
            { threadId },
            { $inc: { sessionCost: turnCost } },
            { new: true }
          );

          if (
            updatedThread &&
            !updatedThread.simonePaused &&
            updatedThread.sessionCost > cap
          ) {
            await Thread.updateOne(
              { _id: updatedThread._id },
              { simonePaused: true }
            );

            const pausedMsg = await Message.create({
              threadId,
              role: "assistant",
              content: SIMONE_PAUSED_MESSAGE,
              metadata: { simonePaused: true },
              timestamp: new Date(),
            });

            if (!clientDisconnected) {
              res.write(
                `data: ${JSON.stringify({
                  simonePaused: true,
                  message: {
                    id: pausedMsg._id.toString(),
                    role: "assistant",
                    content: SIMONE_PAUSED_MESSAGE,
                    created_at: Math.floor(pausedMsg.timestamp.getTime() / 1000),
                    threadId,
                  },
                })}\n\n`
              );
            }
          }
        }
      } catch (err) {
        console.error(
          "Simone session cost tracking failed (non-blocking):",
          err.message
        );
      }
    }

    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          done: true,
          message: {
            id: assistantMsg._id.toString(),
            role: "assistant",
            content: finalText,
            metadata: assistantMetadata,
            created_at: Math.floor(assistantMsg.timestamp.getTime() / 1000),
            threadId,
          },
        })}\n\n`
      );
    }
  } catch (error) {
    console.error("Streaming chat error:", error);
    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          error: error.message || "Failed to generate response",
        })}\n\n`
      );
    }
  } finally {
    res.off("close", onClose);
    if (!res.writableEnded) res.end();
  }
};

// ---------------------------------------------------------------------------
// Act title generation helper
// ---------------------------------------------------------------------------

const generateActTitle = async ({
  openai,
  conversationHistory,
  actNumber,
  novelId,
  res,
  instructions,
  logParams,
}) => {
  try {
    const actTitleInput = [
      ...conversationHistory,
      {
        role: "user",
        content: `Based on the scenes you just outlined for Act ${actNumber}, provide a short descriptive title (3-8 words) that captures the thematic purpose of this act. Return ONLY the title text, nothing else.`,
      },
    ];

    const actTitleResponse = await callResponsesAPI({
      openai,
      model: OLIVIA_MODEL,
      instructions: instructions || undefined,
      input: actTitleInput,
      temperature: 0.3,
      logParams,
    });

    const actTitle = extractTextFromOutput(actTitleResponse.output).trim();

    if (actTitle) {
      await Novel.findByIdAndUpdate(novelId, {
        $push: { acts: { actNumber, title: actTitle } },
      });

      res.write(
        `data: ${JSON.stringify({ actTitle: { actNumber, title: actTitle } })}\n\n`
      );
    }
  } catch (err) {
    console.error(`Failed to generate act ${actNumber} title:`, err.message);
  }
};

// ---------------------------------------------------------------------------
// Character profile generation from story context
// ---------------------------------------------------------------------------

export const generateCharacterProfileFromContext = async ({
  openai,
  conversationHistory,
  characterName,
  characterRole,
  characterDescription,
  instructions,
  logParams,
}) => {
  const profilePrompt = `Based on the complete novel outline we just created, generate a detailed character profile for ${characterName} (${characterRole}).

What we know about this character from the story concept:
${characterDescription || "No additional details provided."}

Act as a character development expert. Create a comprehensive, emotionally resonant character profile using the template below. Fill in ALL sections with specific, rich details that are consistent with the story's genre, tone, themes, and the scenes outlined above. Where information isn't explicitly stated, infer appropriate details that feel authentic to the character and story.

Character Profile Template:

1. Archetype and Role:
    - Archetype: [identify their archetype]
    - Role in the Story: [their function in the narrative]
2. Basic Information:
    - Name: ${characterName}
    - Age: [infer from context]
    - Gender: [infer from context]
    - Occupation: [infer from context]
    - Nationality/Ethnicity: [infer from context]
3. Physical Description:
    - Appearance: [detailed physical description]
    - Style: [clothing, grooming, overall aesthetic]
    - Notable Traits: [distinctive physical features]
4. Personality and Traits:
    - Core Traits: [3-5 defining personality traits]
    - Likes and Dislikes: [what brings them joy, what they avoid]
    - Mannerisms and Habits: [behavioral quirks]
    - Fears and Insecurities: [biggest fears and vulnerabilities]
    - Stress Reactions: [how they respond under pressure]
    - Triggers and Guilty Pleasures: [what sets them off, secret enjoyments]
5. Speech and Voice:
    - Style of Speech: [formal, casual, sarcastic, etc.]
    - Common Phrases: [signature phrases or verbal habits]
6. Background and Upbringing:
    - Family Background: [relationships, upbringing, social class]
    - Key Events: [defining moments from their past]
    - Education Level: [highest level of education or training]
7. Skills and Weaknesses:
    - Special Abilities: [unique skills, talents, or knowledge]
    - Weaknesses: [flaws or areas of vulnerability]
8. Relationships:
    - Family Dynamics: [relationship with family members]
    - Romantic Relationships: [current or past romantic involvements]
    - Friends and Enemies: [close friends, rivals, or enemies]
9. Internal Conflicts:
    - Moral Dilemmas: [key ethical challenges they face]
    - Inner Struggles: [internal conflicts or contradictions]
10. External Conflicts:
    - Character Conflicts: [tensions with other characters]
    - Environmental Obstacles: [societal or external challenges]
11. Goals and Motivations:
    - Short-Term Goals: [immediate aspirations within the story]
    - Long-Term Goals: [ultimate ambitions or dreams]
    - Motivations: [what drives them forward]
12. Secrets and Lies:
    - Personal Secrets: [what they hide from others]
    - Self-Deceptions: [the lie they tell themselves]
13. Influences:
    - Who or What Influences Them: [people, beliefs, or events that shape their choices]
14. Unique Possessions:
    - Important Belongings: [items that reveal their personality]
15. Romantic History:
    - Romantic Background: [key details about past relationships]
16. Regrets:
    - Biggest Regret: [what they most wish they had done differently]
17. Test Scenario:
    - What would ${characterName} do if they witnessed a crime in public? Describe their likely reaction.`;

  const input = [
    ...conversationHistory,
    { role: "user", content: profilePrompt },
  ];

  const response = await callResponsesAPI({
    openai,
    model: OLIVIA_MODEL,
    instructions: instructions || undefined,
    input,
    temperature: 0.3,
    logParams,
  });

  const rawText = extractTextFromOutput(response.output);
  return normalizeCharacterDossierText(rawText);
};

// ---------------------------------------------------------------------------
// Story generation (replaces generateStoryFromOpenAI)
// ---------------------------------------------------------------------------

export const generateStoryFromResponses = async (
  userInput,
  userId,
  res,
  openaiKey,
  instructions = "",
  userEmail = "",
  sceneLimit = 15
) => {
  const openai = getOpenAIClient(openaiKey);
  const prompts = getStoryPrompts(userInput);
  const logParams = userId
    ? { userId, userEmail, endpoint: "generateStory" }
    : undefined;

  // Scene prompts are at indices 2..16 (15 scenes). Limit how many we generate.
  // Index 0 = novel intro, 1 = outline contract, 2..16 = scenes, 17 = blurb, 18 = synopsis.
  const maxPromptIndex = sceneLimit < 15 ? 1 + sceneLimit : prompts.length - 1;

  try {
    const conversationHistory = [];

    for (let i = 0; i <= maxPromptIndex; i++) {
      if (i >= prompts.length || !prompts[i]) continue;
      // Skip blurb/synopsis when generating a limited number of scenes
      if (sceneLimit < 15 && (i === 17 || i === 18)) continue;

      conversationHistory.push({ role: "user", content: prompts[i] });

      let latestMessage;

      // Stream tokens for scene prompts so the frontend can render them in real time.
      // Intro (i=0) and outline contract (i=1) are silent (no SSE write), so keep them
      // non-streaming. Blurb/synopsis (i=17/18) use the existing JSON-parse path below.
      if (i >= 2 && i < 17) {
        let accumulated = "";
        let sceneUsage = null;
        const sceneStream = await openai.responses.create({
          model: OLIVIA_MODEL,
          instructions: instructions || undefined,
          input: conversationHistory,
          tools: [{ type: "code_interpreter", container: { type: "auto" } }],
          temperature: 0.3,
          stream: true,
        });
        for await (const event of sceneStream) {
          if (event.type === "response.output_text.delta" && event.delta) {
            accumulated += event.delta;
            res.write(`data: ${JSON.stringify({ sceneToken: event.delta })}\n\n`);
          }
          if (event.type === "response.completed" && event.response?.usage) {
            sceneUsage = event.response.usage;
          }
        }
        if (logParams && sceneUsage) {
          logApiUsageRaw({
            userId: logParams.userId,
            userEmail: logParams.userEmail,
            endpoint: logParams.endpoint || "generateStory",
            model: OLIVIA_MODEL,
            promptTokens: sceneUsage.input_tokens || 0,
            cachedInputTokens:
              sceneUsage.input_tokens_details?.cached_tokens || 0,
            completionTokens: sceneUsage.output_tokens || 0,
          });
        }
        latestMessage = accumulated;
      } else {
        const response = await callResponsesAPI({
          openai,
          model: OLIVIA_MODEL,
          instructions: instructions || undefined,
          input: conversationHistory,
          tools: [{ type: "code_interpreter", container: { type: "auto" } }],
          temperature: 0.3,
          logParams,
        });
        latestMessage = extractTextFromOutput(response.output);
      }

      conversationHistory.push({ role: "assistant", content: latestMessage });

      let promptKey =
        i === 17 ? "bookblurb" : i === 18 ? "synopsis" : `scene${i - 1}`;

      if (i >= 2) {
        await StoryResponse.findOneAndUpdate(
          { novel: userInput.novelId, user: userId, promptKey },
          { responseText: latestMessage },
          { upsert: true, new: true }
        );
        if (i != 17 && i != 18) {
          const sceneIndex = ((i - 2) % 5) + 1;
          const actNumber = Math.floor((i - 2) / 5) + 1;
          const sceneTitle = await resolveSceneTitleForOutline({
            novelId: userInput.novelId,
            userId,
            promptKey,
            actNumber,
            sceneIndex,
            sceneContent: latestMessage,
          });
          await UserContent.findOneAndUpdate(
            { novelId: userInput.novelId, user: userId, promptKey },
            {
              sceneIndex,
              actNumber,
              sceneTitle,
            },
            { upsert: true, new: true }
          );
        }
      }

      // Stream results via SSE (same format as legacy)
      if (i >= 2) {
        let messageText = latestMessage;
        if (i === 17 || i === 18) {
          try {
            messageText = messageText
              .replace(/^```json/, "")
              .replace(/```$/, "")
              .trim();

            let parsedJson;
            try {
              parsedJson = JSON.parse(messageText);
            } catch (jsonError) {
              parsedJson = { text: messageText };
            }

            res.write(`data: ${JSON.stringify(parsedJson)}\n\n`);
          } catch (error) {
            res.write(
              `data: ${JSON.stringify({ text: messageText })}\n\n`
            );
          }
        } else {
          const responseChunk = { [`scene${i - 1}`]: messageText };
          res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);

          const sceneIdx = ((i - 2) % 5) + 1;
          const actNum = Math.floor((i - 2) / 5) + 1;
          if (sceneIdx === 5) {
            await generateActTitle({
              openai,
              conversationHistory,
              actNumber: actNum,
              novelId: userInput.novelId,
              res,
              instructions,
              logParams,
            });
          }
        }
      }
    }

    // Persist conversation history so scene-by-scene chat can continue from it
    if (sceneLimit < 15 && userInput.novelId) {
      try {
        await Novel.findByIdAndUpdate(userInput.novelId, {
          outlineConversationHistory: conversationHistory,
        });
      } catch (err) {
        console.error("Failed to save outline conversation history:", err.message);
      }
    }

    // After all 15 scenes + blurb + synopsis, generate detailed character profiles
    // for the Olivia flow (masterPrompt present means characters already exist
    // in the DB with only basic info extracted from the prompt).
    if (sceneLimit >= 15 && userInput.masterPrompt) {
      try {
        const characters = await Character.find({
          novel: userInput.novelId,
        }).lean();

        for (const character of characters) {
          const profileText = await generateCharacterProfileFromContext({
            openai,
            conversationHistory,
            characterName: character.name,
            characterRole: character.character,
            characterDescription: character.responseText || "",
            instructions,
            logParams,
          });

          if (profileText) {
            await Character.findByIdAndUpdate(character._id, {
              responseText: profileText,
            });

            res.write(
              `data: ${JSON.stringify({
                characterProfile: {
                  characterId: character._id.toString(),
                  name: character.name,
                  role: character.character,
                },
              })}\n\n`
            );
          }
        }
      } catch (err) {
        console.error("Failed to generate character profiles:", err.message);
      }
    }
  } catch (error) {
    console.error("generateStoryFromResponses error:", error);
    const message = error?.message || "Failed to generate story";
    res.write(
      `data: ${JSON.stringify({ error: message })}\n\n`
    );
  }
};

// ---------------------------------------------------------------------------
// Scene generation from Olivia response (replaces generateScenesFromOliviaResponse)
// ---------------------------------------------------------------------------

export const generateScenesFromResponses = async (
  novelData,
  userId,
  res,
  openaiKey,
  instructions = "",
  userEmail = ""
) => {
  const openai = getOpenAIClient(openaiKey);
  const prompts = getStoryPrompts(novelData);
  const logParams = userId
    ? { userId, userEmail, endpoint: "generateScenes" }
    : undefined;

  try {
    const conversationHistory = [];

    for (let i = 0; i < prompts.length; i++) {
      if (!prompts[i]) continue;

      conversationHistory.push({ role: "user", content: prompts[i] });

      const response = await callResponsesAPI({
        openai,
        model: OLIVIA_MODEL,
        instructions: instructions || undefined,
        input: conversationHistory,
        tools: [{ type: "code_interpreter", container: { type: "auto" } }],
        temperature: 0.3,
        logParams,
      });

      const latestMessage = extractTextFromOutput(response.output);
      conversationHistory.push({ role: "assistant", content: latestMessage });

      let promptKey =
        i === 17 ? "bookblurb" : i === 18 ? "synopsis" : `scene${i - 1}`;

      if (i >= 2) {
        await StoryResponse.findOneAndUpdate(
          { novel: novelData.novelId, user: userId, promptKey },
          { responseText: latestMessage },
          { upsert: true, new: true }
        );
        if (i != 17 && i != 18) {
          const sceneIndex = ((i - 2) % 5) + 1;
          const actNumber = Math.floor((i - 2) / 5) + 1;
          await UserContent.findOneAndUpdate(
            { novelId: novelData.novelId, user: userId, promptKey },
            { sceneIndex: sceneIndex, actNumber: actNumber },
            { upsert: true, new: true }
          );
        }
      }

      if (i >= 2) {
        let messageText = latestMessage;
        if (i === 17 || i === 18) {
          try {
            messageText = messageText
              .replace(/^```json/, "")
              .replace(/```$/, "")
              .trim();

            let parsedJson;
            try {
              parsedJson = JSON.parse(messageText);
            } catch (jsonError) {
              parsedJson = { text: messageText };
            }

            res.write(`data: ${JSON.stringify(parsedJson)}\n\n`);
          } catch (error) {
            res.write(
              `data: ${JSON.stringify({ text: messageText })}\n\n`
            );
          }
        } else {
          const responseChunk = { [`scene${i - 1}`]: messageText };
          res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);

          const sceneIdx = ((i - 2) % 5) + 1;
          const actNum = Math.floor((i - 2) / 5) + 1;
          if (sceneIdx === 5) {
            await generateActTitle({
              openai,
              conversationHistory,
              actNumber: actNum,
              novelId: novelData.novelId,
              res,
              instructions,
              logParams,
            });
          }
        }
      }
    }
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        error: "Failed to generate scenes: " + error.message,
      })}\n\n`
    );
  }
};

// ---------------------------------------------------------------------------
// Character generation (replaces generateCharacterFromOpenAI)
// ---------------------------------------------------------------------------

export const generateCharacterFromResponses = async (
  userInput,
  openaiKey,
  instructions = "",
  userId = null,
  userEmail = ""
) => {
  const openai = getOpenAIClient(openaiKey);
  const prompts = getCharacterPrompts(userInput);
  const logParams = userId
    ? { userId, userEmail, endpoint: "generateCharacter" }
    : undefined;

  try {
    const conversationHistory = [];
    let secondPromptResponse = "";

    for (let i = 0; i < prompts.length; i++) {
      if (!prompts[i]) continue;

      conversationHistory.push({ role: "user", content: prompts[i] });

      const response = await callResponsesAPI({
        openai,
        model: OLIVIA_MODEL,
        instructions: instructions || undefined,
        input: conversationHistory,
        tools: [{ type: "code_interpreter", container: { type: "auto" } }],
        temperature: 0.3,
        logParams,
      });

      const latestMessage = extractTextFromOutput(response.output);
      conversationHistory.push({ role: "assistant", content: latestMessage });

      if (i === 1) {
        secondPromptResponse = latestMessage;
      }
    }

    return normalizeCharacterDossierText(secondPromptResponse);
  } catch (error) {
    throw new Error("Failed to generate character");
  }
};

// ---------------------------------------------------------------------------
// Novel review (replaces reviewByOpenAI)
// ---------------------------------------------------------------------------

export const reviewByResponses = async (
  fileContent,
  openaiKey,
  instructions,
  pillar,
  chapterList,
  novelId,
  userId = null,
  userEmail = ""
) => {
  const openai = getOpenAIClient(openaiKey);
  const logParams = userId
    ? { userId, userEmail, endpoint: "reviewNovel" }
    : undefined;

  const conversationHistory = [];

  conversationHistory.push({
    role: "user",
    content: `${instructions}\n\nHere is the manuscript content to review:\n\n${fileContent}`,
  });

  const firstResponse = await callResponsesAPI({
    openai,
    model: OLIVIA_MODEL,
    input: conversationHistory,
    tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    temperature: 0.3,
    logParams,
  });

  const firstReply = extractTextFromOutput(firstResponse.output);
  conversationHistory.push({ role: "assistant", content: firstReply });

  if (pillar === "evaluation") {
    return firstReply;
  }

  // For other pillars, process chapters one by one
  const chapterReviews = [];
  for (const chapter of chapterList) {
    conversationHistory.push({
      role: "user",
      content: `Please provide respose for: ${chapter.name}. Just provide chapter name as headeing in bold and below that the response as requested.`,
    });

    const chapterResponse = await callResponsesAPI({
      openai,
      model: OLIVIA_MODEL,
      input: conversationHistory,
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
      temperature: 0.3,
      logParams,
    });

    const chapterReview = extractTextFromOutput(chapterResponse.output);
    conversationHistory.push({ role: "assistant", content: chapterReview });

    chapterReviews.push({
      actNumber: chapter.actNumber,
      sceneIndex: chapter.sceneIndex,
      response: chapterReview,
    });
  }

  return chapterReviews;
};

// ---------------------------------------------------------------------------
// Ellis review (replaces ellisReviewByOpenAI)
// ---------------------------------------------------------------------------

export const ellisReviewByResponses = async (
  fileContent,
  openaiKey,
  instructions,
  novelId,
  userId,
  userEmail = ""
) => {
  const openai = getOpenAIClient(openaiKey);
  const logParams = userId
    ? { userId, userEmail, endpoint: "ellisReview" }
    : undefined;

  const input = [
    {
      role: "user",
      content: `${instructions || ""}\n\nPlease read and review the following manuscript. Analyze each scene and provide a JSON response with the following structure: { "scenes": [] }. Each scene object should contain: scene_index (integer), chapter_label (string or null), pov (string or null), scene_status ("Analyzed" or "Not Present in Manuscript"), function_in_story (string), genre_beat_check (string), structure_evaluation ("Keep", "Tighten", "Rewrite", "Move", or "Cut"), character_evaluation ("Keep", "Deepen", or "Rework"), scene_analysis (1-2 editorial paragraphs), and creative_suggestions (array of strings). Respond with valid JSON only.\n\nManuscript content:\n\n${fileContent}`,
    },
  ];

  const response = await callResponsesAPI({
    openai,
    model: ELLIS_MODEL,
    input,
    tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    temperature: 0.3,
    logParams,
  });

  const fullResponse = extractTextFromOutput(response.output);

  let parsedResponse;
  try {
    parsedResponse = parseJSONResponse(fullResponse);
  } catch (error) {
    console.error("Failed to parse Ellis response:", error);
    throw new Error(
      `Failed to parse Ellis response as JSON: ${error.message}`
    );
  }

  if (!parsedResponse.scenes || !Array.isArray(parsedResponse.scenes)) {
    throw new Error("Invalid response structure: missing scenes array");
  }

  if (novelId && userId) {
    await storeEllisSceneReviews(novelId, userId, parsedResponse.scenes);
  }

  return parsedResponse;
};

// ---------------------------------------------------------------------------
// Olivia scenes (replaces oliviaScenesByOpenAI)
// ---------------------------------------------------------------------------

export const oliviaScenesByResponses = async (
  fileContent,
  openaiKey,
  instructions,
  novelId,
  userId,
  userEmail = ""
) => {
  const openai = getOpenAIClient(openaiKey);
  const logParams = userId
    ? { userId, userEmail, endpoint: "oliviaScenes" }
    : undefined;

  const input = [
    {
      role: "user",
      content: `${instructions || ""}\n\nPlease read the following document and design a 15-beat scene outline for the novel. Respond ONLY with valid JSON in the following structure:\n\n{\n  "scenes": [\n    {\n      "scene_index": 1,\n      "book_coaching": "Craft guidance specific to this scene.",\n      "subplot_reminder": "Which subplot(s) are active or should be seeded.",\n      "genre_specific_coaching": "Actual genre + modifiers from document, e.g. Historical Fiction + Dual Timeline: ...",\n      "target_word_count": 6000,\n      "structural_role": "",\n      "what_happens": "High-level summary only, no prose.",\n      "setting": "Environment details and sensory elements.",\n      "significant_actions": "Key events or actions driving the scene.",\n      "protagonist_emotional_shift": "",\n      "emotional_reactions": "Characters' emotional responses.",\n      "plot_advancement": "",\n      "subplot_integration": "" | null,\n      "character_arc_movement": "How the character's arc advances.",\n      "craft_or_coaching_note": ""\n    }\n  ]\n}\n\nRules:\n- "scenes" MUST be an array of exactly 15 objects.\n- Each "scene_index" MUST be an integer from 1 to 15.\n- "genre_specific_coaching" must start with the actual genre + modifiers from the document (e.g. "Historical Fiction + Dual Timeline: ..."). No placeholders.\n- "target_word_count" must be an integer only (e.g. 4500). No prose. Calculated from the novel's total word count divided by 15, with variation based on scene type.\n- Do NOT include any keys other than the ones above in each scene object.\n- Do NOT include any explanatory text before or after the JSON.\n\nDocument content:\n\n${fileContent}`,
    },
  ];

  const response = await callResponsesAPI({
    openai,
    model: OLIVIA_MODEL,
    input,
    tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    temperature: 0.3,
    logParams,
  });

  const fullResponse = extractTextFromOutput(response.output);

  let parsedResponse;
  try {
    parsedResponse = parseJSONResponse(fullResponse);
  } catch (error) {
    console.error("Failed to parse Olivia scenes response:", error);
    throw new Error(
      `Failed to parse Olivia scenes response as JSON: ${error.message}`
    );
  }

  if (!parsedResponse.scenes || !Array.isArray(parsedResponse.scenes)) {
    throw new Error("Invalid response structure: missing scenes array");
  }

  if (novelId && userId) {
    await storeOliviaSceneSuggestions(novelId, userId, parsedResponse.scenes);
  }

  return parsedResponse;
};

// ---------------------------------------------------------------------------
// File content helpers
// ---------------------------------------------------------------------------

/**
 * Read file content as text for inline inclusion in Responses API calls.
 * Used instead of file attachments since the Responses API is stateless.
 */
export const readFileContentAsText = async (fileBuffer, fileName) => {
  // For text-based files, convert buffer to string
  if (
    fileName.endsWith(".txt") ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".json")
  ) {
    return fileBuffer.toString("utf8");
  }

  // For DOCX files, extract text using mammoth
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
    // Strip HTML tags for plain text
    return result.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } catch (error) {
    // Fallback: treat as plain text
    return fileBuffer.toString("utf8");
  }
};

/**
 * Build the content for a single history message, using the Responses API
 * native multi-part input types so the model can read files directly.
 *
 * Returns a plain string when there are no attachments, or an array of
 * content parts (input_text / input_image / input_file) when there are.
 *
 * Attachment handling by type:
 *   image    → input_image  (base64 data URL, detail: "auto")
 *   pdf/doc  → input_file   (base64 data URL — model extracts text + pages)
 */
export const buildMessageContent = async (msg) => {
  const attachments =
    Array.isArray(msg.attachments) && msg.attachments.length > 0
      ? msg.attachments
      : msg.fileUrl
        ? [{ fileUrl: msg.fileUrl, fileType: msg.fileType || "document", fileName: msg.fileName || "" }]
        : [];

  const textContent =
    msg.role === "assistant"
      ? sanitiseModelOutput(msg.content)
      : msg.content;

  if (attachments.length === 0) {
    return textContent;
  }

  // Return cached multi-part content if already built (avoids repeated S3 downloads)
  if (msg.cachedContentParts) {
    return msg.cachedContentParts;
  }

  const contentParts = [{ type: "input_text", text: textContent || "" }];

  for (const att of attachments) {
    const { fileUrl, fileType, fileName } = att;
    const label = fileName || path.basename(fileUrl || "");

    let s3Key = att.fileKey;
    if (!s3Key && fileUrl) {
      try {
        const parsed = new URL(fileUrl);
        s3Key = decodeURIComponent(parsed.pathname.slice(1));
      } catch {
        s3Key = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
      }
    }

    try {
      const buffer = await getFileFromS3(s3Key);
      const b64 = buffer.toString("base64");

      if (fileType === "image") {
        const ext = path.extname(label).toLowerCase().replace(".", "");
        const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] || "image/jpeg";
        contentParts.push({
          type: "input_image",
          detail: "auto",
          image_url: `data:${mime};base64,${b64}`,
        });
      } else {
        const ext = path.extname(label).toLowerCase().replace(".", "");
        const mimeMap = {
          pdf: "application/pdf",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          rtf: "application/rtf",
          txt: "text/plain",
          md: "text/markdown",
          json: "application/json",
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        contentParts.push({
          type: "input_file",
          filename: label,
          file_data: `data:${mime};base64,${b64}`,
        });
      }
    } catch (fetchErr) {
      console.error(`Could not retrieve attachment from S3 (key: ${s3Key}):`, fetchErr.message);
      contentParts.push({
        type: "input_text",
        text: `\n[Attachment "${label}" unavailable: ${fetchErr.message}]`,
      });
    }
  }

  // Persist the built content parts so future requests skip S3 entirely.
  // Fire-and-forget — don't block the response on this write.
  if (msg._id && typeof msg.save === "function") {
    msg.cachedContentParts = contentParts;
    msg.save().catch((err) =>
      console.error("Failed to cache contentParts:", err.message)
    );
  }

  return contentParts;
};
