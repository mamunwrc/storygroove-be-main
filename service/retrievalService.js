// Olivia memory pipeline — Phase 3 retrieval orchestrator.
//
// One service that the context assembler can swap in to replace its
// in-process Mongo queries. Combines three retrieval signals:
//
//   1. Temporal + importance — top EpisodicEvents by the ranking
//      formula in `constants/memoryRanking.js`.
//   2. Character overlap — events / edges touching the focus
//      characters.
//   3. Graph — multi-hop traversal over RelationshipEdge to surface
//      neighbours of the focus characters (depth ≤ 2).
//
// Semantic retrieval (vector store `file_search`) happens at the
// MODEL layer, not in this service — we hand the per-novel
// `vectorStoreId` back so the controller's tools list picks it up.
//
// All collection reads are cheap projections; the assembler can call
// this on every turn without measurable cost.

import EpisodicEvent from "../models/episodicEventModel.js";
import RelationshipEdge from "../models/relationshipEdgeModel.js";
import SceneMemory from "../models/sceneMemoryModel.js";
import Novel from "../models/novelModel.js";
import {
  scoreEpisodicEvent,
  scoreRelationshipEdge,
  TOP_K_EPISODIC,
  TOP_K_EDGES,
} from "../constants/memoryRanking.js";
import { excludeArchivedSceneRefs } from "../utils/archivedScenes.js";

// ---------------------------------------------------------------------------
// Graph helpers (`phase3-relationship-edge` second half)
// ---------------------------------------------------------------------------

/**
 * Return the set of character ids reachable from `startCharacterId`
 * along `RelationshipEdge` rows within `depth` hops. `depth` is
 * capped at 2 to avoid pulling the whole graph on dense novels.
 *
 * The result includes the starting id at depth 0.
 */
export const traverseRelationships = async ({
  novelId,
  startCharacterId,
  depth = 1,
}) => {
  if (!novelId || !startCharacterId) return new Set();
  const cappedDepth = Math.max(0, Math.min(2, Number(depth) || 0));

  const visited = new Set([String(startCharacterId)]);
  if (cappedDepth === 0) return visited;

  let frontier = new Set([String(startCharacterId)]);

  for (let d = 0; d < cappedDepth; d++) {
    if (frontier.size === 0) break;
    const ids = Array.from(frontier).map(String);
    const edges = await RelationshipEdge.find({
      novelId,
      $or: [
        { srcCharacterId: { $in: ids } },
        { dstCharacterId: { $in: ids } },
      ],
    })
      .select("srcCharacterId dstCharacterId")
      .lean();

    const next = new Set();
    for (const e of edges) {
      const a = String(e.srcCharacterId);
      const b = String(e.dstCharacterId);
      if (!visited.has(a)) {
        visited.add(a);
        next.add(a);
      }
      if (!visited.has(b)) {
        visited.add(b);
        next.add(b);
      }
    }
    frontier = next;
  }

  return visited;
};

/**
 * Return episodic events whose character cast intersects the set of
 * characters connected to any focus character within `depth` hops.
 * Used by `retrieveRelevant` to surface "people connected to X"
 * events that pure overlap scoring would miss.
 */
export const getRelatedEvents = async ({
  novelId,
  characterIds = [],
  depth = 1,
  limit = 50,
}) => {
  if (!novelId || !Array.isArray(characterIds) || characterIds.length === 0) {
    return [];
  }

  // Union the reachable sets for each focus character.
  const reachable = new Set();
  for (const id of characterIds) {
    const set = await traverseRelationships({
      novelId,
      startCharacterId: id,
      depth,
    });
    for (const x of set) reachable.add(x);
  }

  if (reachable.size === 0) return [];

  return EpisodicEvent.find({
    novelId,
    extractionStatus: "ok",
    characterIds: { $in: Array.from(reachable) },
  })
    .sort({ "sceneRef.actNumber": -1, "sceneRef.sceneIndex": -1, importance: -1 })
    .limit(limit)
    .lean();
};

// ---------------------------------------------------------------------------
// Retrieval orchestrator
// ---------------------------------------------------------------------------

