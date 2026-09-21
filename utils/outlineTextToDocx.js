/**
 * Converts Olivia outline markdown (scene design, Story Bible, dossiers)
 * into docx Paragraph nodes.
 */
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { extractScenePov } from "./extractSceneTitle.js";
import { isSceneBreakOrnamentLine } from "./manuscriptText.js";

const DEFAULT_FONT = "Times New Roman";
const BODY_SIZE = 24;

const EMOJI_SECTION_RE =
  /^(📘|🎭|🧩|📏|📝|🏰|⚡|💔|🔗|📈)/;

const SECTION_SPLIT_RE =
  /^\s*(?:[-*•]\s+)?\**\s*((?:📘\s*)?Book Coaching for Scene|(?:🎭\s*)?Genre-Specific Coaching Note(?:\s*\([^)]*\))?|(?:🧩\s*)?Subplot Reminder|(?:📝\s*)?Scene to Write|(?:🏰\s*)?Setting|(?:⚡\s*)?Significant Actions(?:\s*\([^)]*\))?|(?:💔\s*)?Emotional Reactions(?:\s*\([^)]*\))?|(?:🔗\s*)?Subplot Tie-In|(?:📈\s*)?Character Arc Movement)\s*\**(?:\s*[:-]\s*|\s+)?(.*)$/i;

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
  return new TextRun(opts);
}

/** Split inline **bold** markers into TextRuns. */
export function parseInlineRuns(text, baseStyle = {}) {
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
    numbering: opts.numbering,
    spacing: opts.spacing ?? bodySpacing(),
    indent: opts.indent,
  });
}

