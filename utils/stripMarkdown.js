/**
 * Remove common markdown decoration for plain-text display (extracted fields, UI).
 * Uses NFKC so fullwidth ＊ / ＃ (common in LLM copy-paste) normalize and strip correctly.
 */
export function stripMarkdown(str) {
  if (str == null || str === undefined) return "";
  let s = String(str)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");

  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/\*{1,3}/g, "")
      .replace(/_{1,3}/g, "")
      .replace(/`+/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\s*#{1,6}\s*$/gm, "");
    if (next === s) break;
    s = next;
  }

  // Asterisk-like symbols that do not always NFKC-map to U+002A
  s = s.replace(/[\u2217\u204E\u2731\u272E\u066D]/g, "");

  return s.trim();
}

/**
 * Aggressive cleanup for Word manuscript export: remove any leftover markdown tokens
 * so titles/genre never show literal **, _, `, or ###.
 */
export function stripMarkdownForDocx(str) {
  let s = stripMarkdown(str);
  s = s.replace(/\*+/g, "");
  s = s.replace(/_+/g, "");
  s = s.replace(/`+/g, "");
  // Trailing heading hashes (e.g. "... intimacy). ###" or "... . ###")
  s = s.replace(/\)\s*#{1,6}\s*$/g, ")");
  s = s.replace(/\.\s*#{1,6}\s*$/g, ".");
  s = s.replace(/\s*#{1,6}\s*$/g, "");
  s = s.replace(/^#{1,6}\s+/gm, "");
  // Any remaining isolated hash runs (mid-string markdown junk)
  s = s.replace(/\s+#{1,6}(?=\s|$)/g, "");
  return s.trim().replace(/\s{2,}/g, " ");
}
