/**
 * Ellis load_manuscript_chapters — the model picks the map row, this loads prose.
 * Tool args are chapterIds from the map, not a parse of the writer message.
 */

import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";
import { buildEllisChapterEphemeralBlock } from "./ellisDynamicContext.js";

// ponytail: hard cap per call. Upgrade: let Ellis page if a pass needs more.
const ELLIS_LOAD_CHAPTER_LIMIT = 4;

export const parseEllisLoadChapterArgs = (args) => {
  let parsed = args;
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const chapterIds = Array.isArray(parsed.chapterIds)
    ? parsed.chapterIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  return { chapterIds };
};

export const executeEllisLoadManuscriptChapters = ({
  args,
  userContents = [],
} = {}) => {
  const parsed = parseEllisLoadChapterArgs(args);
  if (!parsed) return "Could not parse chapter request.";

  const ids = parsed.chapterIds.slice(0, ELLIS_LOAD_CHAPTER_LIMIT);
  if (!ids.length) {
    return "No chapterIds provided. Copy chapterId from the MANUSCRIPT MAP.";
  }

  const rows = getUploadedChapterRows(userContents);
  const found = [];
  const missing = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = rows.find((uc) => String(uc._id) === id);
    if (row) found.push(row);
    else missing.push(id);
  }

  if (!found.length) {
    const hint = missing.length
      ? ` Unknown chapterId(s): ${missing.join(", ")}.`
      : "";
    return `No manuscript chapter matched those chapterIds.${hint} Copy chapterId from the MANUSCRIPT MAP.`;
  }

  const blocks = found
    .map((row) => buildEllisChapterEphemeralBlock(row)?.content)
    .filter(Boolean);
  if (!blocks.length) {
    return "Those chapters have no manuscript text to load.";
  }

  const missingNote = missing.length
    ? `\n\nUnknown chapterId(s) skipped: ${missing.join(", ")}.`
    : "";
  return `${blocks.join("\n\n")}${missingNote}`;
};
