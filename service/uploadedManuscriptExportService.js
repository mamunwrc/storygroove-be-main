/**
 * Full manuscript export for uploaded (Ellis) novels — flat chapter order,
 * Ellis-detectable headers, no act/scene scaffolding.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Header,
  PageNumber,
  TabStopPosition,
  TabStopType,
  SectionType,
  VerticalAlignSection,
  LineRuleType,
} from "docx";
import { letterPage } from "../utils/docxPageSetup.js";
import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import { buildSafeDocxFilenameFromTitle } from "../utils/downloadFilename.js";
import { parseHtmlToDocxParagraphs, getManuscriptNumberingConfig } from "../utils/htmlToDocx.js";
import {
  resolveChapterExportMeta,
  stripLeadingSceneTitleFromHtml,
  stripSceneBreakOrnamentsFromHtml,
  stripChapterHtmlToText,
  userContentHasProse,
} from "../utils/manuscriptText.js";
import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";

const FONT = "Times New Roman";

export class UploadedManuscriptExportError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "UploadedManuscriptExportError";
    this.statusCode = statusCode;
  }
}

const normalizeComparableText = (value = "") =>
  String(value).replace(/\s+/g, " ").trim();

export const buildSafeUploadedManuscriptFilename = (novelName) =>
  buildSafeDocxFilenameFromTitle(novelName, "Manuscript", "Novel");

/**
 * Whether sceneTitle should appear as an italic subtitle under the chapter header.
 */
export const shouldExportSceneTitleSubtitle = (uc = {}) => {
  const sceneTitle = stripMarkdownForDocx(String(uc.sceneTitle || "")).trim();
  if (!sceneTitle) return false;

  const chapterLabel = stripMarkdownForDocx(
    String(uc.chapterLabel || "")
  ).trim();

  if (
    chapterLabel &&
    normalizeComparableText(chapterLabel).localeCompare(
      normalizeComparableText(sceneTitle),
      undefined,
      { sensitivity: "accent" }
    ) === 0
  ) {
    return false;
  }

  return true;
};

/**
 * Sanitize stored chapter HTML for export (mirrors upload viewer display rules).
 */
export const sanitizeUploadedChapterHtmlForExport = (uc = {}) => {
  const html = String(uc.userContent || "");
  if (!html.trim()) return "";

  return stripSceneBreakOrnamentsFromHtml(
    stripLeadingSceneTitleFromHtml(html, { sceneTitle: uc.sceneTitle })
  );
};

/** Chapter rows that have real prose (skips Quill empty saves). */
export const getUploadedManuscriptExportRows = (userContents = []) =>
  getUploadedChapterRows(userContents).filter((uc) =>
    userContentHasProse(uc.userContent)
  );

/**
 * Serializable export plan per chapter — used by tests and docx builder.
 * @param {object[]} userContents
 * @returns {{ chapters: Array<{ headerLine: string, subtitle: string|null, bodyText: string }> }}
 */
export const planUploadedManuscriptExport = (userContents = []) => {
  const rows = getUploadedManuscriptExportRows(userContents);

  return {
    chapters: rows.map((uc) => {
      const { headerLine } = resolveChapterExportMeta(uc, {
        globalSceneNum: Number(uc.chapterNumber || uc.sceneIndex) || 1,
        responseText: "",
      });

      const subtitle = shouldExportSceneTitleSubtitle(uc)
        ? stripMarkdownForDocx(String(uc.sceneTitle || "")).trim()
        : null;

      const sanitizedHtml = sanitizeUploadedChapterHtmlForExport(uc);
      const bodyText = stripChapterHtmlToText(sanitizedHtml);

      return { headerLine, subtitle, bodyText, sanitizedHtml };
    }),
  };
};

const buildTitlePageChildren = (novel, authorName) => {
  const novelTitle =
    stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";

  const tp = (text, opts = {}) =>
    new Paragraph({
      children: [new TextRun({ text, font: FONT, ...opts })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 0, line: 480, lineRule: LineRuleType.AUTO },
    });

  const titlePageChildren = [
    tp(novelTitle, { bold: true, size: 64 }),
    tp(""),
    tp("by", { italics: true, size: 28 }),
    tp(authorName || "", { size: 32 }),
  ];

  if (novel.genre) {
    const genreDisplay = stripMarkdownForDocx(String(novel.genre));
    if (genreDisplay) {
      titlePageChildren.push(tp(""));
      titlePageChildren.push(tp(genreDisplay, { italics: true, size: 24 }));
    }
  }

  if (novel.wordCount != null && Number.isFinite(Number(novel.wordCount))) {
    const rounded =
      Math.round(Number(novel.wordCount) / 1000) * 1000 ||
      Number(novel.wordCount);
    titlePageChildren.push(
      tp(`Approximately ${rounded.toLocaleString()} words`, { size: 24 })
    );
  }

  return titlePageChildren;
};