/**
 * Build the merged retrieval result the assembler will consume.
 *
 * Inputs:
 *   - novelId
 *   - userMessage    — used by the ranking formula's `explicit`
 *                      mention scorer.
 *   - focusScene     — { actNumber, sceneIndex } | null
 *   - focusCharacterIds — string[] of Character `_id`s relevant to
 *                      this turn.
 *   - storyState     — optional `StoryState` lean doc (powers the
 *                      `arc` ranking term).
 *   - excludeSceneRefs — Set of `"act:scene"` keys for archived outline
 *                      slots; matching SceneMemory and EpisodicEvent
 *                      rows are dropped.
 *
 * Outputs:
 *   {
 *     episodicEvents: top-K events,
 *     relationshipEdges: top-K edges (anchored to focus characters),
 *     sceneSlice: ±2 SceneMemory rows around focus,
 *     novelVectorStoreId: string | null,
 *   }
 */
export const retrieveRelevant = async ({
  novelId,
  userMessage = "",
  focusScene = null,
  focusCharacterIds = [],
  storyState = null,
  episodicLimit = TOP_K_EPISODIC,
  edgeLimit = TOP_K_EDGES,
  excludeSceneRefs = null,
} = {}) => {
  if (!novelId) {
    return {
      episodicEvents: [],
      relationshipEdges: [],
      sceneSlice: [],
      novelVectorStoreId: null,
    };
  }

  const focusSet = new Set(focusCharacterIds.map(String));

  // Pull candidates in parallel — keep limits generous so the
  // ranking step has something to choose from.
  const [candidateEvents, candidateEdges, sceneSlice, novel] = await Promise.all([
    // Combine "direct overlap" events with "graph-reachable" events.
    // We over-fetch and let the ranker prune.
    EpisodicEvent.find({
      novelId,
      extractionStatus: "ok",
      ...(focusSet.size
        ? { characterIds: { $in: Array.from(focusSet) } }
        : {}),
    })
      .sort({ "sceneRef.actNumber": -1, "sceneRef.sceneIndex": -1, importance: -1 })
      .limit(50)
      .lean(),
    RelationshipEdge.find({
      novelId,
      ...(focusSet.size
        ? {
            $or: [
              { srcCharacterId: { $in: Array.from(focusSet) } },
              { dstCharacterId: { $in: Array.from(focusSet) } },
            ],
          }
        : {}),
    })
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean(),
    (async () => {
      if (!focusScene?.actNumber || !focusScene?.sceneIndex) {
        return SceneMemory.find({ novelId })
          .sort({ "sceneRef.actNumber": -1, "sceneRef.sceneIndex": -1 })
          .limit(3)
          .lean();
      }
      return SceneMemory.find({
        novelId,
        "sceneRef.actNumber": focusScene.actNumber,
        "sceneRef.sceneIndex": {
          $gte: focusScene.sceneIndex - 2,
          $lte: focusScene.sceneIndex + 2,
        },
      })
        .sort({ "sceneRef.sceneIndex": 1 })
        .lean();
    })(),
    Novel.findById(novelId).select("oliviaSceneMemoryVectorStoreId").lean(),
  ]);

  // Augment with 1-hop graph events (when we have focus characters).
  let mergedEvents = candidateEvents;
  if (focusSet.size > 0) {
    const graphEvents = await getRelatedEvents({
      novelId,
      characterIds: Array.from(focusSet),
      depth: 1,
      limit: 50,
    });
    const byId = new Map(mergedEvents.map((e) => [String(e._id), e]));
    for (const e of graphEvents) {
      if (!byId.has(String(e._id))) byId.set(String(e._id), e);
    }
    mergedEvents = Array.from(byId.values());
  }

  const ctx = {
    focusSceneRef: focusScene,
    focusCharacterIds,
    storyState,
    userMessage,
  };

  const rankedEvents = excludeArchivedSceneRefs(mergedEvents, excludeSceneRefs)
    .map((e) => ({ event: e, score: scoreEpisodicEvent(e, ctx) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, episodicLimit)
    .map((x) => x.event);

  const rankedEdges = candidateEdges
    .map((e) => ({ edge: e, score: scoreRelationshipEdge(e, ctx) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, edgeLimit)
    .map((x) => x.edge);

  return {
    episodicEvents: rankedEvents,
    relationshipEdges: rankedEdges,
    sceneSlice: excludeArchivedSceneRefs(sceneSlice, excludeSceneRefs),
    novelVectorStoreId: novel?.oliviaSceneMemoryVectorStoreId || null,
  };
};
