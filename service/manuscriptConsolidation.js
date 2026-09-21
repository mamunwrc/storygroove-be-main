import { encode } from "html-entities";
import UserContent from "../models/userContentModel.js";
import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import Novel from "../models/novelModel.js";
import {
  compareChapterRows,
  normalizeChapterSuffix,
  numberToWords,
} from "../utils/manuscriptParser.js";

/**
 * Merge multiple UserContent rows for the same chapterNumber into one HTML
 * body. Concatenates each row's original `userContent` HTML as-is (instead
 * of flattening to plain text) so DOCX-imported formatting — alignment,
 * bold/italic/underline/strike, headings, lists, links — survives the merge.
 */
export const mergeUserContentRowsHtml = (rows = []) => {
  const sorted = [...rows].sort(compareChapterRows);
  if (!sorted.length) return "";

  const htmlParts = [];
  for (const row of sorted) {
    const num = Number(row.chapterNumber);
    const words = numberToWords(num) || String(num);
    const sectionSuffix = normalizeChapterSuffix(row.chapterSuffix);
    const sectionLabel =
      row.chapterLabel ||
      (sectionSuffix ? `Chapter ${words} ${sectionSuffix}` : `Chapter ${words}`);

    if (sorted.length > 1) {
      htmlParts.push(`<p>${encode(sectionLabel)}</p>`);
    }
    htmlParts.push(String(row.userContent || ""));
  }

  return htmlParts.join("");
};

/**
 * One-time consolidation for uploaded novels that still have separate rows per
 * lettered header (Chapter 7, 7 A, 7 B).
 */
export const consolidateUploadedManuscriptChapters = async ({
  novelId,
  userId,
}) => {
  const novel = await Novel.findOne({
    _id: novelId,
    user: userId,
    uploaded: true,
  }).select("manuscriptChaptersConsolidatedAt uploaded");

  if (!novel) return { consolidated: false, skipped: true };
  if (novel.manuscriptChaptersConsolidatedAt) {
    return { consolidated: false, skipped: true };
  }

  const rows = await UserContent.find({ novelId, user: userId })
    .sort({ sceneIndex: 1, createdAt: 1 })
    .lean();

  const chapterRows = rows.filter(
    (r) => r.chapterNumber != null && Number.isFinite(Number(r.chapterNumber))
  );
  const byNumber = new Map();
  for (const row of chapterRows) {
    const num = Number(row.chapterNumber);
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(row);
  }

  let didMerge = false;
  for (const [num, group] of byNumber.entries()) {
    if (group.length <= 1) continue;
    didMerge = true;

    const sorted = [...group].sort(compareChapterRows);
    const bare = sorted.find((r) => !normalizeChapterSuffix(r.chapterSuffix));
    const primary = bare || sorted[0];
    const words = numberToWords(num) || String(num);
    const mergedHtml = mergeUserContentRowsHtml(sorted);
    const duplicateIds = sorted
      .filter((r) => String(r._id) !== String(primary._id))
      .map((r) => r._id);

    await UserContent.findByIdAndUpdate(primary._id, {
      $set: {
        userContent: mergedHtml,
        chapterSuffix: null,
        chapterLabel: bare?.chapterLabel || primary.chapterLabel || `Chapter ${words}`,
        promptKey: `chapter_${num}`,
      },
    });

    if (duplicateIds.length) {
      await UserContent.deleteMany({ _id: { $in: duplicateIds } });
    }

    const reviews = await EllisChapterReview.find({
      novel: novelId,
      user: userId,
      chapterNumber: num,
    }).lean();

    if (reviews.length) {
      const ranked = [...reviews].sort((a, b) => {
        if (a.status === "ready" && b.status !== "ready") return -1;
        if (b.status === "ready" && a.status !== "ready") return 1;
        return new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0);
      });
      const best = ranked[0];
      if (best) {
        await EllisChapterReview.findOneAndUpdate(
          {
            novel: novelId,
            user: userId,
            chapterNumber: num,
            chapterSuffix: "",
          },
          {
            $set: {
              status: best.status,
              reviewMarkdown: best.reviewMarkdown,
              chapterLabel: bare?.chapterLabel || best.chapterLabel,
              pov: best.pov,
              generatedAt: best.generatedAt,
              error: best.error,
            },
          },
          { upsert: true }
        );
        await EllisChapterReview.deleteMany({
          novel: novelId,
          user: userId,
          chapterNumber: num,
          chapterSuffix: { $regex: /^[A-Z]$/ },
        });
      }
    }
  }

  await Novel.findByIdAndUpdate(novelId, {
    $set: { manuscriptChaptersConsolidatedAt: new Date() },
  });

  return { consolidated: didMerge, skipped: false };
};
