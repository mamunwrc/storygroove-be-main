/**
 * Phase 2 — Olivia memory invalidator.
 *
 * Central place where mutations against scenes / characters / the
 * novel doc decide *which* memory rows are now stale, and how the
 * worker should refresh them. Controllers call into these helpers
 * instead of touching memory collections directly — keeps the rules
 * in one auditable file.
 *
 * Invariants:
 *   - Every entry point is **fire-and-forget**: returns void / a
 *     Promise<void>, never throws into the caller. The caller's user
 *     response must not be delayed by memory housekeeping.
 *   - Worker fan-out goes through the Phase-4 `memoryQueue` (per-novel
 *     serialization) so two near-simultaneous edits on the same novel
 *     can't race on `StoryState` / `RelationshipEdge` updates.
 *   - Structural memory edits do **not** invalidate the OpenAI
 *     `previous_response_id` chain. We let the chain continue and
 *     rely on the per-turn `memoryBlockMessage` (assembled fresh) to
 *     communicate the updated state. Only an explicit checkpoint
 *     restore (Phase 3) or admin "reset chat" calls
 *     `memoryService.invalidateResponseChain`.
 *   - The Phase-4 assembler cache is invalidated for the touched
 *     novel so the next chat turn re-reads from Mongo. Filtering is
 *     done via predicate on the cache key (which starts with
 *     `${novelId}|...`).
 */

import crypto from "node:crypto";

import SceneMemory from "../models/sceneMemoryModel.js";
import EpisodicEvent from "../models/episodicEventModel.js";
import ActiveSceneState from "../models/activeSceneStateModel.js";
import CharacterState from "../models/characterStateModel.js";
import RelationshipEdge from "../models/relationshipEdgeModel.js";
import StoryState from "../models/storyStateModel.js";
import Character from "../models/characterModel.js";

import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";
import { invalidateAssemblerCache } from "./contextAssembler.js";
import { enqueueFireAndForget as enqueueMemoryJob } from "./memoryQueue.js";
import {
  summarizeScene,
  extractStateUpdates,
  extractEpisodicEvents,
  updateRelationshipEdges,
} from "./memoryWorker.js";
import { purgeSceneFromVectorStore } from "../utils/provisionNovelVectorStore.js";
import { isOliviaNovelVectorStoreEnabled } from "../constants/oliviaMemory.js";

const sha1 = (s) => crypto.createHash("sha1").update(s || "").digest("hex");

/**
 * Drop any assembler cache entries that belong to this novel. The
 * cache key format is `${novelId}|${userId}|...` so we match on the
 * `novelId|` prefix.
 */
const dropAssemblerCacheForNovel = (novelId) => {
  if (!novelId) return;
  const prefix = `${String(novelId)}|`;
  invalidateAssemblerCache((key) => key.startsWith(prefix));
};

/**
 * Resolve a `characterLookup` map for memory-worker calls. Falls back
 * to an empty object — workers handle missing IDs gracefully.
 */
const loadCharacterLookup = async (novelId) => {
  try {
    const characters = await Character.find({ novel: novelId })
      .select("_id name aliases")
      .lean();
    const out = {};
    for (const c of characters) {
      if (c?.name) out[c.name.toLowerCase().trim()] = String(c._id);
      for (const a of c?.aliases || []) {
        if (a) out[a.toLowerCase().trim()] = String(c._id);
      }
    }
    return out;
  } catch (err) {
    console.warn(
      "memoryInvalidator: loadCharacterLookup failed (non-blocking):",
      err?.message || err
    );
    return {};
  }
};

// ---------------------------------------------------------------------------
// Scene-level mutations
// ---------------------------------------------------------------------------

