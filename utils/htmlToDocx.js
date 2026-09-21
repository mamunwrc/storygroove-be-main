/**
 * Converts Quill / book-editor HTML into docx Paragraph nodes with formatting preserved.
 */
import { load } from "cheerio";
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
  LevelFormat,
  UnderlineType,
  LineRuleType,
  convertInchesToTwip,
} from "docx";

export const ORDERED_LIST_REF = "storygroove-ordered";

const DEFAULT_FONT = "Times New Roman";
const BODY_SIZE = 24; // 12pt in half-points

/**
 * Turn Markdown-style **segment** into <strong> so DOCX gets bold text without literal asterisks.
 * Does not support nested * inside the segment.
 */
function preprocessMarkdownBoldMarkers(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** Numbering config for Document `numbering` (bullets use built-in default-bullet-numbering). */
export function getManuscriptNumberingConfig() {
  const levels = [];
  for (let i = 0; i < 9; i++) {
    levels.push({
      level: i,
      format: LevelFormat.DECIMAL,
      text: `%${i + 1}.`,
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: {
            left: convertInchesToTwip(0.35 + i * 0.35),
            hanging: convertInchesToTwip(0.25),
          },
        },
      },
    });
  }
  return {
    config: [
      {
        reference: ORDERED_LIST_REF,
        levels,
      },
    ],
  };
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Convert CSS font-size (px or pt) to docx half-points. Default: BODY_SIZE (12pt). */
function cssFontSizeToHalfPoints(attr) {
  const pxMatch = attr.match(/font-size:\s*([\d.]+)\s*px/);
  if (pxMatch) {
    const px = parseFloat(pxMatch[1]);
    if (Number.isFinite(px) && px > 0) {
      return Math.round(px * 0.75 * 2);
    }
  }
  const ptMatch = attr.match(/font-size:\s*([\d.]+)\s*pt/);
  if (ptMatch) {
    const pt = parseFloat(ptMatch[1]);
    if (Number.isFinite(pt) && pt > 0) {
      return Math.round(pt * 2);
    }
  }
  return null;
}

function makeTextRun(text, style = {}) {
  const opts = {
    text,
    font: DEFAULT_FONT,
    size: style.size != null ? style.size : BODY_SIZE,
  };
  if (style.bold) opts.bold = true;
  if (style.italics) opts.italics = true;
  if (style.underline) opts.underline = style.underline;
  if (style.strike) opts.strike = true;
  if (style.subScript) opts.subScript = true;
  if (style.superScript) opts.superScript = true;
  return new TextRun(opts);
}

function parseSpanStyle($, el, base) {
  const style = { ...base };
  const attr = ($(el).attr("style") || "").toLowerCase();
  if (/font-weight:\s*(bold|[6-9]00)/.test(attr)) style.bold = true;
  if (/font-style:\s*italic/.test(attr)) style.italics = true;
  if (/text-decoration:\s*[^;]*underline/.test(attr)) {
    style.underline = { type: UnderlineType.SINGLE };
  }
  if (/text-decoration:\s*[^;]*line-through/.test(attr)) style.strike = true;
  const fontSize = cssFontSizeToHalfPoints(attr);
  if (fontSize != null) style.size = fontSize;
  return style;
}

/**
 * Recursively walk inline nodes; returns TextRun and ExternalHyperlink children.
 * @param {object} [runExtras] — merged into leaf TextRuns (e.g. `{ size: 32, bold: true }` for headings)
 */
