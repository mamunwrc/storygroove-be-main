/**
 * Normalizes mammoth-generated Word HTML into Quill-safe markup.
 *
 * Mammoth's HTML output can carry attributes and tags Quill's clipboard
 * parser does not know about (arbitrary `style`, `class`, `<div>` wrappers,
 * `<h4>`-`<h6>`, etc.). Quill silently drops anything outside its registered
 * formats when a HTML string is loaded (`clipboard.convert()` under the
 * hood), so import must emit exactly the markup Quill — and later
 * `htmlToDocx.js` on export — already understands: `ql-align-*` classes,
 * `<strong>/<em>/<u>/<s>/<a>`, `<h1>-<h3>`, and plain `<ul>/<ol>/<li>`.
 *
 * Phase A scope only: alignment, bold/italic/underline/strike, headings
 * (clamped to h1-h3), lists, links. See docx-rich-import plan.
 */
import { load } from "cheerio";
import { encode, decode } from "html-entities";

/** Private-use marker injected into empty Word paragraphs before mammoth HTML conversion. */
export const EMPTY_PARAGRAPH_SENTINEL = "\uE000";

export const isEmptyParagraphSentinelText = (value = "") =>
  String(value).replaceAll(EMPTY_PARAGRAPH_SENTINEL, "").trim() === "";

const ALIGN_CLASS_RE = /\bql-align-(left|center|right|justify)\b/i;
const TEXT_ALIGN_STYLE_RE = /text-align:\s*(left|center|right|justify)/i;

const normalizeWhitespace = (value = "") =>
  String(value).replace(/\s+/g, " ").trim();

/** Re-decode then re-encode so stored/legacy entity artifacts never double-escape. */
const cleanText = (raw = "") => encode(decode(String(raw || "")));

/**
 * Alignment class for a block element, reading either an existing
 * `ql-align-*` class (already emitted by the mammoth styleMap transform) or
 * a raw `text-align` inline style as a defensive fallback. "left" is the
 * Quill default and needs no class.
 */
const resolveAlignClass = ($, el) => {
  const existingClass = $(el).attr("class") || "";
  const classMatch = existingClass.match(ALIGN_CLASS_RE);
  if (classMatch) {
    const value = classMatch[1].toLowerCase();
    return value === "left" ? null : `ql-align-${value}`;
  }

  const style = $(el).attr("style") || "";
  const styleMatch = style.match(TEXT_ALIGN_STYLE_RE);
  if (styleMatch) {
    const value = styleMatch[1].toLowerCase();
    return value === "left" ? null : `ql-align-${value}`;
  }

  return null;
};

/** Clamp h4-h6 to h3 — Quill's header format only supports levels 1-3. */
const clampHeadingTag = (tag) => {
  const level = parseInt(tag[1], 10);
  return `h${Math.min(level, 3)}`;
};

/**
 * Recursively walk inline nodes, keeping only tags Quill's inline formats
 * support (bold, italic, underline, strike, link, line break, nested list).
 * Unknown inline wrappers (span, font, etc.) are unwrapped to their content.
 */
const buildInlineHtml = ($, node) => {
  let out = "";

  $(node)
    .contents()
    .each((_, child) => {
      if (child.type === "text") {
        out += cleanText(child.data);
        return;
      }
      if (child.type !== "tag") return;

      const tag = child.tagName.toLowerCase();

      if (tag === "br") {
        out += "<br>";
        return;
      }

      if (tag === "strong" || tag === "b") {
        out += `<strong>${buildInlineHtml($, child)}</strong>`;
        return;
      }

      if (tag === "em" || tag === "i") {
        out += `<em>${buildInlineHtml($, child)}</em>`;
        return;
      }

      if (tag === "u") {
        out += `<u>${buildInlineHtml($, child)}</u>`;
        return;
      }

      if (tag === "s" || tag === "strike" || tag === "del") {
        out += `<s>${buildInlineHtml($, child)}</s>`;
        return;
      }

      if (tag === "a") {
        const href = ($(child).attr("href") || "").trim();
        const inner = buildInlineHtml($, child);
        if (href && /^https?:\/\//i.test(href) && inner) {
          out += `<a href="${encode(href)}">${inner}</a>`;
        } else {
          out += inner;
        }
        return;
      }

      if (tag === "ul" || tag === "ol") {
        const nested = buildListBlock($, child, tag);
        if (nested) out += nested.html;
        return;
      }

      // Unknown inline wrapper (span, font, sup, sub, etc. in Phase A) — unwrap.
      out += buildInlineHtml($, child);
    });

  return out;
};

