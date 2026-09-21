/** Default tail page size for Olivia thread history GET endpoints. */
export const OLIVIA_HISTORY_DEFAULT_LIMIT = 50;

/** Recommended page size when the client loads older messages. */
export const OLIVIA_HISTORY_PAGE_SIZE = 30;

export const parseOliviaHistoryLimit = (raw, fallback = OLIVIA_HISTORY_DEFAULT_LIMIT) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 200);
};