function buildRunsFromElement($, el, style = {}, runExtras = {}) {
  const runs = [];

  const visit = (node, st) => {
    $(node).contents().each((_, ch) => {
      if (ch.type === "text") {
        const t = decodeHtmlEntities(String(ch.data || ""));
        if (t) {
          const merged = { ...st, ...runExtras };
          if (runExtras.bold) merged.bold = true;
          if (runExtras.italics) merged.italics = true;
          if (runExtras.size != null) merged.size = runExtras.size;
          runs.push(makeTextRun(t, merged));
        }
        return;
      }
      if (ch.type !== "tag") return;

      const tnm = ch.tagName.toLowerCase();
      if (tnm === "br") {
        runs.push(
          new TextRun({
            text: "",
            break: 1,
            font: DEFAULT_FONT,
            size: runExtras.size != null ? runExtras.size : BODY_SIZE,
          })
        );
        return;
      }
      if (tnm === "strong" || tnm === "b") {
        visit(ch, { ...st, bold: true });
        return;
      }
      if (tnm === "em" || tnm === "i") {
        visit(ch, { ...st, italics: true });
        return;
      }
      if (tnm === "u") {
        visit(ch, { ...st, underline: { type: UnderlineType.SINGLE } });
        return;
      }
      if (tnm === "s" || tnm === "strike" || tnm === "del") {
        visit(ch, { ...st, strike: true });
        return;
      }
      if (tnm === "span") {
        visit(ch, parseSpanStyle($, ch, st));
        return;
      }
      if (tnm === "sub") {
        visit(ch, { ...st, subScript: true });
        return;
      }
      if (tnm === "sup") {
        visit(ch, { ...st, superScript: true });
        return;
      }
      if (tnm === "a") {
        const href = ($(ch).attr("href") || "").trim();
        const linkText = decodeHtmlEntities($(ch).text() || "");
        const linkSize = runExtras.size != null ? runExtras.size : BODY_SIZE;
        const linkBold = Boolean(st.bold || runExtras.bold);
        const linkItalics = Boolean(st.italics || runExtras.italics);
        if (href && /^https?:\/\//i.test(href) && linkText) {
          runs.push(
            new ExternalHyperlink({
              children: [
                new TextRun({
                  text: linkText,
                  style: "Hyperlink",
                  font: DEFAULT_FONT,
                  size: linkSize,
                  bold: linkBold,
                  italics: linkItalics,
                  underline: { type: UnderlineType.SINGLE },
                  strike: st.strike,
                }),
              ],
              link: href,
            })
          );
        } else if (linkText) {
          const merged = { ...st, ...runExtras };
          if (runExtras.bold) merged.bold = true;
          if (runExtras.italics) merged.italics = true;
          if (runExtras.size != null) merged.size = runExtras.size;
          runs.push(makeTextRun(linkText, merged));
        }
        return;
      }
      visit(ch, st);
    });
  };

  visit(el, style);
  return runs;
}

const BODY_FONT_PT = 12;
const DEFAULT_BODY_LINE = 480; // double-spaced (240 = single, 480 = double)

/** Default manuscript paragraph spacing when HTML has no inline spacing. */
export function defaultBodySpacing() {
  return {
    after: 0,
    line: DEFAULT_BODY_LINE,
    lineRule: LineRuleType.AUTO,
  };
}

/**
 * Parse Quill block `line-height` (unitless ratio) for docx spacing.line.
 * @param {string} styleAttr
 * @returns {{ line: number, lineRule: string } | null}
 */
export function parseLineHeightFromStyle(styleAttr) {
  const attr = (styleAttr || "").toLowerCase();
  const unitless = attr.match(/line-height:\s*([\d.]+)\s*(?:;|$)/);
  if (unitless) {
    const ratio = parseFloat(unitless[1]);
    if (Number.isFinite(ratio) && ratio > 0) {
      return {
        line: Math.round(240 * ratio),
        lineRule: LineRuleType.AUTO,
      };
    }
  }
  return null;
}

/**
 * Parse Quill block `margin-bottom` (paragraph spacing after) for docx spacing.after (twips).
 * @param {string} styleAttr
 * @returns {number | null}
 */
export function parseMarginBottomFromStyle(styleAttr) {
  const attr = (styleAttr || "").toLowerCase();
  if (/margin-bottom:\s*0(?:px|em|pt)?\s*(?:;|$)/.test(attr)) {
    return 0;
  }
  const em = attr.match(/margin-bottom:\s*([\d.]+)\s*em/);
  if (em) {
    const emVal = parseFloat(em[1]);
    if (Number.isFinite(emVal)) {
      return Math.round(emVal * BODY_FONT_PT * 20);
    }
  }
  const pt = attr.match(/margin-bottom:\s*([\d.]+)\s*pt/);
  if (pt) {
    const ptVal = parseFloat(pt[1]);
    if (Number.isFinite(ptVal)) return Math.round(ptVal * 20);
  }
  const px = attr.match(/margin-bottom:\s*([\d.]+)\s*px/);
  if (px) {
    const pxVal = parseFloat(px[1]);
    if (Number.isFinite(pxVal)) return Math.round(pxVal * 0.75 * 20);
  }
  return null;
}

