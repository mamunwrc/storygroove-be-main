/**
 * Shared catalog for the activity log feature. Anything that writes logs
 * (controllers, model middleware) and anything that reads them (admin
 * dashboard endpoint) should reference these constants instead of magic
 * strings so the taxonomy stays consistent.
 */

export const ACTIVITY_MODULES = Object.freeze([
  "auth",
  "user",
  "novel",
  "chat",
  "assistant",
  "stripe",
  "apiUsage",
]);

export const ACTIVITY_ACTIONS = Object.freeze([
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "request_rejected",
  "warning_80_pct",
]);

/** Sources we tag onto metadata.source so admins can tell where a log came from. */
export const ACTIVITY_SOURCES = Object.freeze([
  "api",
  "model_middleware",
  "dashboard_projects_list",
  "system",
]);

/** Field-level hard limits enforced by the logger before reaching Mongo. */
export const ACTIVITY_LIMITS = Object.freeze({
  ACTION_MAX: 64,
  MODULE_MAX: 64,
  DESCRIPTION_MAX: 1024,
  SOURCE_MAX: 64,
  IP_MAX: 128,
  USER_AGENT_MAX: 512,
  /** Approximate JSON-string cap on metadata payload. */
  METADATA_MAX_BYTES: 8 * 1024,
  /** Max number of soft-delete targets a single bulk update can fan out into individual logs. */
  MODEL_MIDDLEWARE_FANOUT_CAP: 50,
});

/**
 * Regex matching key names that should never be persisted in `metadata`.
 * Matches are case-insensitive. Anything matching is replaced with `[REDACTED]`.
 */
export const SENSITIVE_KEY_REGEX =
  /(password|passwd|pwd|secret|token|auth|bearer|cookie|session|jwt|api[_-]?key|openai[_-]?key|stripe|client[_-]?secret|private[_-]?key|cvv|card|ssn)/i;
