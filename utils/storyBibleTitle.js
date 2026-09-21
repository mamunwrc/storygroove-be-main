import { stripMarkdown } from "./stripMarkdown.js";

const TITLE_MAX_CHARS = 200;

/** Trailing "Approx. 70,000 words" / "70,000 words" glued onto a title line. */
const TRAILING_WORD_COUNT_RE =
  /^(.*?)\s+((?:approx\.?|approximately|~)\s*[:\s]*\d[\d,]*\s*words?|\d[\d,]*\s*words?)\s*$/i;

function titleWordCountHeaderRe() {
  const amp = "(?:&|and|＆)";
  return new RegExp(
    `(?:^|[\\r\\n])\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?\\s*Title\\s*${amp}\\s*Word\\s*Count\\s*(?:\\*\\*)?\\s*(?:\\r?\\n|$)`,
    "i"
  );
}

function bodyStopIndexes(rest) {
  return [
    rest.search(/\r?\n-{3,}\s*\r?\n/),
    rest.search(/\r?\n_{3,}\s*\r?\n/),
    rest.search(/\r?\n\*{3,}\s*\r?\n/),
    rest.search(/\r?\n(?=\s*(?:#{1,6}\s|\*{0,2}\s*📚|Story\s+Context|Market\s+Positioning|CHARACTER\s+DOSSIERS))/i),
  ].filter((i) => i >= 0);
}

/**
 * Locate the body of the first "Title & Word Count" section.
 * Mirrors heading patterns in extractNovelData.js (bold, heading hashes, Unicode &).
 */
function extractTitleWordCountBlock(fullText) {
  if (!fullText || typeof fullText !== "string") return "";
  const m = titleWordCountHeaderRe().exec(fullText);
  if (!m) return "";
  const rest = fullText.slice(m.index + m[0].length);
  const stops = bodyStopIndexes(rest);
  const end = stops.length ? Math.min(...stops) : rest.length;
  return rest.slice(0, end).trim();
}

function locateTitleWordCountBody(fullText) {
  if (!fullText || typeof fullText !== "string") return null;
  const m = titleWordCountHeaderRe().exec(fullText);
  if (!m) return null;
  const headerEnd = m.index + m[0].length;
  const rest = fullText.slice(headerEnd);
  const stops = bodyStopIndexes(rest);
  const end = stops.length ? Math.min(...stops) : rest.length;
  return {
    before: fullText.slice(0, headerEnd),
    block: rest.slice(0, end),
    after: rest.slice(end),
  };
}

/** True when the line is author / word-count metadata, not a book title. */
function isNonTitleLine(plain) {
  if (!plain) return true;
  if (/^author\s*[:：]/i.test(plain)) return true;
  if (/^word\s*count\s*[:：]/i.test(plain)) return true;
  if (/^(?:approx\.?|approximately|~)\b/i.test(plain) && /\d/.test(plain)) {
    return true;
  }
  if (/^\d[\d,]*\s*words?\b/i.test(plain)) return true;
  return false;
}

function isApproxWordCountLine(plain) {
  if (!plain) return false;
  if (/^(?:approx\.?|approximately|~)\s*[:\s]*\d[\d,]*\s*words?\b/i.test(plain)) {
    return true;
  }
  if (/^\d[\d,]*\s*words?\b/i.test(plain)) return true;
  return false;
}

function stripTitleLabelPrefix(plain) {
  return plain.replace(/^\s*title\s*[:：]\s*/i, "").trim();
}

/** Split "Party Girls 40! - Test Approx. 70,000 words" into title + approx. */
export function splitGluedTitleAndApprox(line) {
  const plain = stripMarkdown(String(line || "")).trim();
  if (!plain || isApproxWordCountLine(plain)) return null;
  const m = plain.match(TRAILING_WORD_COUNT_RE);
  if (!m || !m[1].trim()) return null;
  return { title: m[1].trim(), approx: m[2].trim() };
}

/** CommonMark hard break: next visual line, no extra paragraph gap. */
function withHardLineBreak(line) {
  return `${String(line).replace(/\s+$/, "")}  `;
}

/**
 * Keep "Approx. N words" on the next line after the title (hard line break),
 * without inserting a blank paragraph in between.
 */
export function ensureStoryBibleApproxOnOwnLine(text) {
  const located = locateTitleWordCountBody(text);
  if (!located) return text;

  const lines = located.block.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    const glued = splitGluedTitleAndApprox(line);
    if (glued) {
      out.push(withHardLineBreak(glued.title));
      out.push(glued.approx);
      continue;
    }
    const plain = stripMarkdown(line).trim();
    if (isApproxWordCountLine(plain)) {
      while (out.length && out[out.length - 1] === "") out.pop();
      if (out.length) {
        out[out.length - 1] = withHardLineBreak(out[out.length - 1]);
      }
      out.push(line);
      continue;
    }
    out.push(line);
  }

  return located.before + out.join("\n") + located.after;
}

/**
 * First plausible title under the Story Bible "Title & Word Count" block.
 * Returns "" when none is found (caller should leave Novel.name unchanged).
 */
export function extractStoryBibleTitle(text) {
  const block = extractTitleWordCountBlock(text);
  if (!block) return "";

  for (const rawLine of block.split(/\r?\n/)) {
    const plain = stripMarkdown(rawLine);
    if (!plain || isNonTitleLine(plain)) continue;
    let title = stripTitleLabelPrefix(plain);
    const glued = splitGluedTitleAndApprox(title);
    if (glued) title = glued.title;
    if (!title || isNonTitleLine(title)) continue;
    return title.slice(0, TITLE_MAX_CHARS);
  }
  return "";
}