/**
 * Merge inline block styles with manuscript defaults for docx Paragraph spacing.
 * @param {string} [styleAttr]
 */
export function spacingFromBlockStyle(styleAttr) {
  const base = defaultBodySpacing();
  const lh = parseLineHeightFromStyle(styleAttr);
  const mb = parseMarginBottomFromStyle(styleAttr);
  return {
    after: mb != null ? mb : base.after,
    line: lh ? lh.line : base.line,
    lineRule: lh ? lh.lineRule : base.lineRule,
  };
}

function alignmentFromQuillClass($, el) {
  const cls = $(el).attr("class") || "";
  if (cls.includes("ql-align-center")) return AlignmentType.CENTER;
  if (cls.includes("ql-align-right")) return AlignmentType.RIGHT;
  if (cls.includes("ql-align-justify")) return AlignmentType.JUSTIFIED;

  // Fallback: raw `text-align` inline style (e.g. HTML that escaped Quill-class
  // normalization on import). Quill's own export always uses classes.
  const style = ($(el).attr("style") || "").toLowerCase();
  const styleMatch = style.match(/text-align:\s*(left|center|right|justify)/);
  if (styleMatch) {
    const value = styleMatch[1];
    if (value === "center") return AlignmentType.CENTER;
    if (value === "right") return AlignmentType.RIGHT;
    if (value === "justify") return AlignmentType.JUSTIFIED;
  }

  return undefined;
}

function paragraphFromParagraphTag($, el) {
  const runs = buildRunsFromElement($, el);
  const align = alignmentFromQuillClass($, el);
  const spacing = spacingFromBlockStyle($(el).attr("style") || "");
  if (runs.length === 0) {
    return new Paragraph({
      children: [new TextRun({ text: "", font: DEFAULT_FONT, size: BODY_SIZE })],
      alignment: align,
      spacing,
    });
  }
  // Use first-line indent (0.5") for standard prose paragraphs.
  // Do not indent centred, right-aligned, or justified-override paragraphs.
  const useIndent = !align || align === AlignmentType.JUSTIFIED;
  return new Paragraph({
    children: runs,
    alignment: align ?? AlignmentType.JUSTIFIED,
    indent: useIndent ? { firstLine: convertInchesToTwip(0.5) } : undefined,
    spacing,
  });
}

function paragraphFromHeading($, el, level) {
  const sizes = { 1: 32, 2: 28, 3: 26 };
  const size = sizes[level] || 24;
  const runs = buildRunsFromElement($, el, {}, { size, bold: true });
  const mapped =
    runs.length === 0
      ? [new TextRun({ text: " ", bold: true, font: DEFAULT_FONT, size })]
      : runs;
  const hl =
    level <= 3
      ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1]
      : HeadingLevel.HEADING_3;
  return new Paragraph({
    children: mapped,
    heading: hl,
    alignment: alignmentFromQuillClass($, el),
    spacing: {
      before: level === 1 ? 240 : level === 2 ? 200 : 160,
      after: level === 1 ? 200 : level === 2 ? 160 : 140,
    },
  });
}

let orderedListCounter = 0;

