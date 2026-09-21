/**
 * Ellis scene-by-scene chat memory pipeline — feature switches and tuning.
 */

/** Windowed history + response chaining for Ellis editor thread. */
export const ELLIS_MEMORY_V2_ENABLED = true;

/** Trailing message window on cold-start / chain reset. */
export const ELLIS_RECENT_WINDOW_SIZE = 12;

/** Max chars of prior in-thread review injected on follow-up turns. */
export const ELLIS_PRIOR_REVIEW_EXCERPT_MAX_CHARS = 12000;

export const isEllisMemoryV2Enabled = () => ELLIS_MEMORY_V2_ENABLED;
