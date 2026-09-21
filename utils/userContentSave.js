export const STALE_CONTENT_CODE = "STALE_CONTENT";

/**
 * Parse a client-supplied updatedAt token. Returns a Date, null when omitted,
 * or undefined when the value cannot be parsed.
 */
export const parseExpectedUpdatedAt = (value) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
};

export const buildUserContentSaveFilter = ({
  id,
  userId,
  expectedUpdatedAt = null,
  force = false,
} = {}) => {
  const filter = { _id: id, user: userId };
  if (expectedUpdatedAt && !force) {
    filter.updatedAt = expectedUpdatedAt;
  }
  return filter;
};

export const classifyUserContentSaveMiss = ({
  current,
  expectedUpdatedAt = null,
  force = false,
} = {}) => {
  if (!current) return "not_found";
  if (expectedUpdatedAt && !force) return "stale";
  return "not_found";
};
