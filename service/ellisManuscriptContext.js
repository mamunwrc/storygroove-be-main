import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import { excerptChapterText } from "../utils/manuscriptText.js";
import {
  compareChapterRows,
  normalizeChapterSuffix,
} from "../utils/manuscriptParser.js";
import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";

export const sortChapterRows = (rows = []) =>
  [...rows].sort(compareChapterRows);

/** One manuscript map row per base chapterNumber (includes front/back matter). */
export const getDistinctBaseChapterRows = (rows = []) => {
  const byNumber = new Map();

  for (const uc of getUploadedChapterRows(rows)) {
    const num = Number(uc.chapterNumber);
    if (!Number.isFinite(num)) continue;

    const existing = byNumber.get(num);
    if (
      !existing ||
      (!normalizeChapterSuffix(uc.chapterSuffix) &&
        normalizeChapterSuffix(existing.chapterSuffix))
    ) {
      byNumber.set(num, uc);
    }
  }

  return [...byNumber.values()].sort(compareChapterRows);
};

/**
 * Front matter (0, -1…), narrative (1+), back matter — any finite chapterNumber
 * that was actually provided. Rejects null/'' because Number(null) === 0.
 */
export const isEllisManuscriptChapterNumber = (value) =>
  value != null && value !== "" && Number.isFinite(Number(value));

export const resolveChapterLabel = (uc) => {
  if (uc?.chapterLabel) return uc.chapterLabel;
  if (uc?.sceneTitle) return uc.sceneTitle;
  const num = Number(uc?.chapterNumber ?? uc?.sceneIndex);
  if (!Number.isFinite(num) || num < 1) return "Chapter";
  return `Chapter ${num}${
    normalizeChapterSuffix(uc.chapterSuffix)
      ? ` ${normalizeChapterSuffix(uc.chapterSuffix)}`
      : ""
  }`;
};

/** Suffix-aware manuscript map for Ellis — all uploaded chapters in reading order. */
export const buildManuscriptMapContext = (userContents = []) => {
  const rows = getUploadedChapterRows(userContents).filter((uc) =>
    isEllisManuscriptChapterNumber(uc.chapterNumber ?? uc.sceneIndex)
  );

  return rows
    .map((uc) => {
      const label = resolveChapterLabel(uc);
      const id = uc._id ? String(uc._id) : "";
      const idPrefix = id ? `chapterId:${id} | ` : "";
      const parts = [
        uc.pov ? `POV: ${uc.pov}` : null,
        uc.timeline ? `Timeline: ${uc.timeline}` : null,
      ].filter(Boolean);
      const summary = uc.chapterSummary?.trim()
        ? ` — ${uc.chapterSummary.trim()}`
        : "";
      return parts.length
        ? `- ${idPrefix}${label} (${parts.join(", ")})${summary}`
        : `- ${idPrefix}${label}${summary}`;
    })
    .join("\n");
};

export const buildAdjacentChapterContext = (
  ordered,
  chapterNum,
  chapterSuffix = null
) => {
  const distinct = getDistinctBaseChapterRows(ordered);
  const idx = distinct.findIndex(
    (uc) => Number(uc.chapterNumber ?? uc.sceneIndex) === Number(chapterNum)
  );
  if (idx < 0) return "";
  const blocks = [];
  if (idx > 0) {
    const prev = distinct[idx - 1];
    const prevLabel = resolveChapterLabel(prev);
    blocks.push(
      `PREVIOUS CHAPTER (${prevLabel}) — opening excerpt:\n${excerptChapterText(prev.userContent, 500)}`
    );
  }
  if (idx < distinct.length - 1) {
    const next = distinct[idx + 1];
    const nextLabel = resolveChapterLabel(next);
    blocks.push(
      `NEXT CHAPTER (${nextLabel}) — opening excerpt:\n${excerptChapterText(next.userContent, 500)}`
    );
  }
  return blocks.length
    ? `\n\nADJACENT CHAPTER CONTEXT (for structural awareness):\n${blocks.join("\n\n")}`
    : "";
};

/**
 * Ready chapter numbers for gap/advance, mapped onto CURRENT outline rows when
 * a review carries chapterId (same row after add/renumber).
 * @param {Array} reviews
 * @param {Array} [userContents]
 */
export const collectReadyChapterNumbers = (reviews = [], userContents = []) => {
  const currentNumberById = new Map();
  for (const uc of userContents) {
    if (!uc?._id) continue;
    const num = Number(uc.chapterNumber ?? uc.sceneIndex);
    if (Number.isFinite(num)) currentNumberById.set(String(uc._id), num);
  }
  const ready = new Set();
  for (const review of reviews) {
    if (review?.status !== "ready") continue;
    const id = review.chapterId ? String(review.chapterId) : "";
    if (id && currentNumberById.has(id)) {
      ready.add(currentNumberById.get(id));
      continue;
    }
    if (Number.isFinite(Number(review.chapterNumber))) {
      ready.add(Number(review.chapterNumber));
    }
  }
  return ready;
};

/**
 * True when the writer inserted a chapter after higher-numbered chapters
 * already have ready reviews (out-of-order / backfill insert).
 */
export const isEllisBackfillInsert = ({
  insertedChapterNumber,
  readyChapterNumbers = new Set(),
}) => {
  const inserted = Number(insertedChapterNumber);
  if (!isEllisManuscriptChapterNumber(inserted)) return false;
  for (const num of readyChapterNumbers) {
    if (Number(num) > inserted) return true;
  }
  return false;
};

/**
 * First manuscript-map chapter without a ready review, or null if all are ready.
 * @param {Iterable<number>} readyChapterNumbers
 */
export const resolveNextEllisOpenChapter = (
  orderedChapters = [],
  readyChapterNumbers = new Set()
) => {
  const ready =
    readyChapterNumbers instanceof Set
      ? readyChapterNumbers
      : new Set(readyChapterNumbers);
  const ordered = getDistinctBaseChapterRows(orderedChapters);
  for (const row of ordered) {
    const num = Number(row.chapterNumber ?? row.sceneIndex);
    if (!isEllisManuscriptChapterNumber(num)) continue;
    if (!ready.has(num)) return row;
  }
  return null;
};

/**
 * First Revision Plan gap chapter for advance intent ("next chapter").
 * Uses EllisChapterReview ready status, not manuscript-order N+1.
 */
export const resolveEllisAdvanceTargetChapter = async ({
  userContents = [],
  novelId,
  userId,
  readyReviews = null,
}) => {
  const reviews =
    readyReviews ??
    (await EllisChapterReview.find({
      novel: novelId,
      user: userId,
      status: "ready",
    })
      .select("chapterNumber chapterSuffix status chapterId")
      .lean());
  const readyChapterNumbers = collectReadyChapterNumbers(reviews, userContents);
  return resolveNextEllisOpenChapter(userContents, readyChapterNumbers);
};