const buildRunningHeader = (novelTitle, authorName) => {
  const authorSurname = authorName
    ? authorName.trim().split(/\s+/).pop().toUpperCase()
    : "";
  const shortTitle = novelTitle.toUpperCase().slice(0, 40);
  const headerLeft = [authorSurname, shortTitle].filter(Boolean).join(" / ");

  return new Header({
    children: [
      new Paragraph({
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        children: [
          new TextRun({
            text: headerLeft,
            font: FONT,
            size: 20,
          }),
          new TextRun({
            children: ["\t", PageNumber.CURRENT],
            font: FONT,
            size: 20,
          }),
        ],
      }),
    ],
  });
};

const chapterHeaderParagraph = (title, { pageBreakBefore = false } = {}) =>
  new Paragraph({
    children: [
      new TextRun({
        text: title,
        font: FONT,
        size: 26,
        bold: true,
      }),
    ],
    alignment: AlignmentType.CENTER,
    pageBreakBefore: pageBreakBefore || undefined,
    spacing: {
      before: 0,
      after: 240,
      line: 480,
      lineRule: LineRuleType.AUTO,
    },
  });

const sceneTitleSubtitleParagraph = (title) =>
  new Paragraph({
    children: [
      new TextRun({
        text: title,
        font: FONT,
        size: 24,
        italics: true,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480, line: 480, lineRule: LineRuleType.AUTO },
  });

/**
 * Build docx section children for one uploaded chapter.
 */
export const buildUploadedChapterSectionChildren = (
  uc = {},
  { pageBreakBefore = false } = {}
) => {
  const { headerLine } = resolveChapterExportMeta(uc, {
    globalSceneNum: Number(uc.chapterNumber || uc.sceneIndex) || 1,
    responseText: "",
  });

  const children = [chapterHeaderParagraph(headerLine, { pageBreakBefore })];

  if (shouldExportSceneTitleSubtitle(uc)) {
    children.push(
      sceneTitleSubtitleParagraph(
        stripMarkdownForDocx(String(uc.sceneTitle || "")).trim()
      )
    );
  }

  const sanitizedHtml = sanitizeUploadedChapterHtmlForExport(uc);
  children.push(...parseHtmlToDocxParagraphs(sanitizedHtml));

  return children;
};

/**
 * @param {{ novel: object, chapterRows: object[], user?: object }} params
 * @returns {import("docx").Document}
 */
export const buildUploadedManuscriptDocument = ({
  novel,
  chapterRows,
  user,
}) => {
  const page = letterPage({ withHeaderFooter: true });
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

  const runningHeader = buildRunningHeader(novelTitle, authorName);
  const bodyChildren = [];
  chapterRows.forEach((uc, i) => {
    bodyChildren.push(
      ...buildUploadedChapterSectionChildren(uc, { pageBreakBefore: i > 0 })
    );
  });

  return new Document({
    numbering: getManuscriptNumberingConfig(),
    sections: [
      {
        properties: {
          page,
          verticalAlign: VerticalAlignSection.CENTER,
        },
        children: buildTitlePageChildren(novel, authorName),
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page,
        },
        headers: {
          default: runningHeader,
        },
        children: bodyChildren,
      },
    ],
  });
};

/**
 * @param {{ novelId: string, userId: string, user?: object }} params
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
export const generateUploadedManuscriptDocx = async ({
  novelId,
  userId,
  user,
}) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
  if (!novel) {
    throw new UploadedManuscriptExportError("Novel not found", 404);
  }

  const userContents = await UserContent.find({
    novelId,
    user: userId,
    userContent: { $exists: true, $ne: "" },
  })
    .select(
      "sceneTitle userContent sceneIndex chapterNumber chapterLabel pov timeline chapterSummary actNumber"
    )
    .sort({ sceneIndex: 1, createdAt: 1 })
    .lean();

  const chapterRows = getUploadedManuscriptExportRows(userContents);
  if (!chapterRows.length) {
    throw new UploadedManuscriptExportError(
      "No content found for this novel",
      404
    );
  }

  const doc = buildUploadedManuscriptDocument({ novel, chapterRows, user });
  const buffer = await Packer.toBuffer(doc);

  return {
    buffer,
    filename: buildSafeUploadedManuscriptFilename(novel.name),
  };
};
