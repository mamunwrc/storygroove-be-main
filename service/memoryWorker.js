// Olivia memory pipeline — Phase 2 worker.
//
// Small-model extractor pipeline that runs after a scene is delivered or
// finalized. Every exported worker is:
//   - fire-and-forget at the call site (never block the user-facing turn)
//   - idempotent (safe to re-run on the same input)
//   - graceful on failure (logs + leaves prior state intact, never throws
//     into the caller)
//
// All calls go through the cheap `OLIVIA_MEMORY_MODEL` so memory work
// doesn't share a budget with the main Olivia agent.

import OpenAI from "openai";
import https from "https";
import crypto from "crypto";
import { OLIVIA_MEMORY_MODEL } from "../constants/models.js";
import { logApiUsageRaw } from "../utils/logApiUsage.js";
import { parseJSONResponse } from "./openaiService.js";
import SceneMemory from "../models/sceneMemoryModel.js";
import ActiveSceneState from "../models/activeSceneStateModel.js";
import StoryState from "../models/storyStateModel.js";
import CharacterState from "../models/characterStateModel.js";
import EpisodicEvent from "../models/episodicEventModel.js";
import RelationshipEdge from "../models/relationshipEdgeModel.js";

// ---------------------------------------------------------------------------
// OpenAI client + retry helpers
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an async fn with limited retries + exponential backoff. We
 * surrender on 4xx (caller misuse) but retry once on 429 / 5xx /
 * network blips so a single rate-limit ping doesn't drop a row.
 */
const withRetries = async (fn, { retries = 2, baseDelayMs = 250 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.statusCode;
      const transient = !status || status === 429 || status >= 500;
      if (!transient || attempt === retries) throw err;
      await sleep(baseDelayMs * Math.pow(4, attempt));
    }
  }
  throw lastErr;
};

const sha1 = (s) => crypto.createHash("sha1").update(String(s || "")).digest("hex");

/**
 * Extract plain text from a Responses-API output array.
 */
const extractText = (output) =>
  (output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n")
    .trim();

/**
 * Centralized worker-call log line — keeps failure observability cheap
 * to grep for.
 */
const logFailure = (scope, op, novelId, err) => {
  console.error(
    JSON.stringify({
      scope: "memoryWorker",
      worker: scope,
      op,
      novelId: String(novelId || ""),
      error: err?.message || String(err),
    })
  );
};

// ---------------------------------------------------------------------------
// Scene summarizer
// ---------------------------------------------------------------------------

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    pov: { type: "string" },
    summary: { type: "string", description: "≤200-word prose summary" },
    state_changes: {
      type: "array",
      items: { type: "string" },
    },
    unresolved_threads: {
      type: "array",
      items: { type: "string" },
    },
    important_facts: {
      type: "array",
      items: { type: "string" },
    },
    word_count: { type: "integer" },
  },
  required: [
    "title",
    "pov",
    "summary",
    "state_changes",
    "unresolved_threads",
    "important_facts",
    "word_count",
  ],
};

/**
 * Summarize a single finalized scene into a `SceneMemory` row. Safe
 * to call any number of times — upsert keyed on (novelId, sceneRef).
 *
 * On failure: keep the prior row intact, stamp `extractionStatus =
 * "failed"` + `lastFailedAt`. Returns `{ ok: boolean }`.
 */
