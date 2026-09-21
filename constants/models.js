/**
 * OpenAI model IDs per agent. Change here and deploy to switch models. 
 * Last verified: 2026-05-15.
 */
export const SIMONE_MODEL = "gpt-5.4";
export const OLIVIA_MODEL = "gpt-5.4";
export const ELLIS_MODEL = "gpt-5.4";

/**
 * Cheap model used by the Olivia memory pipeline for summarization, state
 * extraction, episodic-event extraction, and relationship-edge updates.
 * Separate constant so we can swap to a smaller / cheaper model without
 * touching the main agents. Fall back to `gpt-4o-mini` if the configured
 * value is not available on the account.
 */
export const OLIVIA_MEMORY_MODEL = "gpt-5.4-mini";

/**
 * Cheap model used to summarize an Ellis editorial letter into a compact
 * cover-oriented brief on first book-cover generation. Persisted on the novel
 * and reused for regenerates until the letter is re-saved.
 */
export const COVER_CONTEXT_SUMMARY_MODEL = "gpt-5.4-mini";

/**
 * Schema version stamped onto every memory row (ConversationCursor,
 * SceneMemory, ActiveSceneState, StoryState, CharacterState, EpisodicEvent,
 * RelationshipEdge, SceneCheckpoint). Bump on breaking extraction or
 * schema changes; the backfill script reads this to decide which rows
 * need re-extraction. Older rows are still usable (treated as "stale"
 * for the affected slices only).
 */
export const MEMORY_SCHEMA_VERSION = 1;

/**
 * Methodology content version stamped onto MethodologyRule / PromptTemplate /
 * GenreOverlay rows during seeding. Bump when the underlying PDFs are
 * re-issued and the seed JSON is regenerated. The assembler invalidates
 * its in-process LRU on version change.
 *
 * v2: added `beat_specificity_mandate` and `subplot_to_beat_translation`
 *     rules (scope=phase, phases=[phase2_expansion, drafting]) to push
 *     rich-scene beats from abstract editorial summary toward concrete
 *     dramatized micro-events.
 * v3: added `outlining` to those two rules' phase scope so they fire
 *     during initial 15-scene core-spine delivery (StoryState defaults
 *     to layeringPhase="outlining" and never transitions automatically),
 *     and broadened the banned-phrasing list to apply to the entire
 *     rich-scene block (Book Coaching + Setting + Subplot Tie-In +
 *     Arc Movement, not just the bullets).
 */
export const METHODOLOGY_VERSION = 3;

/** Fallback when usage logging has no model (non-Simone default). */
export const DEFAULT_MODEL = OLIVIA_MODEL;

/**
 * Resolve the model for an agent name (chat threads, legacy assistants).
 * Simone chat (AIAgentChat) uses SIMONE_MODEL; Olivia/Ellis use their constants.
 */
export const getModelForAgent = (agentName = "simone") => {
  const normalized = (agentName || "simone").toString().trim().toLowerCase();
  if (normalized === "simone" || normalized === "simoneai") {
    return SIMONE_MODEL;
  }
  if (normalized === "ellis") {
    return ELLIS_MODEL;
  }
  if (normalized === "olivia" || normalized.startsWith("olivia")) {
    return OLIVIA_MODEL;
  }
  return OLIVIA_MODEL;
};
