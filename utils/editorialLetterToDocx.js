/**
 * Converts formatted editorial-letter markdown into docx Paragraph nodes.
 */
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  LineRuleType,
} from "docx";
import { parseInlineRuns } from "./outlineTextToDocx.js";

const DEFAULT_FONT = "Times New Roman";
const BODY_SIZE = 24;

function letterSpacing(before = 0, after = 80) {
  return {
    before,
    after,
    line: 360,
    lineRule: LineRuleType.AUTO,
  };
}

function makeTextRun(text, style = {}) {
  const opts = {
    text: text ?? "",
    font: DEFAULT_FONT,
    size: style.size != null ? style.size : BODY_SIZE,
  };
  if (style.bold) opts.bold = true;
  if (style.italics) opts.italics = true;
  return new TextRun(opts);
}

function bodyParagraph(text) {
  return new Paragraph({
    children: parseInlineRuns(text),
    spacing: letterSpacing(0, 80),
  });
}

function greetingParagraph(text) {
  return new Paragraph({
    children: parseInlineRuns(text, { bold: true, size: 28 }),
    spacing: letterSpacing(0, 80),
  });
}

function sectionHeadingParagraph(text) {
  return new Paragraph({
    children: parseInlineRuns(text, { bold: true, size: 26 }),
    heading: HeadingLevel.HEADING_2,
    spacing: letterSpacing(320, 120),
  });
}

function boldLabelParagraph(text) {
  return new Paragraph({
    children: parseInlineRuns(text, { bold: true }),
    spacing: letterSpacing(160, 80),
  });
}

function italicParagraph(text) {
  return new Paragraph({
    children: [makeTextRun(text, { italics: true, size: 20 })],
    spacing: letterSpacing(80, 80),
  });
}

function signatureDividerParagraph() {
  return new Paragraph({
    children: [makeTextRun("")],
    spacing: letterSpacing(240, 80),
    border: {
      bottom: {
        color: "CCD4D8",
        space: 1,
        style: "single",
        size: 6,
      },
    },
  });
}

const FULL_BOLD_RE = /^\*\*([\s\S]+)\*\*$/;
const FULL_ITALIC_RE = /^\*([\s\S]+)\*$/;
const GREETING_RE = /^Hello [^,]+,$/;
const SECTION_NUMBER_RE = /^\d+\.\s+/;

/**
 * @param {string} formattedMarkdown - output of formatEditorialLetterMarkdown
 * @returns {import("docx").Paragraph[]}
 */
export function editorialLetterMarkdownToDocxParagraphs(formattedMarkdown) {
  if (!formattedMarkdown || !String(formattedMarkdown).trim()) return [];

  const blocks = String(formattedMarkdown).replace(/\r\n/g, "\n").split(/\n\n+/);
  const paragraphs = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed === "---") {
      paragraphs.push(signatureDividerParagraph());
      continue;
    }

    const fullBold = trimmed.match(FULL_BOLD_RE);
    if (fullBold) {
      const text = fullBold[1].trim();
      if (GREETING_RE.test(text)) {
        paragraphs.push(greetingParagraph(text));
        continue;
      }
      if (SECTION_NUMBER_RE.test(text)) {
        paragraphs.push(sectionHeadingParagraph(text));
        continue;
      }
      paragraphs.push(boldLabelParagraph(text));
      continue;
    }

    const fullItalic = trimmed.match(FULL_ITALIC_RE);
    if (fullItalic) {
      paragraphs.push(italicParagraph(fullItalic[1].trim()));
      continue;
    }

    paragraphs.push(bodyParagraph(trimmed));
  }

  return paragraphs;
}