/**
 * A scene's prose changed. If the SHA-1 of the new text matches the
 * stored `sourceHash`, this is a no-op (saves the model fan-out for
 * cosmetic re-saves). Otherwise we mark dependent rows stale and
 * enqueue a re-extraction.
 *
 * @param {Object}  args
 * @param {string}  args.novelId
 * @param {string}  args.userId
 * @param {string=} args.userEmail   For logging only.
 * @param {Object}  args.sceneRef    `{ actNumber, sceneIndex, promptKey? }`
 * @param {string}  args.newText
 * @param {string=} args.openaiKey   If absent, the enqueued workers
 *                                   skip themselves (graceful).
 */
export const onSceneEdit = async ({
  novelId,
  userId,
  userEmail,
  sceneRef,
  newText,
  openaiKey,
}) => {
  if (!novelId || !sceneRef || typeof newText !== "string") return;

  const newHash = sha1(newText);

  try {
    const prior = await SceneMemory.findOne({
      novelId,
      "sceneRef.actNumber": sceneRef.actNumber,
      "sceneRef.sceneIndex": sceneRef.sceneIndex,
    })
      .select("sourceHash")
      .lean();
    if (prior?.sourceHash === newHash) {
      // Cosmetic re-save (whitespace fixup, etc.). Skip.
      return;
    }

    // Mark scene + dependent episodic rows stale so the assembler can
    // signal "this slice is being refreshed" to the model.
    await Promise.allSettled([
      SceneMemory.updateOne(
        {
          novelId,
          "sceneRef.actNumber": sceneRef.actNumber,
          "sceneRef.sceneIndex": sceneRef.sceneIndex,
        },
        { $set: { extractionStatus: "stale" } }
      ),
      EpisodicEvent.updateMany(
        {
          novelId,
          "sceneRef.actNumber": sceneRef.actNumber,
          "sceneRef.sceneIndex": sceneRef.sceneIndex,
        },
        { $set: { extractionStatus: "stale" } }
      ),
    ]);

    dropAssemblerCacheForNovel(novelId);

    if (!openaiKey) return; // Worker fan-out needs the key.

    const characterLookup = await loadCharacterLookup(novelId);
    enqueueMemoryJob({
      key: String(novelId),
      label: `sceneEdit:A${sceneRef.actNumber}/S${sceneRef.sceneIndex}`,
      run: async () => {
        const active = await ActiveSceneState.findOne({ novelId })
          .select("currentScene")
          .lean();
        const isCurrentScene =
          active?.currentScene?.actNumber === sceneRef.actNumber &&
          active?.currentScene?.sceneIndex === sceneRef.sceneIndex;

        await Promise.allSettled([
          summarizeScene({
            novelId,
            userId,
            userEmail,
            sceneRef,
            rawText: newText,
            openaiKey,
          }),
          extractEpisodicEvents({
            novelId,
            userId,
            userEmail,
            sceneRef,
            rawText: newText,
            characterLookup,
            openaiKey,
          }),
          updateRelationshipEdges({
            novelId,
            userId,
            userEmail,
            sceneRef,
            rawText: newText,
            characterLookup,
            openaiKey,
          }),
          // Only re-derive live-state if this WAS the active scene
          // — otherwise we'd overwrite the writer's current focus.
          isCurrentScene
            ? extractStateUpdates({
                novelId,
                userId,
                userEmail,
                rawText: newText,
                characterLookup,
                sceneRef,
                openaiKey,
                source: "scene_close",
              })
            : Promise.resolve(),
        ]);
      },
    });
  } catch (err) {
    console.error(
      "memoryInvalidator.onSceneEdit failed (non-blocking):",
      err?.message || err
    );
  }
};

/**
 * Scene deleted. Soft-delete its memory + episodic rows and prune
 * any `RelationshipEdge.evidenceSceneRefs` that point at it. If it
 * was the active scene, clear `ActiveSceneState.currentScene`.
 *
 * Also fires `purgeSceneFromVectorStore` so the per-novel hosted
 * vector store (Phase 3) doesn't keep recalling deleted content.
 */
