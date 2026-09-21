/**
 * Plain-text helpers for uploaded manuscript chapters (Ellis pipeline).
 */

import { extractScenePov } from "./extractSceneTitle.js";
import { matchChapterHeader, numberToWords } from "./manuscriptParser.js";

const OLIVIA_COACHING_MARKERS =
  /(?:Scene Title\s*:|📘|📝|📏|Target Word Count|Scene to Write|Book Coaching for Scene)/i;

/**
 * True when a plain-text line is only a scene-break ornament (e.g. * * *, ---).
 */
export const isSceneBreakOrnamentLine = (line) => {
  const text = String(line || "").trim();
  if (!text) return false;

  const normalized = text.replace(/\s+/g, " ");

  if (/^[\*\s]+$/.test(normalized)) {
    const count = (normalized.match(/\*/g) || []).length;
    if (count >= 2) return true;
  }

  if (/^[\#\s]+$/.test(normalized)) {
    const count = (normalized.match(/#/g) || []).length;
    if (count >= 2) return true;
  }

  const dashOnly = normalized.replace(/\s/g, "");
  if (/^[-–—]+$/.test(dashOnly) && dashOnly.length >= 3) return true;

  if (/^[•·\s]+$/.test(normalized)) {
    const count = (normalized.match(/[•·]/g) || []).length;
    if (count >= 2) return true;
  }

  return false;
};

/** Drop scene-break ornament lines from parsed chapter content. */
export const filterSceneBreakOrnamentLines = (lines = []) =>
  lines.filter((line) => !isSceneBreakOrnamentLine(line));

/** Block-aware variant of `filterSceneBreakOrnamentLines` (checks `block.text`). */
export const filterSceneBreakOrnamentBlocks = (blocks = []) =>
  blocks.filter((block) => !isSceneBreakOrnamentLine(block?.text));

/**
 * True when a plain-text line is likely an Olivia/export scene title (not prose).
 */
export const looksLikeSceneTitleLine = (line) => {
  const text = String(line || "").trim();
  if (!text) return false;
  if (isSceneBreakOrnamentLine(text)) return false;
  if (matchChapterHeader(text)) return false;
  if (OLIVIA_COACHING_MARKERS.test(text)) return false;
  if (/^["'“‘]/.test(text)) return false;
  if (/[.!?]["'”’]?\s*$/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 12) return false;
  if (text.includes(":")) return false;

  return true;
};

/**
 * If the first content line after a chapter header looks like a scene title,
 * peel it off for storage in sceneTitle instead of userContent body.
 */
export const peelLeadingSceneTitleLine = (contentLines = []) => {
  const lines = [...contentLines];
  if (!lines.length) {
    return { sceneTitle: null, contentLines: lines };
  }

  const first = String(lines[0] || "").trim();
  if (!looksLikeSceneTitleLine(first)) {
    return { sceneTitle: null, contentLines: lines };
  }

  return {
    sceneTitle: first,
    contentLines: lines.slice(1),
  };
};

/** Block-aware variant of `peelLeadingSceneTitleLine` (checks `block.text`). */
export const peelLeadingSceneTitleBlock = (contentBlocks = []) => {
  const blocks = [...contentBlocks];
  if (!blocks.length) {
    return { sceneTitle: null, contentBlocks: blocks };
  }

  const first = String(blocks[0]?.text || "").trim();
  if (!looksLikeSceneTitleLine(first)) {
    return { sceneTitle: null, contentBlocks: blocks };
  }

  return {
    sceneTitle: first,
    contentBlocks: blocks.slice(1),
  };
};

const normalizeComparableText = (value = "") =>
  String(value).replace(/\s+/g, " ").trim();

/**
 * Remove a leading scene-title paragraph from stored chapter HTML (legacy rows).
 */
export const stripLeadingSceneTitleFromHtml = (html = "", { sceneTitle } = {}) => {
  const source = String(html || "");
  if (!source.trim()) return source;

  const blockMatch = source.match(/^\s*(<p[^>]*>[\s\S]*?<\/p>)\s*/i);
  if (!blockMatch) return source;

  const firstText = normalizeComparableText(
    blockMatch[1].replace(/<[^>]+>/g, " ")
  );
  if (!firstText) return source;

  const titleMatch =
    sceneTitle &&
    normalizeComparableText(sceneTitle).localeCompare(firstText, undefined, {
      sensitivity: "accent",
    }) === 0;

  if (!titleMatch && !looksLikeSceneTitleLine(firstText)) {
    return source;
  }

  return source.slice(blockMatch[0].length).trimStart();
};

/** Remove scene-break ornament paragraphs from stored chapter HTML. */
export const stripSceneBreakOrnamentsFromHtml = (html = "") => {
  const source = String(html || "");
  if (!source.trim()) return source;

  return source
    .replace(/<p[^>]*>[\s\S]*?<\/p>\s*/gi, (block) => {
      const text = normalizeComparableText(block.replace(/<[^>]+>/g, " "));
      return isSceneBreakOrnamentLine(text) ? "" : block;
    })
    .trim();
};

/**
 * Build a single Ellis-detectable chapter header line for export/re-upload.
 * Example: "Chapter One, POV Lucas, Timeline 1932"
 */
export const formatEllisChapterHeaderLine = ({
  chapterNumber,
  chapterLabel,
  pov,
  timeline,
}) => {
  const label =
    chapterLabel?.trim() ||
    (chapterNumber != null
      ? `Chapter ${numberToWords(chapterNumber) || chapterNumber}`
      : "Chapter");
  const parts = [label];
  if (pov?.trim()) parts.push(`POV ${pov.trim()}`);
  if (timeline?.trim()) parts.push(`Timeline ${timeline.trim()}`);
  return parts.join(", ");
};

/**
 * Resolve chapter metadata for manuscript Word export (one scene row).
 */
export const resolveChapterExportMeta = (
  uc = {},
  { globalSceneNum, responseText } = {}
) => {
  const chapterNumber =
    uc.chapterNumber != null ? Number(uc.chapterNumber) : globalSceneNum;
  const chapterLabel =
    uc.chapterLabel?.trim() ||
    (chapterNumber != null
      ? `Chapter ${numberToWords(chapterNumber) || chapterNumber}`
      : null);
  const pov =
    (uc.pov && String(uc.pov).trim()) ||
    extractScenePov(responseText || "") ||
    null;
  const timeline = uc.timeline?.trim() || null;
  const headerLine = formatEllisChapterHeaderLine({
    chapterNumber,
    chapterLabel,
    pov,
    timeline,
  });
  return { chapterNumber, chapterLabel, pov, timeline, headerLine };
};

export const stripChapterHtmlToText = (html = "") => {
  const raw = String(html)
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return raw
    .split("\n")
    .filter((line) => !isSceneBreakOrnamentLine(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/**
 * True when stored editor HTML has actual manuscript words.
 * Quill empty saves (`<p><br></p>`, `&nbsp;`) and leftover `<style>` blocks
 * are not prose — those used to sneak empty chapters into the .docx download.
 */
export const userContentHasProse = (html = "") => {
  const withoutChrome = String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
  return Boolean(stripChapterHtmlToText(withoutChrome).trim());
};

/**
 * Title-page metadata lines for Ellis uploaded-manuscript prompts.
 */
export const buildUploadedManuscriptMetaLines = (novel = {}) => {
  const parts = [];
  if (novel.name?.trim()) parts.push(`Title: ${novel.name.trim()}`);
  if (novel.storyBibleAuthor?.trim()) {
    parts.push(`Author: ${novel.storyBibleAuthor.trim()}`);
  }
  if (novel.genre?.trim()) parts.push(`Genre: ${novel.genre.trim()}`);
  if (novel.subgenre?.trim()) parts.push(`Subgenre: ${novel.subgenre.trim()}`);
  if (Array.isArray(novel.compTitles) && novel.compTitles.length) {
    parts.push(`Comp titles: ${novel.compTitles.join("; ")}`);
  }
  return parts;
};

/**
 * Title-page metadata block for Ellis editorial letter generation.
 */
export const buildUploadedManuscriptMetaContext = (novel = {}) => {
  const parts = buildUploadedManuscriptMetaLines(novel);
  if (!parts.length) return "";

  const author = novel.storyBibleAuthor?.trim();
  const salutation = author
    ? `\nOpen the letter with: Hello ${author}, — use this exact author name; do not use the placeholder "Author".`
    : "";

  return `MANUSCRIPT TITLE PAGE METADATA (use for salutation — do not use placeholder "Author"):\n${parts.join("\n")}${salutation}`;
};

/**
 * Reassemble an uploaded manuscript into ordered plain text from UserContent rows.
 */
export const assembleManuscriptText = (userContents = []) => {
  const ordered = [...userContents]
    .filter(
      (uc) =>
        uc &&
        !uc.archivedAt &&
        (uc.chapterNumber != null || uc.chapterLabel || uc.userContent)
    )
    .sort(
      (a, b) =>
        Number(a.chapterNumber || a.sceneIndex || 0) -
        Number(b.chapterNumber || b.sceneIndex || 0)
    );

  return ordered
    .map((uc) => {
      const label =
        uc.chapterLabel ||
        uc.sceneTitle ||
        (uc.chapterNumber ? `Chapter ${uc.chapterNumber}` : "Chapter");
      const meta = [
        uc.pov ? `POV: ${uc.pov}` : null,
        uc.timeline ? `Timeline: ${uc.timeline}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const heading = meta ? `${label} (${meta})` : label;
      const body = stripChapterHtmlToText(uc.userContent);
      return `${heading}\n\n${body}`;
    })
    .join("\n\n");
};

export const extractChapterFirstLine = (html = "") => {
  const text = stripChapterHtmlToText(html);
  const line = text
    .split(/\n+/)
    .map((l) => l.trim())
    .find(Boolean);
  return line || "";
};

export const excerptChapterText = (html = "", maxChars = 500) => {
  const text = stripChapterHtmlToText(html);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}…`;
};
