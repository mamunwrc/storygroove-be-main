/**
 * Chapter Plan export — all inserted Ellis chapter reviews + Chapter Notes as a .docx.
 */
import {
  Document,
  Packer,
  Paragraph,
  SectionType,
  VerticalAlignSection,
} from "docx";
import { letterPage } from "../utils/docxPageSetup.js";
import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import Notes from "../models/notesModel.js";
import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import {
  outlineCenteredTitleParagraph,
  outlineSectionTitleParagraph,
  outlineSpacerParagraph,
  outlineMarkdownToDocxParagraphs,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";
import {
  ellisReviewMarkdownToDocxParagraphs,
  ellisItalicNoteParagraph,
} from "../utils/ellisReviewTextToDocx.js";

export class ChapterPlanExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ChapterPlanExportError";
    this.statusCode = statusCode;
  }
}

export const buildSafeChapterPlanFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Chapter_Plan", "Manuscript");

const chapterHeadingLabel = (review) => {
  const label = String(review.chapterLabel || "").trim();
  if (label) return label;
  return `Chapter ${review.chapterNumber}`;
};

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateChapterPlanDocx = async ({ novelId, userId }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId })
    .select("name")
    .lean();
  if (!novel) {
    throw new ChapterPlanExportError("Novel not found", 404);
  }

  const reviews = await EllisChapterReview.find({
    novel: novelId,
    user: userId,
    status: "ready",
  })
    .select("chapterNumber chapterLabel reviewMarkdown")
    .sort({ chapterNumber: 1 })
    .lean();

  if (!reviews.length) {
    throw new ChapterPlanExportError(
      "No chapter reviews have been inserted into your Revision Plan yet",
      404
    );
  }

  const chapterNumbers = reviews.map((r) => Number(r.chapterNumber));
  const userContents = await UserContent.find({
    novelId,
    user: userId,
    chapterNumber: { $in: chapterNumbers },
  })
    .select("_id chapterNumber")
    .lean();

  const contentIdByChapter = new Map();
  for (const uc of userContents) {
    const num = Number(uc.chapterNumber);
    if (!Number.isFinite(num)) continue;
    if (!contentIdByChapter.has(num)) {
      contentIdByChapter.set(num, String(uc._id));
    }
  }

  const contentIds = [...contentIdByChapter.values()];
  const notes =
    contentIds.length > 0
      ? await Notes.find({
          novelId,
          user: userId,
          userContentId: { $in: contentIds },
        })
          .select("userContentId note")
          .lean()
      : [];

  const noteByContentId = new Map();
  for (const n of notes) {
    if (n.userContentId) {
      noteByContentId.set(String(n.userContentId), String(n.note || "").trim());
    }
  }

  const page = letterPage();

  const novelTitle =
    stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";

  const titlePageChildren = [
    outlineCenteredTitleParagraph(novelTitle, { bold: true, size: 64 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("Chapter Plan", { size: 32 }),
  ];

  const bodyChildren = [];
  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];

    const markdown = String(review.reviewMarkdown || "").trim();
    if (markdown) {
      bodyChildren.push(...ellisReviewMarkdownToDocxParagraphs(markdown));
    } else {
      const heading = chapterHeadingLabel(review);
      bodyChildren.push(outlineSectionTitleParagraph(heading, 1));
      bodyChildren.push(
        new Paragraph({
          children: parseInlineRuns(
            "No review content available for this chapter."
          ),
        })
      );
    }

    bodyChildren.push(outlineSpacerParagraph(120));
    bodyChildren.push(outlineSectionTitleParagraph("Chapter Notes", 2));

    const contentId = contentIdByChapter.get(Number(review.chapterNumber));
    const noteText = contentId ? noteByContentId.get(contentId) || "" : "";
    if (noteText) {
      bodyChildren.push(...outlineMarkdownToDocxParagraphs(noteText));
    } else {
      bodyChildren.push(ellisItalicNoteParagraph("No chapter notes."));
    }

    if (i < reviews.length - 1) {
      bodyChildren.push(outlineSpacerParagraph(360));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page,
          verticalAlign: VerticalAlignSection.CENTER,
        },
        children: titlePageChildren,
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page,
        },
        children: bodyChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeChapterPlanFilename(novel.name),
  };
};
