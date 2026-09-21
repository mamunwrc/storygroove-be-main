import mongoose from "mongoose";
import ActivityLog from "../models/activityLogModel.js";
import {
  ACTIVITY_LIMITS,
  SENSITIVE_KEY_REGEX,
} from "../constants/activityLog.js";

function truncate(value, max) {
  if (typeof value !== "string" || !max) return value;
  return value.length > max ? value.slice(0, max) : value;
}

function resolveClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) return truncate(first, ACTIVITY_LIMITS.IP_MAX);
  }
  const ip = req.ip || req.socket?.remoteAddress || null;
  if (typeof ip === "string" && ip) return truncate(ip, ACTIVITY_LIMITS.IP_MAX);
  return null;
}

function resolveUserAgent(req) {
  if (!req || typeof req.get !== "function") return null;
  const ua = req.get("user-agent");
  if (!ua || typeof ua !== "string") return null;
  return truncate(ua, ACTIVITY_LIMITS.USER_AGENT_MAX);
}

/**
 * Recursively redact any value whose key matches SENSITIVE_KEY_REGEX.
 * Arrays preserved; primitives passed through; circular refs broken.
 * Depth cap prevents runaway recursion from pathological inputs.
 */
function redactDeep(value, seen = new WeakSet(), depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, seen, depth + 1));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactDeep(v, seen, depth + 1);
    }
  }
  return out;
}

/**
 * Cap the JSON-string size of metadata so a bad caller can't write multi-MB
 * documents. If oversize, we keep top-level keys but stringify deep values.
 */
function clampMetadataSize(meta) {
  try {
    const str = JSON.stringify(meta);
    if (typeof str !== "string") return {};
    if (Buffer.byteLength(str, "utf8") <= ACTIVITY_LIMITS.METADATA_MAX_BYTES) {
      return meta;
    }
    // Oversized → return a marker plus a short preview. We don't try to be
    // clever because metadata that big is almost always a caller bug.
    return {
      _truncated: true,
      _originalBytes: Buffer.byteLength(str, "utf8"),
      preview: str.slice(0, 512),
    };
  } catch {
    return { _serializationFailed: true };
  }
}

function normalizeUserId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
    return userId;
  }
  if (typeof userId === "object" && userId._id) {
    return normalizeUserId(userId._id);
  }
  return null;
}

/**
 * Fire-and-forget activity log. Do not await in request handlers.
 * @param {object} opts
 * @param {import('express').Request} [opts.req]
 * @param {import('mongoose').Types.ObjectId|string|null} [opts.userId]
 * @param {string} opts.action
 * @param {string} opts.module
 * @param {string} opts.description
 * @param {object} [opts.metadata]
 */
export function queueActivityLog({
  req,
  userId,
  action,
  module,
  description,
  metadata = {},
}) {
  if (!action || !module || !description) {
    // Required fields missing — fail silently rather than crash the request.
    console.warn("[activityLog] missing required fields", {
      hasAction: !!action,
      hasModule: !!module,
      hasDescription: !!description,
    });
    return;
  }

  const safeMeta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};

  // Pull `source` out so we can store it as a first-class indexed field.
  const { source: rawSource, ...restMeta } = safeMeta;
  const source =
    typeof rawSource === "string" && rawSource.trim()
      ? truncate(rawSource.trim(), ACTIVITY_LIMITS.SOURCE_MAX)
      : null;

  const redacted = redactDeep(restMeta);
  const clamped = clampMetadataSize(redacted);

  const doc = {
    userId: normalizeUserId(userId),
    action: truncate(String(action), ACTIVITY_LIMITS.ACTION_MAX),
    module: truncate(String(module), ACTIVITY_LIMITS.MODULE_MAX),
    description: truncate(String(description), ACTIVITY_LIMITS.DESCRIPTION_MAX),
    source,
    metadata: clamped,
    ipAddress: resolveClientIp(req),
    userAgent: resolveUserAgent(req),
  };

  void ActivityLog.create(doc).catch((err) => {
    console.error("[activityLog]", err?.message || err);
  });
}

export function actorUserId(req, fallbackId) {
  if (req?.user?._id) return req.user._id;
  return fallbackId ?? null;
}