export const onSceneDelete = async ({
  novelId,
  sceneRef,
  openaiKey,
}) => {
  if (!novelId || !sceneRef) return;

  try {
    await Promise.allSettled([
      SceneMemory.deleteOne({
        novelId,
        "sceneRef.actNumber": sceneRef.actNumber,
        "sceneRef.sceneIndex": sceneRef.sceneIndex,
      }),
      EpisodicEvent.deleteMany({
        novelId,
        "sceneRef.actNumber": sceneRef.actNumber,
        "sceneRef.sceneIndex": sceneRef.sceneIndex,
      }),
      RelationshipEdge.updateMany(
        { novelId },
        {
          $pull: {
            evidenceSceneRefs: {
              actNumber: sceneRef.actNumber,
              sceneIndex: sceneRef.sceneIndex,
            },
          },
        }
      ),
    ]);

    // If this was the active scene, blank that out so the next chat
    // turn doesn't try to anchor to a deleted reference.
    await ActiveSceneState.updateOne(
      {
        novelId,
        "currentScene.actNumber": sceneRef.actNumber,
        "currentScene.sceneIndex": sceneRef.sceneIndex,
      },
      {
        $set: { currentScene: null, lastUpdatedSource: "scene_close" },
      }
    );

    dropAssemblerCacheForNovel(novelId);

    if (openaiKey && isOliviaNovelVectorStoreEnabled()) {
      enqueueMemoryJob({
        key: String(novelId),
        label: `sceneDelete:A${sceneRef.actNumber}/S${sceneRef.sceneIndex}:vs-purge`,
        run: () =>
          purgeSceneFromVectorStore({
            novelId,
            sceneRef,
            openaiKey,
          }),
      });
    }
  } catch (err) {
    console.error(
      "memoryInvalidator.onSceneDelete failed (non-blocking):",
      err?.message || err
    );
  }
};

/**
 * A previously-deleted scene was restored. Treat as an edit so the
 * worker re-summarizes from canonical text and the assembler picks
 * up the row again.
 */
export const onSceneRestore = (args) => onSceneEdit(args);

/**
 * Sidebar scene title renamed. Patch SceneMemory.title only — no full
 * re-extraction (rename is cosmetic relative to prose).
 *
 * @param {Object} args
 * @param {string} args.novelId
 * @param {Object} args.sceneRef `{ actNumber, sceneIndex, promptKey? }`
 * @param {string} args.newTitle
 */
export const onSceneRename = async ({ novelId, sceneRef, newTitle }) => {
  if (!novelId || !sceneRef || typeof newTitle !== "string") return;

  const title = newTitle.trim();
  if (!title) return;

  try {
    const filter = {
      novelId,
      "sceneRef.actNumber": sceneRef.actNumber,
      "sceneRef.sceneIndex": sceneRef.sceneIndex,
    };
    if (sceneRef.promptKey) {
      filter["sceneRef.promptKey"] = sceneRef.promptKey;
    }

    await SceneMemory.updateOne(filter, { $set: { title } });
    dropAssemblerCacheForNovel(novelId);
  } catch (err) {
    console.error(
      "memoryInvalidator.onSceneRename failed (non-blocking):",
      err?.message || err
    );
  }
};

// ---------------------------------------------------------------------------
// Character-level mutations
// ---------------------------------------------------------------------------

/**
 * Character dossier edited. Don't blow away mood/goal right away —
 * dossier prose rarely invalidates live state. Just bump the
 * `CharacterState.memoryVersion` so the next `extractStateUpdates`
 * call (which fires on the next scene close) refreshes the row.
 */
export const onCharacterEdit = async ({ novelId, characterId }) => {
  if (!novelId || !characterId) return;
  try {
    await CharacterState.updateOne(
      { novelId, characterId },
      { $set: { memoryVersion: MEMORY_SCHEMA_VERSION - 1 } } // mark "behind"
    );
    dropAssemblerCacheForNovel(novelId);
  } catch (err) {
    console.error(
      "memoryInvalidator.onCharacterEdit failed (non-blocking):",
      err?.message || err
    );
  }
};

/**
 * Character deleted. Cascade across every memory row that references
 * this character so the assembler doesn't surface a ghost name.
 */