function processListItem($, li, listKind, depth, listInstance, paragraphs) {
  const nodes = $(li).contents().toArray();
  let i = 0;

  const listItemStyle = $(li).attr("style") || "";

  const appendParagraphForRuns = (runs) => {
    if (runs.length === 0) return;
    const num =
      listKind === "ol"
        ? {
            reference: ORDERED_LIST_REF,
            level: Math.min(depth, 8),
            instance: listInstance,
          }
        : {
            reference: "default-bullet-numbering",
            level: Math.min(depth, 8),
          };
    paragraphs.push(
      new Paragraph({
        children: runs,
        numbering: num,
        spacing: spacingFromBlockStyle(listItemStyle),
      })
    );
  };

  while (i < nodes.length) {
    const node = nodes[i];
    if (node.type === "tag") {
      const nm = node.tagName.toLowerCase();
      if (nm === "ol") {
        processList($, node, "ol", depth + 1, paragraphs);
        i++;
        continue;
      }
      if (nm === "ul") {
        processList($, node, "ul", depth + 1, paragraphs);
        i++;
        continue;
      }
    }

    const $frag = load("<div></div>");
    const holder = $frag("div");
    while (i < nodes.length) {
      const n = nodes[i];
      if (n.type === "tag") {
        const nm = n.tagName.toLowerCase();
        if (nm === "ol" || nm === "ul") break;
      }
      holder.append($(n).clone());
      i++;
    }
    const html = holder.html();
    if (html && html.trim()) {
      const $inner = load(`<div class="i">${html}</div>`);
      const runs = buildRunsFromElement($inner, $inner(".i")[0]);
      appendParagraphForRuns(runs);
    }
  }
}

function processList($, listEl, kind, depth, paragraphs) {
  const instance = kind === "ol" ? ++orderedListCounter : 0;
  $(listEl)
    .children("li")
    .each((_, li) => {
      processListItem($, li, kind, depth, instance, paragraphs);
    });
}

function processBlockElement($, el, paragraphs) {
  const tag = el.tagName.toLowerCase();

  if (
    tag === "style" ||
    tag === "script" ||
    tag === "meta" ||
    tag === "link" ||
    tag === "head"
  ) {
    return;
  }

  if (tag === "p") {
    paragraphs.push(paragraphFromParagraphTag($, el));
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(6, Math.max(1, parseInt(tag[1], 10)));
    paragraphs.push(paragraphFromHeading($, el, level));
    return;
  }

  if (tag === "ol") {
    processList($, el, "ol", 0, paragraphs);
    return;
  }
  if (tag === "ul") {
    processList($, el, "ul", 0, paragraphs);
    return;
  }

  if (tag === "blockquote") {
    const kids = $(el).children().toArray();
    if (kids.length > 0) {
      kids.forEach((ch) => {
        if (ch.type === "tag") processBlockElement($, ch, paragraphs);
      });
    } else {
      const runs = buildRunsFromElement($, el, {}, { italics: true });
      if (runs.length) {
        paragraphs.push(
          new Paragraph({
            children: runs,
            indent: {
              left: convertInchesToTwip(0.5),
              firstLine: convertInchesToTwip(0.5),
            },
            spacing: spacingFromBlockStyle($(el).attr("style") || ""),
          })
        );
      }
    }
    return;
  }

  if (tag === "pre") {
    const txt = decodeHtmlEntities($(el).text() || "");
    if (txt.trim()) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: txt, font: "Courier New", size: 22 })],
          spacing: spacingFromBlockStyle($(el).attr("style") || ""),
        })
      );
    }
    return;
  }

  if (tag === "div") {
    $(el)
      .children()
      .each((_, ch) => {
        if (ch.type === "tag") processBlockElement($, ch, paragraphs);
      });
    return;
  }

  const runs = buildRunsFromElement($, el);
  if (runs.length) {
    paragraphs.push(
      new Paragraph({
        children: runs,
        spacing: spacingFromBlockStyle($(el).attr("style") || ""),
      })
    );
  }
}

/**
 * @param {string} htmlString
 * @returns {import("docx").Paragraph[]}
 */
export function parseHtmlToDocxParagraphs(htmlString) {
  orderedListCounter = 0;
  const paragraphs = [];
  const raw = preprocessMarkdownBoldMarkers((htmlString || "").trim());
  if (!raw) return paragraphs;

  const $ = load(`<div id="sg-root">${raw}</div>`);
  const root = $("#sg-root");

  root.children().each((_, child) => {
    if (child.type === "tag") processBlockElement($, child, paragraphs);
  });

  if (paragraphs.length === 0) {
    const runs = buildRunsFromElement($, root[0]);
    if (runs.length) {
      paragraphs.push(
        new Paragraph({ children: runs, spacing: defaultBodySpacing() })
      );
    }
  }

  return paragraphs;
}
