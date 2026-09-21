/**
 * Memory ranking weights + helpers used by `contextAssembler.js` and
 * (Phase 3) `retrievalService.js`.
 *
 * Formula:
 *   score(event) =
 *       w_importance * normImportance
 *     + w_recency    * recencyScore
 *     + w_overlap    * characterOverlapScore
 *     + w_arc        * arcMatchScore
 *     + w_explicit   * explicitMentionScore
 *
 * Centralized here so weights can be tuned in one place without code
 * surgery, and so tests can import the exact constants the runtime
 * uses.
 */

export const MEMORY_RANKING_WEIGHTS = Object.freeze({
  importance: 0.4,
  recency: 0.25,
  overlap: 0.2,
  arc: 0.1,
  explicit: 0.05,
});

/** Default top-K for episodic memories injected into the prompt. */
export const TOP_K_EPISODIC = 5;

/** Default top-K for relationship edges injected into the prompt. */
export const TOP_K_EDGES = 8;

const sceneKey = (ref) =>
  ref ? (ref.actNumber || 0) * 100 + (ref.sceneIndex || 0) : 0;

/**
 * `ctx` shape: { focusSceneRef, focusCharacterIds: string[],
 *                storyState: StoryState | null, userMessage: string | "" }
 */
export const scoreEpisodicEvent = (event, ctx = {}) => {
  if (!event) return 0;

  const importance = Math.max(0, Math.min(10, event.importance || 0)) / 10;

  const focusKey = sceneKey(ctx.focusSceneRef);
  const eventKey = sceneKey(event.sceneRef);
  const scenesSince = focusKey && eventKey ? Math.max(0, focusKey - eventKey) / 100 : 0;
  const recency = 1 / (1 + scenesSince);

  const focusChars = new Set((ctx.focusCharacterIds || []).map(String));
  const eventChars = (event.characterIds || []).map(String);
  const intersect = eventChars.filter((c) => focusChars.has(c)).length;
  const overlap = focusChars.size === 0 ? 0 : intersect / focusChars.size;

  const arcTags = (ctx.storyState?.currentArc || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const eventTags = (event.tags || []).map((t) => (t || "").toLowerCase());
  const arc = arcTags.some((t) => eventTags.includes(t)) ? 1 : 0;

  const userMsg = (ctx.userMessage || "").toLowerCase();
  const explicit = (event.summary || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 4 && userMsg.includes(tok)).length;
  const explicitNorm = explicit > 0 ? 1 : 0;

  const w = MEMORY_RANKING_WEIGHTS;
  return (
    w.importance * importance +
    w.recency * recency +
    w.overlap * overlap +
    w.arc * arc +
    w.explicit * explicitNorm
  );
};

/**
 * Adapted scoring for `RelationshipEdge`: recency uses the edge's
 * `lastUpdatedSceneRef`, "overlap" treats `dst` as the focus (an edge
 * is interesting when the writer is talking about its source).
 */
export const scoreRelationshipEdge = (edge, ctx = {}) => {
  if (!edge) return 0;

  // Map sentiment (-100..100) and trust (0..100) into a 0..1 "importance"
  // (high magnitudes — strong love/hate, deep trust/distrust — score high).
  const magnitude =
    Math.max(Math.abs(edge.sentiment || 0), Math.abs((edge.trust ?? 50) - 50) * 2) /
    100;
  const importance = Math.max(0, Math.min(1, magnitude));

  const focusKey = sceneKey(ctx.focusSceneRef);
  const lastKey = sceneKey(edge.lastUpdatedSceneRef);
  const scenesSince = focusKey && lastKey ? Math.max(0, focusKey - lastKey) / 100 : 0;
  const recency = 1 / (1 + scenesSince);

  const focusChars = new Set((ctx.focusCharacterIds || []).map(String));
  const overlap = focusChars.has(String(edge.dstCharacterId)) ? 1 : 0;

  const w = MEMORY_RANKING_WEIGHTS;
  return w.importance * importance + w.recency * recency + w.overlap * overlap;
};
