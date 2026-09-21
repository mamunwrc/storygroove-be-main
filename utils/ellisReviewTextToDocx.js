/**
 * Converts Ellis Scene Architect review markdown into docx Paragraph nodes
 * with section labels, creative-suggestion sub-labels, and inline bold.
 */
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  LineRuleType,
} from "docx";

const DEFAULT_FONT = "Times New Roman";
const BODY_SIZE = 24;

const ELLIS_SECTION_SPLIT_RE = new RegExp(
  "^\\s*(?:#{1,6}\\s+)?(?:[-*•]\\s+)?\\**\\s*(" +
    "Chapter\\s+(?:\\d+[A-Za-z]?|[A-Za-z]+)(?:\\s*[–—-]\\s*POV\\s*:[^\\n]*|)|" +
    "POV\\s*:[^\\n]*|" +
    "Function in Story|" +
    "Genre Beat Check|" +
    "🔍\\s*Scene Analysis(?:\\s*\\([^)]*\\)|\\s*[—–-]\\s*Editorial Review)?|" +
    "Scene Analysis(?:\\s*\\([^)]*\\)|\\s*[—–-]\\s*Editorial Review)?|" +
    "🎨\\s*Creative Suggestions(?:\\s*\\([^)]*\\))?|" +
    "Creative Suggestions(?:\\s*\\([^)]*\\))?|" +
    "📌\\s*Chapter Cumulative Editorial Note" +
    ")\\s*\\**(?:\\s*[:-]\\s*|\\s+)?(.*)$",
  "i"
);

const ELLIS_SUB_LABEL_RE =
  /^\s*\*{0,2}\s*(Structural Weakness|Character Weakness|Creative Suggestion Name|(?:Editorial Logic|Description)|(?:Application\s+)?Example\s*\d+)\s*\*{0,2}\s*:\s*(.*)$/i;

function bodySpacing(before = 0, after = 80) {
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
  if (style.color) opts.color = style.color;
  return new TextRun(opts);
}

/** Split inline **bold** markers into TextRuns. */
export function parseEllisInlineRuns(text, baseStyle = {}) {
  if (!text) return [makeTextRun("", baseStyle)];
  const runs = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      runs.push(makeTextRun(boldMatch[1], { ...baseStyle, bold: true }));
    } else {
      runs.push(makeTextRun(part, baseStyle));
    }
  }
  return runs.length ? runs : [makeTextRun("", baseStyle)];
}

function paragraphFromRuns(runs, opts = {}) {
  return new Paragraph({
    children: runs.length ? runs : [makeTextRun("")],
    alignment: opts.alignment,
    heading: opts.heading,
    spacing: opts.spacing ?? bodySpacing(),
    indent: opts.indent,
  });
}

function headingParagraph(text, level = 1) {
  const sizes = { 1: 32, 2: 28, 3: 26 };
  const size = sizes[level] || 26;
  const hl =
    level <= 3
      ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
          level - 1
        ]
      : HeadingLevel.HEADING_3;
  return paragraphFromRuns(parseEllisInlineRuns(text, { bold: true, size }), {
    heading: hl,
    spacing: bodySpacing(level === 1 ? 240 : 160, 120),
  });
}

function sectionLabelParagraph(text) {
  return paragraphFromRuns(
    parseEllisInlineRuns(text, { bold: true, size: 26 }),
    { spacing: bodySpacing(200, 80) }
  );
}

function subLabelParagraph(label, value) {
  const runs = [
    makeTextRun(`${label}:`, { bold: true, size: BODY_SIZE }),
  ];
  if (value) {
    runs.push(makeTextRun(" "));
    runs.push(...parseEllisInlineRuns(value));
  }
  return paragraphFromRuns(runs, { spacing: bodySpacing(100, 40) });
}

function bodyParagraph(text) {
  return paragraphFromRuns(parseEllisInlineRuns(text), {
    spacing: bodySpacing(0, 100),
  });
}

function isHrLine(line) {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(String(line || "").trim());
}

function isChapterOpener(line) {
  return /^Chapter\s+(?:\d+[A-Za-z]?|[A-Za-z]+)\b/i.test(
    String(line || "")
      .trim()
      .replace(/^\*+|\*+$/g, "")
  );
}

function parseEllisSectionLine(line) {
  const stripped = String(line || "")
    .trim()
    .replace(/^\s*(?:[-*•]\s+)?/, "")
    .replace(/^\*+\s*|\s*\*+$/g, "");
  const match = stripped.match(ELLIS_SECTION_SPLIT_RE);
  if (!match) return null;
  return {
    label: match[1].trim(),
    body: (match[2] || "").trim(),
  };
}

function parseSubLabelLine(line) {
  const match = String(line || "").trim().match(ELLIS_SUB_LABEL_RE);
  if (!match) return null;
  return {
    label: match[1].trim(),
    value: (match[2] || "").trim(),
  };
}

function flushBodyLines(lines, paragraphs) {
  if (!lines.length) return;
  paragraphs.push(bodyParagraph(lines.join(" ")));
  lines.length = 0;
}

/**
 * Parse Ellis Scene Architect review markdown into docx Paragraph[].
 */
export function ellisReviewMarkdownToDocxParagraphs(text) {
  if (!text || !String(text).trim()) return [];

  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const paragraphs = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (isHrLine(trimmed)) {
      paragraphs.push(
        new Paragraph({
          children: [makeTextRun("")],
          border: {
            bottom: {
              color: "CBD5E1",
              space: 1,
              style: "single",
              size: 6,
            },
          },
          spacing: bodySpacing(80, 80),
        })
      );
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      paragraphs.push(
        headingParagraph(headingMatch[2], headingMatch[1].length)
      );
      i++;
      continue;
    }

    const section = parseEllisSectionLine(trimmed);
    if (section) {
      if (isChapterOpener(section.label)) {
        const opener = section.body
          ? `${section.label} ${section.body}`.trim()
          : section.label;
        paragraphs.push(headingParagraph(opener, 2));
      } else {
        paragraphs.push(sectionLabelParagraph(section.label));
        if (section.body) {
          paragraphs.push(bodyParagraph(section.body));
        }
      }
      i++;
      continue;
    }

    const sub = parseSubLabelLine(trimmed);
    if (sub) {
      paragraphs.push(subLabelParagraph(sub.label, sub.value));
      i++;
      continue;
    }

    if (/^\s*[-•*]\s+/.test(raw)) {
      const bulletText = raw.replace(/^\s*[-•*]\s+/, "").trim();
      paragraphs.push(
        paragraphFromRuns(parseEllisInlineRuns(bulletText), {
          indent: { left: 360 },
          spacing: bodySpacing(40, 40),
        })
      );
      i++;
      continue;
    }

    const paraLines = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrim = next.trim();
      if (!nextTrim) break;
      if (
        isHrLine(nextTrim) ||
        /^(#{1,3})\s+/.test(nextTrim) ||
        parseEllisSectionLine(nextTrim) ||
        parseSubLabelLine(nextTrim) ||
        /^\s*[-•*]\s+/.test(next)
      ) {
        break;
      }
      paraLines.push(nextTrim);
      i++;
    }
    flushBodyLines(paraLines, paragraphs);
  }

  return paragraphs;
}

export function ellisItalicNoteParagraph(text) {
  return new Paragraph({
    children: [
      makeTextRun(text, { italics: true, size: BODY_SIZE }),
    ],
    spacing: bodySpacing(0, 80),
  });
}
