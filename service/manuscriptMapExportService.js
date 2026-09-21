/**
 * Manuscript Map export — a chapter / POV / summary table for an
 * uploaded manuscript, rendered as a .docx file. Sibling to the outline export
 * but sourced from the parsed draft rather than generated outline beats.
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
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import {
  buildManuscriptMapRows,
  formatManuscriptMapAsMarkdownTable,
} from "../utils/buildOutlineSceneRows.js";
import {
  outlineMarkdownToDocxParagraphs,
  outlineSectionTitleParagraph,
  outlineCenteredTitleParagraph,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";

export class ManuscriptMapExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ManuscriptMapExportError";
    this.statusCode = statusCode;
  }
}

export const buildSafeManuscriptMapFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Manuscript_Map", "Manuscript");

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateManuscriptMapDocx = async ({ novelId, userId, user }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
  if (!novel) {
    throw new ManuscriptMapExportError("Novel not found", 404);
  }

  const userContents = await UserContent.find({ novelId, user: userId })
    .select("chapterNumber chapterLabel pov timeline sceneTitle sceneIndex chapterSummary actNumber userContent")
    .sort({ sceneIndex: 1, createdAt: 1 })
    .lean();

  const rows = buildManuscriptMapRows(userContents);
  if (!rows.length) {
    throw new ManuscriptMapExportError(
      "No manuscript chapters found for this novel",
      404
    );
  }

  const page = letterPage();

  const novelTitle =
    stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";
  const storyBibleByline =
    typeof novel.storyBibleAuthor === "string"
      ? stripMarkdownForDocx(novel.storyBibleAuthor.trim())
      : "";
  const authorName =
    storyBibleByline ||
    [user?.fname, user?.lname].filter(Boolean).join(" ").trim() ||
    user?.username ||
    "";

  const titlePageChildren = [
    outlineCenteredTitleParagraph(novelTitle, { bold: true, size: 64 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("Manuscript Map", { size: 32 }),
  ];
  if (authorName) {
    titlePageChildren.push(outlineCenteredTitleParagraph(""));
    titlePageChildren.push(
      outlineCenteredTitleParagraph("by", { italics: true, size: 28 })
    );
    titlePageChildren.push(
      outlineCenteredTitleParagraph(authorName, { size: 32 })
    );
  }
  const genreDisplay = [novel.genre, novel.subgenre]
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => stripMarkdownForDocx(String(v)))
    .join(" / ");
  if (genreDisplay) {
    titlePageChildren.push(outlineCenteredTitleParagraph(""));
    titlePageChildren.push(
      outlineCenteredTitleParagraph(genreDisplay, { italics: true, size: 24 })
    );
  }

  const bodyChildren = [outlineSectionTitleParagraph("Manuscript Map", 1)];
  const tableMd = formatManuscriptMapAsMarkdownTable(rows);
  bodyChildren.push(...outlineMarkdownToDocxParagraphs(tableMd));

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
        children: bodyChildren.length
          ? bodyChildren
          : [
              new Paragraph({
                children: parseInlineRuns("No chapters available."),
              }),
            ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeManuscriptMapFilename(novel.name),
  };
};