/** Build one `<p>`/`<h1-3>` block, preserving alignment and inline formatting. */
const buildParagraphLikeBlock = ($, el, outputTag) => {
  const alignClass = resolveAlignClass($, el);
  const innerHtml = buildInlineHtml($, el);
  const text = decode(normalizeWhitespace($(el).text()));

  if (isEmptyParagraphSentinelText(text) && isEmptyParagraphSentinelText(innerHtml)) {
    const classAttr = alignClass ? ` class="${alignClass}"` : "";
    return {
      text: "",
      html: `<${outputTag}${classAttr}><br></${outputTag}>`,
    };
  }

  if (!text && !innerHtml.trim()) {
    const classAttr = alignClass ? ` class="${alignClass}"` : "";
    return {
      text: "",
      html: `<${outputTag}${classAttr}><br></${outputTag}>`,
    };
  }

  const classAttr = alignClass ? ` class="${alignClass}"` : "";
  return {
    text,
    html: `<${outputTag}${classAttr}>${innerHtml || "<br>"}</${outputTag}>`,
  };
};

/** Build one `<ul>`/`<ol>` block from its `<li>` children. */
const buildListBlock = ($, el, listTag) => {
  const items = [];

  $(el)
    .children("li")
    .each((_, li) => {
      const innerHtml = buildInlineHtml($, li);
      const text = decode(normalizeWhitespace($(li).text()));
      if (!text && !innerHtml.trim()) return;
      items.push({ text, html: `<li>${innerHtml || "<br>"}</li>` });
    });

  if (!items.length) return null;

  return {
    text: items.map((item) => item.text).join("\n"),
    html: `<${listTag}>${items.map((item) => item.html).join("")}</${listTag}>`,
  };
};

/** Flatten any unrecognized block element (table, hr, etc.) to a plain paragraph. */
const buildFallbackBlock = ($, el) => {
  const text = decode(normalizeWhitespace($(el).text()));
  if (!text) return null;
  return { text, html: `<p>${cleanText(text)}</p>` };
};

const buildBlockFromElement = ($, el) => {
  const tag = el.tagName ? el.tagName.toLowerCase() : "";

  if (tag === "ul" || tag === "ol") {
    return buildListBlock($, el, tag);
  }

  if (/^h[1-6]$/.test(tag)) {
    return buildParagraphLikeBlock($, el, clampHeadingTag(tag));
  }

  if (tag === "p" || tag === "blockquote") {
    return buildParagraphLikeBlock($, el, "p");
  }

  return buildFallbackBlock($, el);
};

/**
 * Convert mammoth's Word HTML into an ordered list of Quill-safe blocks.
 * `<div>`/`<section>`/`<body>` wrappers are unwrapped so their block children
 * are treated as top-level blocks (mammoth normally emits a flat sequence of
 * `<p>`/`<h*>`/`<ul>`/`<ol>` already, but defends against nested wrappers).
 *
 * @param {string} html
 * @returns {Array<{ text: string, html: string }>}
 */
export const normalizeWordHtmlToQuillBlocks = (html = "") => {
  const $ = load(`<div id="sg-root">${html || ""}</div>`);
  const root = $("#sg-root");
  const blocks = [];

  const walk = (el) => {
    if (!el || el.type !== "tag") return;
    const tag = el.tagName.toLowerCase();

    if (tag === "div" || tag === "section" || tag === "body") {
      $(el)
        .children()
        .each((_, child) => walk(child));
      return;
    }

    const block = buildBlockFromElement($, el);
    if (block) blocks.push(block);
  };

  root.children().each((_, el) => walk(el));

  return blocks;
};
