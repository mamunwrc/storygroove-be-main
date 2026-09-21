import Message from "../models/messageModel.js";
import {
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
} from "../constants/ellisUiMessages.js";

const suffixOf = (value) => {
  const suffix = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]$/.test(suffix) ? suffix : "";
};

/**
 * Two-phase remap of EllisChapterReview.chapterNumber to avoid unique-index
 * collisions on (novel, chapterNumber, chapterSuffix).
 *
 * @param {object} opts
 * @param {import("mongoose").Model} opts.EllisChapterReview
 * @param {Array<{ oldNumber: number, newNumber: number, chapterSuffix?: string }>} opts.remap
 */
export const remapEllisReviewNumbers = async ({
  EllisChapterReview,
  novelId,
  userId,
  remap = [],
}) => {
  const pairs = (Array.isArray(remap) ? remap : []).filter((m) => {
    if (!Number.isFinite(Number(m?.newNumber))) return false;
    if (m.chapterId) return true;
    return (
      Number.isFinite(Number(m?.oldNumber)) &&
      Number(m.oldNumber) !== Number(m.newNumber)
    );
  });
  if (!pairs.length) return { remapped: 0 };

  const phase1 = pairs.map((m, i) => ({
    updateOne: {
      filter: m.chapterId
        ? { novel: novelId, user: userId, chapterId: m.chapterId }
        : {
            novel: novelId,
            user: userId,
            chapterNumber: Number(m.oldNumber),
            chapterSuffix: suffixOf(m.chapterSuffix),
          },
      update: { $set: { chapterNumber: -(1_000_000 + i) } },
    },
  }));
  await EllisChapterReview.bulkWrite(phase1, { ordered: true });

  const phase2 = pairs.map((m, i) => ({
    updateOne: {
      filter: m.chapterId
        ? { novel: novelId, user: userId, chapterId: m.chapterId }
        : {
            novel: novelId,
            user: userId,
            chapterNumber: -(1_000_000 + i),
            chapterSuffix: suffixOf(m.chapterSuffix),
          },
      update: { $set: { chapterNumber: Number(m.newNumber) } },
    },
  }));
  await EllisChapterReview.bulkWrite(phase2, { ordered: true });

  return { remapped: pairs.length };
};

/**
 * Remap EllisChapterReview.chapterNumber after uploaded-manuscript chapter reorder.
 * Chapters in NEW reading order; each row still carries its OLD chapterNumber.
 */
export const remapEllisReviewsAfterChapterReorder = async ({
  EllisChapterReview,
  novelId,
  userId,
  orderedChapters = [],
}) => {
  const remap = orderedChapters
    .map((row, i) => {
      const oldNumber = Number(row.chapterNumber);
      const newNumber = i + 1;
      if (!Number.isFinite(oldNumber) || oldNumber === newNumber) return null;
      return {
        oldNumber,
        newNumber,
        chapterSuffix: suffixOf(row.chapterSuffix),
        chapterId: row._id ? String(row._id) : null,
      };
    })
    .filter(Boolean);

  const result = await remapEllisReviewNumbers({
    EllisChapterReview,
    novelId,
    userId,
    remap,
  });
  if (result.remapped) {
    await remapEllisReviewMessageChapterNumbers({ remap });
  }
  return result;
};

/** Shifted rows after an insert (still carrying OLD chapterNumber). newNum = insertAt + i + 2. */
export const buildEllisAddChapterRemap = (shiftedRows = [], insertAt) =>
  shiftedRows
    .map((row, i) => {
      const oldNumber = Number(row.chapterNumber);
      const newNumber = Number(insertAt) + i + 2;
      if (!Number.isFinite(oldNumber) || oldNumber === newNumber) return null;
      return {
        oldNumber,
        newNumber,
        chapterSuffix: suffixOf(row.chapterSuffix),
        chapterId: row._id ? String(row._id) : null,
      };
    })
    .filter(Boolean);

/**
 * Keep chat metadata.chapterNumber in sync with the outline row after a shift.
 * Matches on stable metadata.chapterId so stale numbers still update.
 */
export const remapEllisReviewMessageChapterNumbers = async ({
  remap = [],
  Message: MessageModel = Message,
}) => {
  const pairs = (Array.isArray(remap) ? remap : []).filter(
    (m) => m?.chapterId && Number.isFinite(Number(m.newNumber))
  );
  for (const m of pairs) {
    await MessageModel.updateMany(
      {
        "metadata.chapterId": String(m.chapterId),
        "metadata.kind": {
          $in: [
            ELLIS_METADATA_KIND_CHAPTER_REVIEW,
            ELLIS_METADATA_KIND_REVISION_REVIEW,
          ],
        },
      },
      { $set: { "metadata.chapterNumber": Number(m.newNumber) } }
    );
  }
};
