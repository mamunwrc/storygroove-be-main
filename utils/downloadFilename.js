/**
 * Safe download filenames and Content-Disposition headers for .docx exports.
 * Node rejects control chars and non-ASCII in bare filename="..." values (ERR_INVALID_CHAR).
 */
import { stripMarkdownForDocx } from "./stripMarkdown.js";

const UNICODE_DASHES_RE = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const SMART_SINGLE_QUOTES_RE = /[\u2018\u2019\u201A\u201B]/g;
const SMART_DOUBLE_QUOTES_RE = /[\u201C\u201D\u201E\u201F]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const FILESYSTEM_UNSAFE_RE = /[/\\?%*:|"<>]/g;
const NON_ASCII_RE = /[^\x20-\x7E]/g;

/**
 * Normalize a novel title (or similar) into a filesystem-safe stem for download names.
 * @param {string} title
 * @param {string} [fallback="Novel"]
 * @returns {string}
 */
export function sanitizeDownloadFilenameStem(title, fallback = "Novel") {
  let s = stripMarkdownForDocx(String(title || ""));
  s = s.replace(/[\r\n\t]+/g, " ");
  s = s.replace(CONTROL_CHARS_RE, "");
  s = s.replace(UNICODE_DASHES_RE, "-");
  s = s.replace(SMART_SINGLE_QUOTES_RE, "'");
  s = s.replace(SMART_DOUBLE_QUOTES_RE, '"');
  s = s.replace(FILESYSTEM_UNSAFE_RE, "-");
  s = s.replace(/\s+/g, " ").trim();
  return s || fallback;
}

/**
 * Build a full .docx download filename from a stem and suffix.
 * @param {string} stem - Already sanitized stem (may still contain non-ASCII for filename*).
 * @param {string} suffix - e.g. "Outline", "Manuscript"
 * @param {string} [fallbackStem="Novel"]
 * @returns {string}
 */
export function buildDocxDownloadFilename(stem, suffix, fallbackStem = "Novel") {
  const safeStem = String(stem || "").trim() || fallbackStem;
  const safeSuffix = String(suffix || "").trim() || "Download";
  return `${safeStem}_${safeSuffix}.docx`;
}

/**
 * ASCII-only fallback filename for legacy clients / filename="..." segment.
 * @param {string} filename
 * @returns {string}
 */
export function toAsciiDownloadFilename(filename) {
  const normalized = String(filename || "")
    .replace(CONTROL_CHARS_RE, "")
    .replace(NON_ASCII_RE, "-")
    .replace(/-+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "download.docx";
}

/**
 * Escape a string for use inside Content-Disposition filename="...".
 * @param {string} value
 * @returns {string}
 */
function escapeQuotedFilename(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/**
 * Build a Content-Disposition attachment header safe for Node setHeader.
 * Uses RFC 5987 filename* when the full filename contains non-ASCII.
 * @param {string} filename - Full filename including extension
 * @returns {string}
 */
export function buildContentDispositionAttachment(filename) {
  const full = String(filename || "").trim() || "download.docx";
  const asciiFallback = toAsciiDownloadFilename(full);
  const quoted = escapeQuotedFilename(asciiFallback);

  if (full === asciiFallback) {
    return `attachment; filename="${quoted}"`;
  }

  const encoded = encodeURIComponent(full);
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encoded}`;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Set standard headers and send a .docx buffer as a download attachment.
 * @param {import("express").Response} res
 * @param {Buffer} buffer
 * @param {string} filename
 */
export function setDocxDownloadHeaders(res, buffer, filename) {
  res.setHeader("Content-Type", DOCX_MIME);
  res.setHeader("Content-Disposition", buildContentDispositionAttachment(filename));
  res.setHeader("Content-Length", buffer.length);
}

/**
 * One-shot helper: sanitize title + suffix into a download filename.
 * @param {string} title
 * @param {string} suffix
 * @param {string} [fallbackStem="Novel"]
 * @returns {string}
 */
export function buildSafeDocxFilenameFromTitle(title, suffix, fallbackStem = "Novel") {
  const stem = sanitizeDownloadFilenameStem(title, fallbackStem);
  return buildDocxDownloadFilename(stem, suffix, fallbackStem);
}
