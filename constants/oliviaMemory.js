/**
 * Olivia memory pipeline — feature switches and tuning knobs.
 *
 * Edit booleans here (not .env) to roll out the memory redesign.
 * Phase 3 flags only take effect when `OLIVIA_MEMORY_V2_ENABLED` is true.
 */

/** Phase 1+2: ConversationCursor, windowed history, assembler, worker, invalidator, methodology block */
export const OLIVIA_MEMORY_V2_ENABLED = true;

/**
 * Dashboard Simone/Olivia chat (`/api/v1/chat`): response chaining + windowed
 * history instead of resending full thread history every turn.
 *
 * Disabled: long Olivia intake (Q1–Q15 + Story Bible) loses early answers
 * (e.g. author name) when context is chained/windowed. Full history per turn
 * until intake facts are persisted and injected on compilation turns.
 */
export const DASHBOARD_CHAT_MEMORY_V2_ENABLED = false;

/** Cold-start window for Simone intake (Q1–Q11 + kit synthesis). */
export const SIMONE_RECENT_WINDOW_SIZE = 24;

export const isDashboardChatMemoryV2Enabled = () =>
  DASHBOARD_CHAT_MEMORY_V2_ENABLED;

/**
 * When true, inject the full story bible + character dossiers (legacy parity) whenever
 * `novel.masterPrompt` or Character.responseText exist — not thin slices / focus-only cast.
 * Disabled by default to prevent unbounded token growth on large casts.
 */
export const OLIVIA_FULL_CANON_CONTEXT_ENABLED = true;

export const isOliviaFullCanonContextEnabled = () =>
  OLIVIA_MEMORY_V2_ENABLED && OLIVIA_FULL_CANON_CONTEXT_ENABLED;

/** Soft cap on assembled memory block for editor chat (~32 KB at 4 chars/token). */
export const OLIVIA_EDITOR_TOKEN_BUDGET = 8000;

/** Soft cap for scene delivery turns (wider dossiers, scene cast). */
export const OLIVIA_SCENE_TOKEN_BUDGET = 12000;

/** Soft cap for Office 3 coaching turns (full bible + draft + outline). */
export const OLIVIA_COACHING_TOKEN_BUDGET = 11000;

/** Temporary widen for canon inventory queries ("who are my characters?"). */
export const OLIVIA_CANON_QUERY_TOKEN_BUDGET = 14000;

/** Widen for intent-aware canon expansion (dossier Q&A, named character questions). */
export const OLIVIA_CANON_EXPANSION_TOKEN_BUDGET = 18000;

/**
 * Always-on full-canon mode: full Story Bible + every character dossier.
 * Sized to hold a long bible + ~15–25 untruncated dossiers without the budget
 * guard chopping the tail of the CHARACTER PROFILES block (which would silently
 * drop the last characters' dossiers). gpt-5.4 has ample context; only the
 * first turn of each chain pays this — subsequent chain-hot turns replay it
 * server-side via previous_response_id.
 */
export const OLIVIA_FULL_CANON_TOKEN_BUDGET = 60000;

/** Reset OpenAI `previous_response_id` chain after this many successful turns. */
export const OLIVIA_CHAIN_MAX_TURNS = 12;

/** Reset chain when the prior turn's input_tokens exceeded this threshold. */
export const OLIVIA_CHAIN_MAX_INPUT_TOKENS = 80000;

/**
 * When true, omit the memory block from chain-hot turns if the novel has not
 * mutated since the last assembly — avoids re-billing bible/dossiers on every turn.
 */
export const OLIVIA_SKIP_MEMORY_BLOCK_ON_CHAIN = true;

/**
 * Phase 3: lazy per-novel OpenAI vector store + SceneMemory sync on save.
 * Requires shared OpenAI key and hosted vector store API access.
 */
export const OLIVIA_NOVEL_VECTOR_STORE_ENABLED = false;

/**
 * Phase 3: SceneCheckpoint snapshots on save + restore endpoints.
 * Storage scales with scenes × novels; auto rows cap at 20 per novel.
 */
export const OLIVIA_SCENE_CHECKPOINTS_ENABLED = false;

/** Phase 4: global cap on concurrent memory-worker LLM calls (per-novel serialization is always enforced) */
export const OLIVIA_MEMORY_QUEUE_CONCURRENCY = 4;

export const isOliviaMemoryV2Enabled = () => OLIVIA_MEMORY_V2_ENABLED;

export const isOliviaNovelVectorStoreEnabled = () =>
  OLIVIA_MEMORY_V2_ENABLED && OLIVIA_NOVEL_VECTOR_STORE_ENABLED;

export const isOliviaSceneCheckpointsEnabled = () =>
  OLIVIA_MEMORY_V2_ENABLED && OLIVIA_SCENE_CHECKPOINTS_ENABLED;

/** Resolve token budget for a given assembler mode and query type. */
export const resolveOliviaTokenBudget = ({
  mode = "editor",
  canonQuery = false,
  fullCanon = false,
  requiresCanonExpansion = false,
} = {}) => {
  if (fullCanon) return OLIVIA_FULL_CANON_TOKEN_BUDGET;
  if (requiresCanonExpansion) return OLIVIA_CANON_EXPANSION_TOKEN_BUDGET;
  if (canonQuery) return OLIVIA_CANON_QUERY_TOKEN_BUDGET;
  if (mode === "scene") return OLIVIA_SCENE_TOKEN_BUDGET;
  if (mode === "coaching") return OLIVIA_COACHING_TOKEN_BUDGET;
  return OLIVIA_EDITOR_TOKEN_BUDGET;
};
