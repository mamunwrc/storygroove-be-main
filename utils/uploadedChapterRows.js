/**
 * Uploaded-manuscript chapter row selection — mirrors
 * storygroove-fe/src/Pages/UploadedManuscript/utils.js getUploadedChapterRows.
 * actNumber from Ellis enrichment is map metadata only; reading order is
 * (chapterNumber, chapterSuffix).
 */
import {
  chapterIdentityKey,
  compareChapterRows,
  normalizeChapterSuffix,
} from "./manuscriptParser.js";

const scoreUploadedChapterRow = (row) => {
  let score = 0;
  if (row.chapterSummary?.trim()) score += 8;
  if (row.actNumber != null) score += 4;
  if (row.userContent?.trim()) score += 2;
  if (row.chapterLabel || row.sceneTitle) score += 1;
  return score;
};

export const isArchivedChapterRow = (uc) => Boolean(uc?.archivedAt);

/**
 * Ellis unique-index parking range. Must sit below front-matter (0, -1, -2…)
 * and below remap phase-1 temps (-1_000_000 - i).
 */
export const PARKED_CHAPTER_NUMBER_BASE = -8_000_000;

export const isParkedChapterNumber = (n) =>
  Number.isFinite(Number(n)) && Number(n) <= PARKED_CHAPTER_NUMBER_BASE;

/** Prologue (0) and extra front-matter (-1, -2…) from the manuscript parser. */
export const isFrontMatterChapterNumber = (n) => {
  const num = Number(n);
  return Number.isFinite(num) && num <= 0 && !isParkedChapterNumber(num);
};

/** Next unused Ellis parking sentinel; ignores front-matter negatives. */
export const nextParkedChapterNumber = (rows = []) => {
  let min = PARKED_CHAPTER_NUMBER_BASE;
  for (const row of rows) {
    const n = Number(row?.chapterNumber);
    if (Number.isFinite(n) && n < min) min = n;
  }
  return min - 1;
};

/**
 * Active reading-order rows minus `archivedId`. `archivedFromSceneIndex` is the
 * 1-based slot to restore into (Book Editor's archivedFromSceneIndex equivalent).
 */
export const planUploadedChapterArchive = (activeRows = [], archivedId) => {
  const fromIdx = (activeRows || []).findIndex(
    (row) => String(row._id) === String(archivedId)
  );
  if (fromIdx < 0) return null;
  return {
    fromIdx,
    remaining: activeRows.filter(
      (row) => String(row._id) !== String(archivedId)
    ),
    archivedFromSceneIndex: fromIdx + 1,
  };
};

/** Insert an archived row back at its stashed slot (append if past end). */
export const planUploadedChapterRestore = (activeRows = [], archivedRow) => {
  const saved = Number(archivedRow?.archivedFromSceneIndex);
  const appendIndex = (activeRows || []).length + 1;
  let targetIndex = Number.isFinite(saved) ? saved : appendIndex;
  if (targetIndex < 1 || targetIndex > appendIndex) targetIndex = appendIndex;
  const ordered = [...(activeRows || [])];
  ordered.splice(targetIndex - 1, 0, archivedRow);
  return { targetIndex, ordered };
};

/**
 * Close gaps among narrative chapters (1+) while leaving front matter
 * (0, -1, -2…) on its parser identity. Parked sentinels are treated as narrative
 * so a restored row gets a real Map number.
 */
export const assignCompactChapterNumbers = (rows = []) => {
  let nextNarrative = 1;
  return (rows || []).map((row) => {
    const n = Number(row?.chapterNumber);
    if (isFrontMatterChapterNumber(n)) {
      return { row, chapterNumber: n, sceneIndex: n };
    }
    const assigned = nextNarrative++;
    return { row, chapterNumber: assigned, sceneIndex: assigned };
  });
};

export const buildCompactChapterRemap = (
  assigned = [],
  { alwaysIncludeIds = [] } = {}
) => {
  const always = new Set((alwaysIncludeIds || []).map(String));
  return assigned
    .map(({ row, chapterNumber: newNumber }) => {
      const oldNumber = Number(row?.chapterNumber);
      const chapterId = row?._id;
      if (!chapterId || !Number.isFinite(Number(newNumber))) return null;
      if (
        Number.isFinite(oldNumber) &&
        oldNumber === Number(newNumber) &&
        !always.has(String(chapterId))
      ) {
        return null;
      }
      return {
        oldNumber: Number.isFinite(oldNumber) ? oldNumber : Number(newNumber),
        newNumber: Number(newNumber),
        chapterSuffix: row.chapterSuffix,
        chapterId,
      };
    })
    .filter(Boolean);
};

/**
 * Returns one UserContent row per (chapterNumber, chapterSuffix), sorted in
 * reading order. Archived rows are omitted (parked at the bottom of the Map).
 * Front matter (0, -1, -2…) stays — those are real parser sections, not archives.
 * @param {object[]} userContents
 * @returns {object[]}
 */
export const getUploadedChapterRows = (userContents = []) => {
  const byChapter = new Map();

  userContents.forEach((uc, index) => {
    if (isArchivedChapterRow(uc)) return;
    if (uc.chapterNumber == null) return;
    const num = Number(uc.chapterNumber);
    if (!Number.isFinite(num)) return;

    const key = chapterIdentityKey(num, uc.chapterSuffix);
    const candidate = {
      ...uc,
      chapterSuffix: normalizeChapterSuffix(uc.chapterSuffix) || null,
      originalIndex: index,
    };
    const existing = byChapter.get(key);
    if (
      !existing ||
      scoreUploadedChapterRow(candidate) > scoreUploadedChapterRow(existing)
    ) {
      byChapter.set(key, candidate);
    }
  });

  return [...byChapter.values()].sort(compareChapterRows);
};

export { compareChapterRows, chapterIdentityKey, normalizeChapterSuffix };