export const onCharacterDelete = async ({ novelId, characterId }) => {
  if (!novelId || !characterId) return;
  try {
    await Promise.allSettled([
      CharacterState.deleteOne({ novelId, characterId }),
      RelationshipEdge.deleteMany({
        novelId,
        $or: [{ srcCharacterId: characterId }, { dstCharacterId: characterId }],
      }),
      ActiveSceneState.updateOne(
        { novelId },
        { $pull: { activeCharacterIds: characterId } }
      ),
      EpisodicEvent.updateMany(
        { novelId, characterIds: characterId },
        { $set: { extractionStatus: "stale" } }
      ),
    ]);

    dropAssemblerCacheForNovel(novelId);
  } catch (err) {
    console.error(
      "memoryInvalidator.onCharacterDelete failed (non-blocking):",
      err?.message || err
    );
  }
};

// ---------------------------------------------------------------------------
// Novel-level mutations
// ---------------------------------------------------------------------------

const NOVEL_FIELDS_FORCING_REFRESH = [
  "masterPrompt",
  "storyBible",
  "acts",
  "narrativeStyle",
  "supportingCharacters",
  "genre",
];

/**
 * Novel doc edited. We only force a refresh when one of the
 * narrative-shaping fields changed — cosmetic updates (cover image,
 * title rename) don't justify re-extraction.
 *
 * Important: we do **not** invalidate `lastResponseId`. The OpenAI
 * chain still represents what Olivia said; the next turn's
 * `memoryBlockMessage` will surface the new state.
 */
export const onNovelEdit = async ({ novelId, fieldsChanged = [] }) => {
  if (!novelId) return;
  try {
    const matters = fieldsChanged.some((f) =>
      NOVEL_FIELDS_FORCING_REFRESH.includes(f)
    );
    if (!matters) {
      // Still drop the assembler cache so the next turn re-reads
      // (cheap) — but skip the version bump.
      dropAssemblerCacheForNovel(novelId);
      return;
    }
    // Force one-time refresh on next scene close by bumping below the
    // current schema version. The worker's `findOneAndUpdate` upsert
    // path will then write fresh values + the current version.
    await StoryState.updateOne(
      { novelId },
      { $set: { memoryVersion: MEMORY_SCHEMA_VERSION - 1 } }
    );
    dropAssemblerCacheForNovel(novelId);
  } catch (err) {
    console.error(
      "memoryInvalidator.onNovelEdit failed (non-blocking):",
      err?.message || err
    );
  }
};

// ---------------------------------------------------------------------------
// Layering phase transitions
// ---------------------------------------------------------------------------

/**
 * Writer crossed a layering-phase boundary (e.g. `phase1_table` →
 * `phase2_expansion`). Writes the new value, drops the assembler
 * cache so the next turn picks up the new phase rules from the
 * methodology service, and — when entering `drafting` — clears any
 * lingering `pendingCompression` flags so the rolling-summary worker
 * can run again.
 */
export const onLayeringPhaseTransition = async ({ novelId, newPhase }) => {
  if (!novelId || !newPhase) return;
  try {
    await StoryState.updateOne(
      { novelId },
      { $set: { layeringPhase: newPhase } },
      { upsert: true }
    );
    dropAssemblerCacheForNovel(novelId);

    if (newPhase === "drafting") {
      // Best-effort import so we don't carry a circular dep at module
      // load time — invalidator and memoryService both reference each
      // other's types via the worker pipeline.
      const { default: ConversationCursor } = await import(
        "../models/conversationCursorModel.js"
      );
      await ConversationCursor.updateMany(
        { novelId, pendingCompression: true },
        { $set: { pendingCompression: false } }
      );
    }
  } catch (err) {
    console.error(
      "memoryInvalidator.onLayeringPhaseTransition failed (non-blocking):",
      err?.message || err
    );
  }
};

export const _internal = { sha1, dropAssemblerCacheForNovel, loadCharacterLookup };