function bulletParagraph(text) {
  return paragraphFromRuns(parseInlineRuns(text), {
    numbering: {
      reference: "default-bullet-numbering",
      level: 0,
    },
    spacing: bodySpacing(0, 40),
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
  return paragraphFromRuns(parseInlineRuns(text, { bold: true, size }), {
    heading: hl,
    spacing: bodySpacing(level === 1 ? 240 : 160, 120),
  });
}

function sectionLabelParagraph(text) {
  return paragraphFromRuns(parseInlineRuns(text, { bold: true }), {
    spacing: bodySpacing(160, 60),
  });
}

function bodyParagraph(text) {
  return paragraphFromRuns(parseInlineRuns(text), {
    spacing: bodySpacing(0, 80),
  });
}

function isHorizontalRuleLine(line) {
  return isSceneBreakOrnamentLine(line);
}

function horizontalRuleParagraph() {
  return new Paragraph({
    children: [makeTextRun("")],
    spacing: bodySpacing(160, 160),
    border: {
      bottom: {
        color: "B8C4CC",
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
  });
}

function isSectionHeaderLine(line) {
  return SECTION_SPLIT_RE.test(String(line || "").trim());
}

function parseSectionLine(line) {
  const stripped = String(line || "")
    .trim()
    .replace(/^\s*(?:[-*•]\s+)?/, "")
    .replace(/^\*+\s*|\s*\*+$/g, "");
  const match = stripped.match(SECTION_SPLIT_RE);
  if (!match) return null;

  const emojiMatch = stripped.match(/^(📘|🎭|🧩|📝|🏰|⚡|💔|🔗|📈)/u);
  let label = match[1].trim();
  if (emojiMatch && !label.includes(emojiMatch[1])) {
    label = `${emojiMatch[1]} ${label}`;
  }
  if (!label.endsWith(":")) label = `${label}:`;

  return { label, body: (match[2] || "").trim() };
}

/** Insert paragraph breaks when a section label and body share one line. */
function forceInlineSectionBreaks(text) {
  const emoji = "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]";
  const labels = [
    "Book Coaching for Scene",
    "Genre-Specific Coaching Note",
    "Subplot Reminder",
    "Scene to Write",
    "Setting",
    "Significant Actions",
    "Emotional Reactions",
    "Subplot Tie-In",
    "Character Arc Movement",
  ];

  let out = String(text || "");
  for (const label of labels) {
    const base = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(^|\\n)(\\s*(?:[-*•]\\s+)?(?:\\*\\*\\s*)?(?:${emoji}\\s*)?${base}(?:\\s*\\([^\\n)]*\\))?(?:\\s*\\*\\*)?:?)(\\s+)([^\\n])`,
      "gimu"
    );
    out = out.replace(re, (m, start, header, _space, bodyStart) => {
      const withColon = header.endsWith(":") ? header : `${header}:`;
      return `${start}${withColon}\n\n${bodyStart}`;
    });
  }
  return out;
}

/**
 * Match Scene Design sidebar cleanup: strip redundant header lines and inline POV splits.
 * The export H2 already shows scene number, title, and [TENTPOLE]; POV is rendered separately.
 */
function splitInlineSceneHeaderLines(text) {
  return String(text || "").replace(
    /(Scene Title\s*:\s*)(.+?)\s+(POV\s*:)/gi,
    (_, label, title, pov) => `${label}${title.trim()}\n${pov}`
  );
}

export function extractPovForExport(text) {
  return extractScenePov(splitInlineSceneHeaderLines(text));
}

export function normalizeSceneDesignTextForExport(text) {
  let out = splitInlineSceneHeaderLines(String(text || "")).replace(/\r\n/g, "\n").trim();
  if (!out) return out;

  out = out.replace(/^\s*Scene Title\s*:[^\n]*\n?/gim, "");
  out = out.replace(/^\s*POV\s*:[^\n]*\n?/gim, "");
  out = out.replace(/^\s*\[TENTPOLE\]\s*\n?/gim, "");
  out = out.replace(/^\s*📏\s*Target Word Count\s*:?[^\n]*\n?/gim, "");
  out = out.replace(/^\s*Target Word Count\s*:?[^\n]*\n?/gim, "");

  return forceInlineSectionBreaks(out).trim();
}

function flushBodyLines(bodyLines, paragraphs) {
  if (!bodyLines.length) return;
  paragraphs.push(bodyParagraph(bodyLines.join(" ")));
  bodyLines.length = 0;
}

function isBulletLine(line) {
  return /^\s*[-•*]\s+/.test(line);
}

function stripBulletPrefix(line) {
  return line.replace(/^\s*[-•*]\s+/, "").trim();
}

function isTableLine(line) {
  return line.trim().startsWith("|");
}

function isTableSeparator(line) {
  return /^\|\s*[-:]+/.test(line.trim());
}

/**
 * Parse markdown-ish outline text into docx Paragraph[].
 * @param {string} text
 * @param {{ preserveSingleLineBreaks?: boolean }} [options]
 *   When true, each non-empty line becomes its own paragraph (Story Bible tab layout).
 */
export function outlineMarkdownToDocxParagraphs(text, options = {}) {
  const { preserveSingleLineBreaks = false } = options;
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

    if (isHorizontalRuleLine(trimmed)) {
      paragraphs.push(horizontalRuleParagraph());
      i++;
      continue;
    }

    if (isTableLine(trimmed)) {
      const tableLines = [];
      while (i < lines.length && isTableLine(lines[i].trim())) {
        if (!isTableSeparator(lines[i])) {
          tableLines.push(lines[i].trim());
        }
        i++;
      }
      const table = markdownTableToDocx(tableLines);
      if (table) paragraphs.push(table);
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

    if (isSectionHeaderLine(trimmed)) {
      const parsed = parseSectionLine(trimmed);
      if (parsed) {
        paragraphs.push(sectionLabelParagraph(parsed.label));
        if (parsed.body) paragraphs.push(bodyParagraph(parsed.body));
      }
      i++;

      const bodyLines = [];
      while (i < lines.length) {
        const nextRaw = lines[i];
        const nextTrim = nextRaw.trim();
        if (!nextTrim) {
          flushBodyLines(bodyLines, paragraphs);
          i++;
          const peek = i < lines.length ? lines[i].trim() : "";
          if (
            !peek ||
            isSectionHeaderLine(peek) ||
            isBulletLine(lines[i]) ||
            isTableLine(peek) ||
            /^(#{1,3})\s+/.test(peek)
          ) {
            break;
          }
          continue;
        }
        if (
          isSectionHeaderLine(nextTrim) ||
          isTableLine(nextTrim) ||
          isHorizontalRuleLine(nextTrim) ||
          /^(#{1,3})\s+/.test(nextTrim)
        ) {
          break;
        }
        if (isBulletLine(nextRaw)) {
          flushBodyLines(bodyLines, paragraphs);
          break;
        }
        bodyLines.push(nextTrim);
        i++;
      }
      if (preserveSingleLineBreaks) {
        for (const line of bodyLines) {
          paragraphs.push(bodyParagraph(line));
        }
      } else {
        flushBodyLines(bodyLines, paragraphs);
      }
      continue;
    }

    if (isBulletLine(raw)) {
      while (i < lines.length && isBulletLine(lines[i])) {
        paragraphs.push(bulletParagraph(stripBulletPrefix(lines[i])));
        i++;
      }
      continue;
    }

    if (preserveSingleLineBreaks) {
      paragraphs.push(bodyParagraph(trimmed));
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
        isSectionHeaderLine(nextTrim) ||
        EMOJI_SECTION_RE.test(nextTrim) ||
        /^(#{1,3})\s+/.test(nextTrim) ||
        isHorizontalRuleLine(nextTrim) ||
        isBulletLine(next) ||
        isTableLine(nextTrim)
      ) {
        break;
      }
      paraLines.push(nextTrim);
      i++;
    }
    paragraphs.push(
      paragraphFromRuns(parseInlineRuns(paraLines.join(" ")), {
        spacing: bodySpacing(0, 80),
      })
    );
  }

  return paragraphs;
}

function markdownTableToDocx(tableLines) {
  if (!tableLines.length) return null;
  const rows = tableLines.map((line) =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
  );
  if (!rows.length) return null;

  const tableRows = rows.map(
    (cells, rowIdx) =>
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: parseInlineRuns(cell, {
                    bold: rowIdx === 0,
                    size: 20,
                  }),
                  spacing: bodySpacing(40, 40),
                }),
              ],
              width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
            })
        ),
      })
  );

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
  });
}

/**
 * Scene design block: H2 heading + raw responseText body (preserves all sections).
 */
export function outlineSceneBlockToDocxParagraphs(
  sceneText,
  { globalNum, title }
) {
  if (!sceneText?.trim()) return [];

  const tentpole = /\[TENTPOLE\]/i.test(sceneText) ? " [TENTPOLE]" : "";
  const pov = extractPovForExport(sceneText);
  const paragraphs = [
    new Paragraph({
      children: [
        makeTextRun(`Scene ${globalNum}: ${title}${tentpole}`, {
          bold: true,
          size: 28,
        }),
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: bodySpacing(240, 120),
    }),
  ];

  if (pov) {
    paragraphs.push(
      new Paragraph({
        children: [
          makeTextRun("POV: ", { bold: true }),
          makeTextRun(pov),
        ],
        spacing: bodySpacing(0, 120),
      })
    );
  }

  paragraphs.push(
    ...outlineMarkdownToDocxParagraphs(normalizeSceneDesignTextForExport(sceneText))
  );
  return paragraphs;
}

export function outlineSectionTitleParagraph(title, level = 1) {
  return headingParagraph(title, level);
}

export function outlineCenteredTitleParagraph(text, opts = {}) {
  return new Paragraph({
    children: [
      makeTextRun(text, {
        bold: opts.bold ?? false,
        italics: opts.italics ?? false,
        size: opts.size ?? BODY_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: bodySpacing(0, 0),
  });
}

/** Empty paragraph for vertical spacing — never wrap parseInlineRuns in an extra array. */
export function outlineSpacerParagraph(after = 240) {
  return new Paragraph({
    children: [makeTextRun("")],
    spacing: { after },
  });
}