export const summarizeScene = async ({
  novelId,
  userId,
  userEmail,
  sceneRef,
  rawText,
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !rawText || !openaiKey) {
    return { ok: false, reason: "missing-args" };
  }

  const sourceHash = sha1(rawText);

  try {
    const result = await withRetries(async () => {
      const openai = getOpenAIClient(openaiKey);
      const response = await openai.responses.create({
        model: OLIVIA_MEMORY_MODEL,
        instructions:
          "You are an extractor for an AI writing coach. Given a single scene's prose, output a compact JSON summary. Never invent facts. If a field is unknown, return an empty string or array. Output JSON only.",
        input: [
          {
            role: "user",
            content: `Scene reference: Act ${sceneRef.actNumber}, Scene ${sceneRef.sceneIndex}.\n\nScene content:\n\n${rawText}`,
          },
        ],
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: "SceneSummary",
            schema: SUMMARY_SCHEMA,
            strict: true,
          },
        },
      });

      if (userId && response.usage) {
        logApiUsageRaw({
          userId,
          userEmail,
          endpoint: "olivia-memory-worker:summarizeScene",
          model: OLIVIA_MEMORY_MODEL,
          promptTokens: response.usage.input_tokens || 0,
          cachedInputTokens:
            response.usage.input_tokens_details?.cached_tokens || 0,
          completionTokens: response.usage.output_tokens || 0,
        });
      }

      const raw = extractText(response.output);
      return parseJSONResponse(raw);
    });

    await SceneMemory.findOneAndUpdate(
      {
        novelId,
        "sceneRef.actNumber": sceneRef.actNumber,
        "sceneRef.sceneIndex": sceneRef.sceneIndex,
      },
      {
        $set: {
          novelId,
          userId,
          sceneRef,
          title: result.title || "",
          pov: result.pov || "",
          summary: result.summary || "",
          stateChanges: Array.isArray(result.state_changes)
            ? result.state_changes
            : [],
          unresolvedThreads: Array.isArray(result.unresolved_threads)
            ? result.unresolved_threads
            : [],
          importantFacts: Array.isArray(result.important_facts)
            ? result.important_facts
            : [],
          wordCount: Number(result.word_count) || 0,
          extractionStatus: "ok",
          lastFailedAt: null,
          sourceHash,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return { ok: true };
  } catch (err) {
    logFailure("summarizeScene", "scene-extract", novelId, err);
    // Leave prior row intact; just flip the status flag.
    await SceneMemory.updateOne(
      {
        novelId,
        "sceneRef.actNumber": sceneRef.actNumber,
        "sceneRef.sceneIndex": sceneRef.sceneIndex,
      },
      { $set: { extractionStatus: "failed", lastFailedAt: new Date() } }
    ).catch(() => {});
    return { ok: false, reason: err?.message || "extract-failed" };
  }
};

// ---------------------------------------------------------------------------
// State updater
// ---------------------------------------------------------------------------

const STATE_UPDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    story_state: {
      type: "object",
      additionalProperties: false,
      properties: {
        current_arc: { type: "string" },
        scene_goal: { type: "string" },
        chapter_goal: { type: "string" },
        emotional_state: { type: "string" },
        pacing: { type: "string", enum: ["slow", "medium", "fast", ""] },
        narrative_directives: { type: "array", items: { type: "string" } },
      },
      required: [
        "current_arc",
        "scene_goal",
        "chapter_goal",
        "emotional_state",
        "pacing",
        "narrative_directives",
      ],
    },
    active_scene_state: {
      type: "object",
      additionalProperties: false,
      properties: {
        location: { type: "string" },
        scene_goal: { type: "string" },
        emotional_tone: { type: "string" },
        open_threads: { type: "array", items: { type: "string" } },
        active_character_names: { type: "array", items: { type: "string" } },
      },
      required: [
        "location",
        "scene_goal",
        "emotional_tone",
        "open_threads",
        "active_character_names",
      ],
    },
    character_state_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          character_name: { type: "string" },
          mood: { type: "string" },
          goal: { type: "string" },
          secrets: { type: "array", items: { type: "string" } },
          current_location_hint: { type: "string" },
        },
        required: ["character_name", "mood", "goal", "secrets", "current_location_hint"],
      },
    },
  },
  required: ["story_state", "active_scene_state", "character_state_updates"],
};

/**
 * Extract `StoryState` / `ActiveSceneState` / `CharacterState` updates
 * from a slice of conversation or scene text.
 *
 * `characterLookup` maps `name (lowercased)` → `characterId` so we can
 * write structured `CharacterState` rows when the model returns
 * character names. Names not present in the lookup are silently
 * skipped (better to drop than to invent).
 */
