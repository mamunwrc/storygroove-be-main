/**
 * Story Bible export — dossier-free Story Bible (or legacy world sections) as a .docx file.
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
import { stripDossierBlocksFromMasterPrompt } from "../service/characterCanonContext.js";
import { sliceStoryBibleForDisplay } from "../utils/storyBibleDisplay.js";
import {
  outlineCenteredTitleParagraph,
  outlineMarkdownToDocxParagraphs,
  outlineSectionTitleParagraph,
  outlineSpacerParagraph,
  parseInlineRuns,
} from "../utils/outlineTextToDocx.js";

export class StoryBibleExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "StoryBibleExportError";
    this.statusCode = statusCode;
  }
}

export const buildSafeStoryBibleFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Story_Bible", "Novel");

const resolveStoryBibleText = (novel) => {
  const storyBible = String(novel.storyBible || "").trim();
  if (storyBible) return sliceStoryBibleForDisplay(storyBible);

  const masterPrompt = String(novel.masterPrompt || "").trim();
  if (masterPrompt) {
    return sliceStoryBibleForDisplay(
      stripDossierBlocksFromMasterPrompt(masterPrompt)
    );
  }

  return "";
};

export const hasStoryBibleExportContent = (novel) => {
  if (resolveStoryBibleText(novel)) return true;
  if (String(novel.worldBuilding || "").trim()) return true;
  if (String(novel.specialElements || "").trim()) return true;
  return false;
};

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateStoryBibleDocx = async ({ novelId, userId, user }) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
  if (!novel) {
    throw new StoryBibleExportError("Novel not found", 404);
  }

  if (!hasStoryBibleExportContent(novel)) {
    throw new StoryBibleExportError(
      "No Story Bible content found for this novel",
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
    outlineCenteredTitleParagraph("Story Bible", { size: 32 }),
    outlineCenteredTitleParagraph(""),
    outlineCenteredTitleParagraph("by", { italics: true, size: 28 }),
    outlineCenteredTitleParagraph(authorName || "", { size: 32 }),
  ];

  const bodyChildren = [];
  const storyBibleText = resolveStoryBibleText(novel);
  const worldBuilding = String(novel.worldBuilding || "").trim();
  const specialElements = String(novel.specialElements || "").trim();

  if (storyBibleText) {
    bodyChildren.push(
      ...outlineMarkdownToDocxParagraphs(storyBibleText, {
        preserveSingleLineBreaks: true,
      })
    );
  } else {
    if (worldBuilding) {
      bodyChildren.push(outlineSectionTitleParagraph("World Building", 1));
      bodyChildren.push(...outlineMarkdownToDocxParagraphs(worldBuilding));
      bodyChildren.push(outlineSpacerParagraph(240));
    }
    if (specialElements) {
      bodyChildren.push(outlineSectionTitleParagraph("Special Elements", 1));
      bodyChildren.push(...outlineMarkdownToDocxParagraphs(specialElements));
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
        children: bodyChildren.length
          ? bodyChildren
          : [
              new Paragraph({
                children: parseInlineRuns("No Story Bible content available."),
              }),
            ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: buildSafeStoryBibleFilename(novel.name),
  };
};
