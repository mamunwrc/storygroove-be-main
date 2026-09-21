/**
 * Editorial Letter export — Ellis Phase 1 global letter as a .docx file.
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
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import {
  outlineCenteredTitleParagraph,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";
import { formatEditorialLetterMarkdown } from "../utils/editorialLetterFormat.js";
import { editorialLetterMarkdownToDocxParagraphs } from "../utils/editorialLetterToDocx.js";

export class EditorialLetterExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "EditorialLetterExportError";
    this.statusCode = statusCode;
  }
}

export const buildSafeEditorialLetterFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Editorial_Letter", "Manuscript");

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateEditorialLetterDocx = async ({ novelId, userId, user }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId })
    .select("name editorialLetter editorialLetterStatus")
    .lean();
  if (!novel) {
    throw new EditorialLetterExportError("Novel not found", 404);
  }

  const letter =
    typeof novel.editorialLetter === "string" ? novel.editorialLetter.trim() : "";
  if (!letter || novel.editorialLetterStatus !== "ready") {
    throw new EditorialLetterExportError(
      "No saved editorial letter is available to download yet",
      404
    );
  }

  const page = letterPage();

  const novelTitle =
    stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";

  const titlePageChildren = [
    outlineCenteredTitleParagraph(novelTitle, { bold: true, size: 64 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("Editorial Letter", { size: 32 }),
  ];

  const formattedLetter = formatEditorialLetterMarkdown(letter);
  const bodyChildren = editorialLetterMarkdownToDocxParagraphs(formattedLetter);

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
                children: parseInlineRuns("No editorial letter content available."),
              }),
            ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeEditorialLetterFilename(novel.name),
  };
};