export const extractStateUpdates = async ({
  novelId,
  userId,
  userEmail,
  rawText,
  characterLookup = {},
  sceneRef = null,
  openaiKey,
  source = "chat_turn",
}) => {
  if (!novelId || !rawText || !openaiKey) {
    return { ok: false, reason: "missing-args" };
  }

  let updates;
  try {
    updates = await withRetries(async () => {
      const openai = getOpenAIClient(openaiKey);
      const response = await openai.responses.create({
        model: OLIVIA_MEMORY_MODEL,
        instructions:
          "You extract state for an AI writing coach. Output JSON only. Never invent characters or facts. Empty string / empty array when unknown.",
        input: [
          {
            role: "user",
            content: `Extract the latest story state, active-scene state, and character-state changes from the following text. ${sceneRef ? `Scene context: Act ${sceneRef.actNumber}, Scene ${sceneRef.sceneIndex}.` : ""}\n\n${rawText}`,
          },
        ],
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: "StateUpdates",
            schema: STATE_UPDATE_SCHEMA,
            strict: true,
          },
        },
      });

      if (userId && response.usage) {
        logApiUsageRaw({
          userId,
          userEmail,
          endpoint: "olivia-memory-worker:extractStateUpdates",
          model: OLIVIA_MEMORY_MODEL,
          promptTokens: response.usage.input_tokens || 0,
          cachedInputTokens:
            response.usage.input_tokens_details?.cached_tokens || 0,
          completionTokens: response.usage.output_tokens || 0,
        });
      }
      return parseJSONResponse(extractText(response.output));
    });
  } catch (err) {
    logFailure("extractStateUpdates", "extract", novelId, err);
    return { ok: false, reason: err?.message || "extract-failed" };
  }

  // -----------------------------------------------------------------
  // Apply updates inside `findOneAndUpdate`s so a partial failure on
  // one collection doesn't corrupt another. Each block is independent.
  // -----------------------------------------------------------------
  try {
    const ss = updates.story_state || {};
    const $set = {};
    if (ss.current_arc) $set.currentArc = ss.current_arc;
    if (ss.scene_goal) $set.sceneGoal = ss.scene_goal;
    if (ss.chapter_goal) $set.chapterGoal = ss.chapter_goal;
    if (ss.emotional_state) $set.emotionalState = ss.emotional_state;
    if (ss.pacing && ss.pacing !== "") $set.pacing = ss.pacing;
    if (Array.isArray(ss.narrative_directives) && ss.narrative_directives.length) {
      $set.narrativeDirectives = ss.narrative_directives;
    }
    if (Object.keys($set).length) {
      await StoryState.findOneAndUpdate(
        { novelId },
        { $set, $setOnInsert: { novelId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (err) {
    logFailure("extractStateUpdates", "story-state", novelId, err);
  }

  try {
    const ass = updates.active_scene_state || {};
    const characterIds = (ass.active_character_names || [])
      .map((n) => characterLookup[(n || "").toLowerCase().trim()])
      .filter(Boolean);

    const $set = {
      lastUpdatedSource: source,
    };
    if (ass.location) $set.location = ass.location;
    if (ass.scene_goal) $set.sceneGoal = ass.scene_goal;
    if (ass.emotional_tone) $set.emotionalTone = ass.emotional_tone;
    if (Array.isArray(ass.open_threads) && ass.open_threads.length) {
      $set.openThreads = ass.open_threads;
    }
    if (characterIds.length) $set.activeCharacterIds = characterIds;
    if (sceneRef) $set.currentScene = sceneRef;

    await ActiveSceneState.findOneAndUpdate(
      { novelId },
      { $set, $setOnInsert: { novelId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    logFailure("extractStateUpdates", "active-scene-state", novelId, err);
  }

  try {
    for (const cs of updates.character_state_updates || []) {
      const cid = characterLookup[(cs.character_name || "").toLowerCase().trim()];
      if (!cid) continue;
      const $set = {};
      if (cs.mood) $set.mood = cs.mood;
      if (cs.goal) $set.goal = cs.goal;
      if (Array.isArray(cs.secrets) && cs.secrets.length) $set.secrets = cs.secrets;
      if (cs.current_location_hint) $set.currentLocationHint = cs.current_location_hint;
      if (sceneRef) $set.lastSeenSceneRef = sceneRef;
      if (!Object.keys($set).length) continue;

      await CharacterState.findOneAndUpdate(
        { novelId, characterId: cid },
        { $set, $setOnInsert: { novelId, characterId: cid } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (err) {
    logFailure("extractStateUpdates", "character-state", novelId, err);
  }

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Episodic-event extractor
// ---------------------------------------------------------------------------

const EPISODIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          event_type: {
            type: "string",
            enum: [
              "death",
              "betrayal",
              "revelation",
              "reunion",
              "promise",
              "loss",
              "transformation",
              "other",
            ],
          },
          summary: { type: "string" },
          character_names: { type: "array", items: { type: "string" } },
          importance: { type: "integer", minimum: 1, maximum: 10 },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["event_type", "summary", "character_names", "importance", "tags"],
      },
    },
  },
  required: ["events"],
};

export const extractEpisodicEvents = async ({
  novelId,
  userId,
  userEmail,
  sceneRef,
  rawText,
  characterLookup = {},
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !rawText || !openaiKey) {
    return { ok: false, reason: "missing-args" };
  }

  let payload;
  try {
    payload = await withRetries(async () => {
      const openai = getOpenAIClient(openaiKey);
      const response = await openai.responses.create({
        model: OLIVIA_MEMORY_MODEL,
        instructions:
          "You extract zero-or-more high-importance story events from a single scene. Output JSON only. Never invent. If the scene has no event worth memorializing, return { \"events\": [] }.",
        input: [
          {
            role: "user",
            content: `Scene reference: Act ${sceneRef.actNumber}, Scene ${sceneRef.sceneIndex}.\n\n${rawText}`,
          },
        ],
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: "EpisodicEvents",
            schema: EPISODIC_SCHEMA,
            strict: true,
          },
        },
      });

      if (userId && response.usage) {
        logApiUsageRaw({
          userId,
          userEmail,
          endpoint: "olivia-memory-worker:extractEpisodicEvents",
          model: OLIVIA_MEMORY_MODEL,
          promptTokens: response.usage.input_tokens || 0,
          cachedInputTokens:
            response.usage.input_tokens_details?.cached_tokens || 0,
          completionTokens: response.usage.output_tokens || 0,
        });
      }
      return parseJSONResponse(extractText(response.output));
    });
  } catch (err) {
    logFailure("extractEpisodicEvents", "extract", novelId, err);
    return { ok: false, reason: err?.message || "extract-failed" };
  }

  try {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const ev of events) {
      if (!ev.summary) continue;
      const characterIds = (ev.character_names || [])
        .map((n) => characterLookup[(n || "").toLowerCase().trim()])
        .filter(Boolean);

      const derivedFromHash = sha1(`${sceneRef.actNumber}/${sceneRef.sceneIndex}|${ev.event_type}|${ev.summary}`);

      await EpisodicEvent.findOneAndUpdate(
        {
          novelId,
          "sceneRef.actNumber": sceneRef.actNumber,
          "sceneRef.sceneIndex": sceneRef.sceneIndex,
          derivedFromHash,
        },
        {
          $set: {
            novelId,
            sceneRef,
            eventType: ev.event_type || "other",
            summary: ev.summary,
            characterIds,
            importance: Math.max(1, Math.min(10, Number(ev.importance) || 5)),
            tags: Array.isArray(ev.tags) ? ev.tags : [],
            extractionStatus: "ok",
            derivedFromHash,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return { ok: true, count: events.length };
  } catch (err) {
    logFailure("extractEpisodicEvents", "persist", novelId, err);
    return { ok: false, reason: err?.message || "persist-failed" };
  }
};

// ---------------------------------------------------------------------------
// Relationship-edge updater
// ---------------------------------------------------------------------------

const EDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          src_name: { type: "string" },
          dst_name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "trust",
              "affection",
              "enmity",
              "family",
              "professional",
              "romantic",
              "unknown",
            ],
          },
          sentiment_delta: { type: "integer", minimum: -100, maximum: 100 },
          trust_delta: { type: "integer", minimum: -100, maximum: 100 },
          evidence: { type: "string" },
        },
        required: [
          "src_name",
          "dst_name",
          "type",
          "sentiment_delta",
          "trust_delta",
          "evidence",
        ],
      },
    },
  },
  required: ["edges"],
};

/** Skip writes whose absolute delta is below this threshold (anti-thrash). */
const MIN_EDGE_DELTA = 5;

export const updateRelationshipEdges = async ({
  novelId,
  userId,
  userEmail,
  sceneRef,
  rawText,
  characterLookup = {},
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !rawText || !openaiKey) {
    return { ok: false, reason: "missing-args" };
  }

  let payload;
  try {
    payload = await withRetries(async () => {
      const openai = getOpenAIClient(openaiKey);
      const response = await openai.responses.create({
        model: OLIVIA_MEMORY_MODEL,
        instructions:
          "You detect changes to character relationships from a single scene. Output JSON only. Use integer deltas in -100..100 (positive = strengthen the trust/affection/etc., negative = damage). Return { \"edges\": [] } if no meaningful change.",
        input: [
          {
            role: "user",
            content: `Scene reference: Act ${sceneRef.actNumber}, Scene ${sceneRef.sceneIndex}.\n\n${rawText}`,
          },
        ],
        temperature: 0.2,
        text: {
          format: {
            type: "json_schema",
            name: "RelationshipDeltas",
            schema: EDGE_SCHEMA,
            strict: true,
          },
        },
      });

      if (userId && response.usage) {
        logApiUsageRaw({
          userId,
          userEmail,
          endpoint: "olivia-memory-worker:updateRelationshipEdges",
          model: OLIVIA_MEMORY_MODEL,
          promptTokens: response.usage.input_tokens || 0,
          cachedInputTokens:
            response.usage.input_tokens_details?.cached_tokens || 0,
          completionTokens: response.usage.output_tokens || 0,
        });
      }
      return parseJSONResponse(extractText(response.output));
    });
  } catch (err) {
    logFailure("updateRelationshipEdges", "extract", novelId, err);
    return { ok: false, reason: err?.message || "extract-failed" };
  }

  try {
    const edges = Array.isArray(payload?.edges) ? payload.edges : [];
    for (const e of edges) {
      const srcId = characterLookup[(e.src_name || "").toLowerCase().trim()];
      const dstId = characterLookup[(e.dst_name || "").toLowerCase().trim()];
      if (!srcId || !dstId || String(srcId) === String(dstId)) continue;

      const sentimentDelta = Number(e.sentiment_delta) || 0;
      const trustDelta = Number(e.trust_delta) || 0;
      if (
        Math.abs(sentimentDelta) < MIN_EDGE_DELTA &&
        Math.abs(trustDelta) < MIN_EDGE_DELTA
      ) {
        continue;
      }

      const existing = await RelationshipEdge.findOne({
        novelId,
        srcCharacterId: srcId,
        dstCharacterId: dstId,
        type: e.type || "unknown",
      });

      // lastUpdatedSceneRef gate: an older scene cannot overwrite newer state.
      if (existing?.lastUpdatedSceneRef) {
        const last = existing.lastUpdatedSceneRef;
        const lastKey = (last.actNumber || 0) * 100 + (last.sceneIndex || 0);
        const thisKey = (sceneRef.actNumber || 0) * 100 + (sceneRef.sceneIndex || 0);
        if (lastKey > thisKey) continue;
      }

      const nextSentiment = Math.max(
        -100,
        Math.min(100, (existing?.sentiment || 0) + sentimentDelta)
      );
      const nextTrust = Math.max(
        0,
        Math.min(100, (existing?.trust ?? 50) + trustDelta)
      );

      await RelationshipEdge.findOneAndUpdate(
        {
          novelId,
          srcCharacterId: srcId,
          dstCharacterId: dstId,
          type: e.type || "unknown",
        },
        {
          $set: {
            sentiment: nextSentiment,
            trust: nextTrust,
            lastUpdatedSceneRef: sceneRef,
          },
          $push: {
            evidenceSceneRefs: {
              actNumber: sceneRef.actNumber,
              sceneIndex: sceneRef.sceneIndex,
            },
          },
          $setOnInsert: {
            novelId,
            srcCharacterId: srcId,
            dstCharacterId: dstId,
            type: e.type || "unknown",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return { ok: true, count: edges.length };
  } catch (err) {
    logFailure("updateRelationshipEdges", "persist", novelId, err);
    return { ok: false, reason: err?.message || "persist-failed" };
  }
};

// ---------------------------------------------------------------------------
// One-stop convenience hook for scene close
// ---------------------------------------------------------------------------

/**
 * Fan out all per-scene workers in parallel. Each worker handles its
 * own retries + persistence + failure logging; we never throw out of
 * this function. Designed to be invoked from `saveOliviaScene` with
 * `setImmediate` so the user-facing response is never blocked.
 */
export const onSceneClosed = async ({
  novelId,
  userId,
  userEmail,
  sceneRef,
  rawText,
  characterLookup = {},
  openaiKey,
}) => {
  if (!novelId || !sceneRef || !rawText || !openaiKey) return;

  await Promise.allSettled([
    summarizeScene({ novelId, userId, userEmail, sceneRef, rawText, openaiKey }),
    extractStateUpdates({
      novelId,
      userId,
      userEmail,
      rawText,
      characterLookup,
      sceneRef,
      openaiKey,
      source: "scene_close",
    }),
    extractEpisodicEvents({
      novelId,
      userId,
      userEmail,
      sceneRef,
      rawText,
      characterLookup,
      openaiKey,
    }),
    updateRelationshipEdges({
      novelId,
      userId,
      userEmail,
      sceneRef,
      rawText,
      characterLookup,
      openaiKey,
    }),
  ]);
};

export const _internal = { sha1, MIN_EDGE_DELTA };
