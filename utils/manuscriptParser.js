/**
 * Manuscript parsing for uploaded drafts (Ellis workflow, Phase 1).
 *
 * Turns an uploaded Word/PDF/TXT manuscript into:
 *   - title-page metadata (title, author, genre, subgenre, comp titles)
 *   - an ordered list of chapters with POV / timeline, per the client's
 *     formatting spec ("Chapter One", "Chapter One, POV Lucas, Timeline 1932").
 *
 * The detector is deterministic so chapter boundaries never depend on a model
 * guessing — the same lesson the client's Azure backend enforced via a chapter
 * map, minus the Elasticsearch/token machinery.
 */
import { encode } from "html-entities";

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ONES_MAP = ONES.reduce((acc, word, i) => {
  acc[word] = i;
  return acc;
}, {});

/** Convert a 1..99 integer to a Title-Case word ("One", "Twenty One"). */
export const numberToWords = (n) => {
  if (n == null || n < 1) return null;
  if (n < 20) return capitalize(ONES[n]);
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    const tensWord = Object.keys(TENS).find((k) => TENS[k] === tens);
    const tensTitle = capitalize(tensWord || String(tens));
    return ones ? `${tensTitle} ${capitalize(ONES[ones])}` : tensTitle;
  }
  return String(n);
};

const capitalize = (s) =>
  typeof s === "string" && s.length ? s[0].toUpperCase() + s.slice(1) : s;

/**
 * Parse a leading chapter number (digits or words) from `rest`.
 * Returns { number, remainder } or null if no number is present.
 */
const parseChapterNumber = (rest) => {
  const trimmed = rest.trim();

  // Digit form: "12", "12A", "12 -" (no \b after digits so "7A" works)
  const digitMatch = trimmed.match(/^(\d{1,3})(.*)$/);
  if (digitMatch && /^\d/.test(trimmed)) {
    return {
      number: parseInt(digitMatch[1], 10),
      remainder: digitMatch[2].trim(),
    };
  }

  // Word form: consume leading number-words ("Twenty One ...") while
  // preserving the untouched remainder (so internal punctuation such as the
  // dash in "Timeline 2 - 2017" survives).
  let remaining = trimmed;
  let value = 0;
  let sawNumber = false;

  while (remaining) {
    const wm = remaining.match(/^([a-z]+)([^a-z]*)/i);
    if (!wm) break;
    const word = wm[1].toLowerCase();
    if (word in ONES_MAP) {
      value += ONES_MAP[word];
    } else if (word in TENS) {
      value += TENS[word];
    } else {
      break;
    }
    sawNumber = true;
    remaining = remaining.slice(wm[0].length);
  }

  if (!sawNumber) return null;
  return { number: value, remainder: remaining.trim() };
};

/** Normalize a chapter letter suffix to "" or uppercase A–Z. */
export const normalizeChapterSuffix = (suffix) => {
  const s = String(suffix || "").trim().toUpperCase();
  return /^[A-Z]$/.test(s) ? s : "";
};

/**
 * Pull an optional single-letter suffix from remainder after the chapter number.
 * Accepts "A", " A", "-A". Does not consume POV/Timeline.
 * Returns { suffix, remainder }.
 */
export const parseChapterLetterSuffix = (remainder) => {
  const trimmed = String(remainder || "").trim();
  if (!trimmed) return { suffix: "", remainder: "" };
  if (/^(POV|Timeline)\b/i.test(trimmed)) {
    return { suffix: "", remainder: trimmed };
  }
  const m = trimmed.match(/^[-–—\s]*([A-Za-z])(?![A-Za-z])(.*)$/);
  if (!m) return { suffix: "", remainder: trimmed };
  return {
    suffix: m[1].toUpperCase(),
    remainder: String(m[2] || "").trim(),
  };
};

/** Stable map/dedupe key for (chapterNumber, chapterSuffix). */
export const chapterIdentityKey = (chapterNumber, chapterSuffix) => {
  const num = Number(chapterNumber);
  if (!Number.isFinite(num)) return "";
  const suf = normalizeChapterSuffix(chapterSuffix);
  return suf ? `${num}:${suf}` : String(num);
};

/** Progress / review map key: "7" or "7A". */
export const chapterProgressKey = (chapterNumber, chapterSuffix) => {
  const num = Number(chapterNumber);
  if (!Number.isFinite(num)) return "";
  const suf = normalizeChapterSuffix(chapterSuffix);
  return suf ? `${num}${suf}` : String(num);
};

/** Standalone / hybrid section names supported on upload (checklist v1). */
export const STANDALONE_SECTION_NAMES = [
  "prologue",
  "epilogue",
  "interlude",
  "letter",
  "introduction",
  "afterword",
  "prelude",
  "coda",
];

const STANDALONE_SECTION_NAME_SET = new Set(STANDALONE_SECTION_NAMES);

const STANDALONE_SECTION_HEADER_RE = new RegExp(
  `^\\s*(${STANDALONE_SECTION_NAMES.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|")})\\s*[:\\-.]?\\s*$`,
  "i"
);

const formatSectionTitle = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .map((word) => capitalize(word.toLowerCase()))
    .join(" ");

const isKnownSectionName = (name) =>
  STANDALONE_SECTION_NAME_SET.has(String(name || "").trim().toLowerCase());

/**
 * Pull an optional hybrid section from a chapter remainder (" / Prologue", ", Epilogue").
 * Returns { sectionName, remainder } for POV/Timeline parsing.
 */
const parseHybridSectionFromRemainder = (remainder) => {
  const trimmed = String(remainder || "").trim();
  if (!trimmed) return { sectionName: null, remainder: trimmed };

  const m = trimmed.match(
    /^\s*[\/,]\s*([A-Za-z][A-Za-z\s]*?)(?=\s*(?:[,(]|\bPOV\b|\bTimeline\b)|$)/i
  );
  if (!m) return { sectionName: null, remainder: trimmed };

  const rawName = m[1].trim();
  if (!isKnownSectionName(rawName)) {
    return { sectionName: null, remainder: trimmed };
  }

  const sectionName = formatSectionTitle(rawName);
  const afterSection = trimmed.slice(m[0].length).replace(/^[\s,]+/, "").trim();
  return { sectionName, remainder: afterSection };
};

/**
 * Detect a standalone section heading (Prologue, Epilogue, etc.).
 * Returns { chapterLabel, sceneTitle, isStandaloneSection } or null.
 */
export const matchStandaloneSectionHeader = (line) => {
  const text = String(line || "").trim();
  if (!text) return null;
  const m = text.match(STANDALONE_SECTION_HEADER_RE);
  if (!m) return null;

  const sectionName = formatSectionTitle(m[1]);
  return {
    chapterLabel: sectionName,
    sceneTitle: sectionName,
    isStandaloneSection: true,
  };
};

const normalizeSectionLabel = (label) =>
  String(label || "")
    .trim()
    .toLowerCase();

/**
 * True when `incoming` repeats the current section heading before any body text
 * (common in Word exports: decorative title + repeated running header).
 */
export const isOrnamentDuplicateSectionHeader = (current, incoming) => {
  if (!current || !incoming) return false;
  if ((current.contentLines || []).length > 0) return false;

  const currentLabel = normalizeSectionLabel(current.chapterLabel);
  const incomingLabel = normalizeSectionLabel(incoming.chapterLabel);
  if (currentLabel && incomingLabel && currentLabel === incomingLabel) {
    return true;
  }

  if (
    !current.isStandaloneSection &&
    !incoming.isStandaloneSection &&
    Number(current.chapterNumber) === Number(incoming.chapterNumber) &&
    normalizeChapterSuffix(current.chapterSuffix) ===
      normalizeChapterSuffix(incoming.chapterSuffix)
  ) {
    return true;
  }

  return false;
};

/** Drop empty sections duplicated by an ornament heading before the real body. */
const dropOrnamentEmptyDuplicateSections = (sections = []) => {
  const filtered = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const label = normalizeSectionLabel(section.chapterLabel);
    const isEmpty = !(section.contentLines || []).length;
    const nextHasSameLabel =
      next && normalizeSectionLabel(next.chapterLabel) === label;
    const nextHasContent = (next?.contentLines || []).length > 0;

    if (isEmpty && nextHasSameLabel && nextHasContent) {
      continue;
    }
    filtered.push(section);
  }
  return filtered;
};

/** Sort comparator: chapterNumber, then suffix ("" before A before B). */
export const compareChapterRows = (a, b) => {
  const na = Number(a?.chapterNumber ?? a?.sceneIndex ?? 0);
  const nb = Number(b?.chapterNumber ?? b?.sceneIndex ?? 0);
  if (na !== nb) return na - nb;
  const sa = normalizeChapterSuffix(a?.chapterSuffix);
  const sb = normalizeChapterSuffix(b?.chapterSuffix);
  if (sa === sb) {
    return Number(a?.sceneIndex || 0) - Number(b?.sceneIndex || 0);
  }
  if (!sa) return -1;
  if (!sb) return 1;
  return sa.localeCompare(sb);
};

/**
 * If `chapterRest` ends with "/ Prologue" or ", Epilogue", peel it off before
 * chapter-number parsing (parseChapterNumber treats " / " as part of the tail).
 * Returns { chapterRest, sectionName, trailingMeta }.
 */
const extractHybridSectionFromChapterRest = (chapterRest) => {
  const raw = String(chapterRest || "").trim();
  if (!raw) {
    return { chapterRest: raw, sectionName: null, trailingMeta: "" };
  }

  const sectionPattern = STANDALONE_SECTION_NAMES.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");

  const m = raw.match(
    new RegExp(
      `^(.+?)\\s*[\\/,]\\s*(${sectionPattern})\\s*(.*)$`,
      "i"
    )
  );
  if (!m || !isKnownSectionName(m[2])) {
    return { chapterRest: raw, sectionName: null, trailingMeta: "" };
  }

  return {
    chapterRest: m[1].trim(),
    sectionName: formatSectionTitle(m[2]),
    trailingMeta: String(m[3] || "").trim(),
  };
};

/**
 * Detect a chapter header line and extract its number, optional letter suffix,
 * POV, and timeline.
 * Returns { chapterNumber, chapterSuffix, chapterLabel, pov, timeline } or null.
 */
export const matchChapterHeader = (line) => {
  if (!line) return null;
  const m = line.match(/^\s*chapter\b[\s:.\-—]*(.+)$/i);
  if (!m) return null;

  const hybridExtracted = extractHybridSectionFromChapterRest(m[1]);
  const parsed = parseChapterNumber(hybridExtracted.chapterRest);
  if (!parsed || parsed.number == null || parsed.number < 1) return null;

  const suffixParsed = parseChapterLetterSuffix(parsed.remainder);
  const chapterSuffix = suffixParsed.suffix || null;
  const afterSuffix = [suffixParsed.remainder, hybridExtracted.trailingMeta]
    .filter(Boolean)
    .join(", ")
    .replace(/^,\s*/, "")
    .trim();

  const inlineHybrid = parseHybridSectionFromRemainder(afterSuffix);
  const sectionName =
    hybridExtracted.sectionName || inlineHybrid.sectionName;
  const remainder = inlineHybrid.sectionName
    ? inlineHybrid.remainder
    : afterSuffix;

  let pov = null;
  let timeline = null;

  // POV: "POV Lucas", "POV: Lucas Vance" — stop at comma, paren, or "Timeline".
  const povMatch = remainder.match(
    /\bPOV\b[:\s]*([^,(\n]*?)(?=\s*[,(]|\s+Timeline\b|$)/i
  );
  if (povMatch && povMatch[1].trim()) {
    pov = povMatch[1].trim();
  }

  // Timeline: "Timeline 1932", "(Timeline 2 - 2017)" — strip trailing paren.
  const timelineMatch = remainder.match(/\bTimeline\b[:\s]*([^,)\n]+)/i);
  if (timelineMatch && timelineMatch[1].trim()) {
    timeline = timelineMatch[1].replace(/\)+\s*$/, "").trim();
  }

  const words = numberToWords(parsed.number);
  const baseLabel = chapterSuffix
    ? `Chapter ${words} ${chapterSuffix}`
    : `Chapter ${words}`;
  const chapterLabel = sectionName ? `${baseLabel} / ${sectionName}` : baseLabel;

  return {
    chapterNumber: parsed.number,
    chapterSuffix,
    chapterLabel,
    sceneTitle: sectionName || null,
    pov,
    timeline,
    isStandaloneSection: false,
  };
};

const stripMarkdownEmphasis = (line) =>
  String(line || "")
    .trim()
    .replace(/^[*_]+|[*_]+$/g, "")
    .trim();

const isWordCountLine = (line) => {
  const t = String(line || "").trim();
  if (!t) return false;
  return (
    /\b(?:approx(?:imately)?|words?)\b/i.test(t) ||
    /^\d[\d,.\s]*(?:\s*words?)?$/i.test(t)
  );
};

const looksLikeGenreLine = (line, { author = "" } = {}) => {
  const t = stripMarkdownEmphasis(line);
  if (!t || isWordCountLine(t) || /^by$/i.test(t)) return false;
  if (author && t.localeCompare(author, undefined, { sensitivity: "accent" }) === 0) {
    return false;
  }
  if (/[.!?]["'”’]?\s*$/.test(t)) return false;
  return (
    /\b(?:fiction|romance|thriller|memoir|fantasy|drama|nonfiction|mystery|horror|literary|women'?s|historical|contemporary|young adult|ya)\b/i.test(
      t
    ) || /\//.test(t)
  );
};

/** Parse title-page metadata from the lines before the first chapter header. */
export const parseTitlePage = (lines = []) => {
  const tp = { title: "", author: "", genre: "", subgenre: "", compTitles: [] };
  let compsMode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = stripMarkdownEmphasis(lines[i]);
    if (!line) continue;

    const labeled = line.match(
      /^(title|by|author|genre|subgenre|sub-genre|comps?|comp titles?)\s*[:\-]\s*(.*)$/i
    );
    if (labeled) {
      const key = labeled[1].toLowerCase();
      const val = labeled[2].trim();
      if (key === "title") {
        tp.title = val;
      } else if (key === "by" || key === "author") {
        tp.author = val.replace(/^by[:\s]+/i, "").trim();
      } else if (key === "genre") {
        tp.genre = val;
      } else if (key.startsWith("sub")) {
        tp.subgenre = val;
      } else if (key.startsWith("comp")) {
        compsMode = true;
        if (val && tp.compTitles.length < 2) tp.compTitles.push(val);
      }
      continue;
    }

    if (compsMode) {
      const comp = line.replace(/^[•\-*\u2022\d.)\s]+/, "").trim();
      if (comp && tp.compTitles.length < 2) tp.compTitles.push(comp);
      continue;
    }

    const inlineBy = line.match(/^by\s+(.+)$/i);
    if (inlineBy?.[1]?.trim() && !isWordCountLine(inlineBy[1])) {
      if (!tp.author) tp.author = inlineBy[1].trim();
      continue;
    }

    if (/^by$/i.test(line) && !tp.author) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = stripMarkdownEmphasis(lines[j]);
        if (!next || isWordCountLine(next) || /^by$/i.test(next)) continue;
        tp.author = next;
        break;
      }
      continue;
    }

    if (isWordCountLine(line)) continue;

    if (!tp.title) {
      tp.title = line;
      continue;
    }

    if (tp.author && !tp.genre && looksLikeGenreLine(line, { author: tp.author })) {
      tp.genre = line;
    }
  }

  tp.compTitles = tp.compTitles.slice(0, 2);
  return tp;
};

/**
 * Merge lettered sub-headers (Chapter 7, 7 A, 7 B) into one row per base
 * chapterNumber for Ellis review and the manuscript map.
 * Front matter (<= 0) and back matter (> max narrative) stay as separate rows.
 */
export const consolidateChaptersByBaseNumber = (chapters = []) => {
  if (!chapters?.length) return [];

  const maxNarrative = Math.max(
    0,
    ...chapters
      .filter((c) => !c._isBackMatter && Number(c.chapterNumber) >= 1)
      .map((c) => Number(c.chapterNumber))
  );

  const emitSingleSection = (ch) => ({
    chapterNumber: ch.chapterNumber,
    chapterSuffix: ch.chapterSuffix || null,
    chapterLabel: ch.chapterLabel,
    sceneTitle: ch.sceneTitle || null,
    pov: ch.pov || null,
    timeline: ch.timeline || null,
    contentLines: [...(ch.contentLines || [])],
    contentBlocks: [...(ch.contentBlocks || [])],
    sectionCount: 1,
  });

  const result = [];

  const frontMatter = chapters
    .filter((c) => Number.isInteger(c.chapterNumber) && c.chapterNumber <= 0)
    .sort(compareChapterRows);
  for (const ch of frontMatter) {
    result.push(emitSingleSection(ch));
  }

  const narrativeGroups = new Map();
  for (const ch of chapters) {
    const num = Number(ch.chapterNumber);
    if (!Number.isInteger(num) || num < 1 || num > maxNarrative || ch._isBackMatter) {
      continue;
    }
    if (!narrativeGroups.has(num)) narrativeGroups.set(num, []);
    narrativeGroups.get(num).push(ch);
  }

  for (const num of [...narrativeGroups.keys()].sort((a, b) => a - b)) {
    const group = [...narrativeGroups.get(num)].sort(compareChapterRows);
    const bare = group.find((c) => !normalizeChapterSuffix(c.chapterSuffix));
    const primary = bare || group[0];
    const words = numberToWords(num) || String(num);
    const chapterLabel = bare?.chapterLabel || `Chapter ${words}`;

    const contentLines = [];
    const contentBlocks = [];
    for (const section of group) {
      // Do not re-inject section labels ("Chapter Seven A") into the body —
      // those live in chapterLabel / scene metadata. A blank line separates
      // lettered sections so paragraph spacing survives consolidation.
      if (contentLines.length > 0 && (section.contentLines || []).length) {
        contentLines.push("");
      }
      if (contentBlocks.length > 0 && (section.contentBlocks || []).length) {
        contentBlocks.push(emptyContentBlock());
      }
      contentLines.push(...(section.contentLines || []));
      contentBlocks.push(...(section.contentBlocks || []));
    }

    result.push({
      chapterNumber: num,
      chapterSuffix: null,
      chapterLabel,
      sceneTitle: primary.sceneTitle || null,
      pov: primary.pov || null,
      timeline: primary.timeline || null,
      contentLines,
      contentBlocks,
      sectionCount: group.length,
    });
  }

  const backMatter = chapters
    .filter((c) => c._isBackMatter && Number.isInteger(Number(c.chapterNumber)))
    .sort(compareChapterRows);
  for (const ch of backMatter) {
    result.push(emitSingleSection(ch));
  }

  return result.sort(compareChapterRows);
};

/** Flag missing/duplicate chapter identities so a bad upload can be surfaced. */
export const validateChapterSequence = (chapters = []) => {
  const warnings = [];
  const entries = chapters.filter((c) => Number.isInteger(c.chapterNumber));
  if (!entries.length) return warnings;

  const seen = new Set();
  const narrativeNumbers = new Set();
  for (const c of entries) {
    const key = chapterIdentityKey(c.chapterNumber, c.chapterSuffix);
    if (seen.has(key)) {
      warnings.push(
        `Duplicate chapter detected: ${c.chapterLabel || key}`
      );
    }
    seen.add(key);
    if (!c._isBackMatter && c.chapterNumber >= 1) {
      narrativeNumbers.add(c.chapterNumber);
    }
  }

  if (!narrativeNumbers.size) return warnings;

  const maxNarrative = Math.max(...narrativeNumbers);
  for (let i = 1; i <= maxNarrative; i++) {
    if (!narrativeNumbers.has(i)) {
      warnings.push(`Missing chapter number in sequence: ${i}`);
    }
  }

  return warnings;
};

/** Assign chapterNumber to standalone front/back sections collected during parse. */
const assignStandaloneSectionNumbers = (rawSections = []) => {
  let frontIndex = 0;
  let sawNumberedChapter = false;
  const numbered = [];
  const deferredBackMatter = [];

  const nextFrontNumber = () => {
    const num = frontIndex === 0 ? 0 : -frontIndex;
    frontIndex += 1;
    return num;
  };

  for (const section of rawSections) {
    if (!section.isStandaloneSection) {
      sawNumberedChapter = true;
      numbered.push(section);
      continue;
    }

    if (!sawNumberedChapter) {
      numbered.push({
        ...section,
        chapterNumber: nextFrontNumber(),
        chapterSuffix: null,
        _isBackMatter: false,
      });
    } else {
      deferredBackMatter.push(section);
    }
  }

  const maxNarrative = Math.max(
    0,
    ...numbered
      .filter((s) => !s.isStandaloneSection && Number(s.chapterNumber) >= 1)
      .map((s) => Number(s.chapterNumber))
  );

  let backOffset = 1;
  for (const section of deferredBackMatter) {
    numbered.push({
      ...section,
      chapterNumber: maxNarrative + backOffset,
      chapterSuffix: null,
      _isBackMatter: true,
    });
    backOffset += 1;
  }

  return numbered;
};

/** Quill's empty-paragraph representation — preserved on import and in the editor. */
export const EMPTY_QUILL_PARAGRAPH_HTML = "<p><br></p>";

/** Plain-text line wrapped as a block with no rich HTML (TXT/MD/PDF path). */
export const emptyContentBlock = () => ({ text: "", html: null });

/** Wrap parsed content lines into stored HTML paragraphs.
 * Blank source lines become empty Quill paragraphs so intentional breaks survive import.
 */
export const buildChapterContentHtml = (contentLines = []) =>
  contentLines
    .map((l) =>
      String(l ?? "").trim()
        ? `<p>${encode(String(l))}</p>`
        : EMPTY_QUILL_PARAGRAPH_HTML
    )
    .join("");

/**
 * Remove body lines that duplicate chapter headers already stored on the row.
 * POV:/Timeline: lines are KEPT in the manuscript body (and still parsed into
 * row metadata at header match time) so writers see their timeline headers.
 */
export const stripRedundantChapterMetaLines = (
  contentLines = [],
  { chapterLabel = null } = {}
) => {
  const labelNorm = String(chapterLabel || "")
    .trim()
    .toLowerCase();

  return contentLines.filter((line) => {
    const text = String(line || "").trim();
    if (!text) return true; // keep blank paragraph separators

    if (matchChapterHeader(text) || matchStandaloneSectionHeader(text)) {
      return false;
    }
    if (labelNorm && text.toLowerCase() === labelNorm) return false;

    return true;
  });
};

/** Block-aware wrapper — same rules as stripRedundantChapterMetaLines. */
export const stripRedundantChapterMetaBlocks = (blocks = [], opts = {}) => {
  const labelNorm = String(opts.chapterLabel || "")
    .trim()
    .toLowerCase();

  return blocks.filter((block) => {
    const text = String(block?.text || "").trim();
    if (!text) return true;
    if (matchChapterHeader(text) || matchStandaloneSectionHeader(text)) {
      return false;
    }
    if (labelNorm && text.toLowerCase() === labelNorm) return false;
    return true;
  });
};

/**
 * Wrap parsed content blocks into stored HTML, preserving each block's rich
 * Quill-safe HTML (DOCX) or falling back to a plain `<p>` (TXT/MD/PDF/labels).
 */
export const buildChapterContentHtmlFromBlocks = (blocks = []) =>
  blocks
    .map((block) => {
      if (block?.html) return block.html;
      const text = block?.text ?? "";
      return String(text).trim()
        ? `<p>${encode(String(text))}</p>`
        : EMPTY_QUILL_PARAGRAPH_HTML;
    })
    .join("");

let pdfNodePolyfillsReady = false;

/** pdf-parse default page joiner when callers omit `pageJoiner` (e.g. "-- 2 of 272 --"). */
const PDF_PAGE_JOINER_RE = /^--\s*\d+\s+of\s+\d+\s*--$/i;

/** Running header/footer stamps from Word PDF export (e.g. "/ 12_23_24 / 2"). */
const PDF_DATE_PAGE_HEADER_RE = /^\/\s*[\d_/-]+\s*\/\s*\d+\s*$/;

/** Standalone page-number lines (e.g. "2", "Page 2 of 272"). */
const PDF_PAGE_NUMBER_RE = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i;

const PDF_POV_LINE_RE = /^POV\s*:/i;

/**
 * True when a line is PDF extraction noise (page markers, headers/footers).
 */
export const isPdfArtifactLine = (line) => {
  const text = String(line || "").trim();
  if (!text) return true;
  if (PDF_PAGE_JOINER_RE.test(text)) return true;
  if (PDF_DATE_PAGE_HEADER_RE.test(text)) return true;
  if (PDF_PAGE_NUMBER_RE.test(text)) return true;
  return false;
};

/** Drop PDF page markers and header/footer lines from extracted text.
 * Blank lines are kept so paragraph breaks survive normalization.
 */
export const filterPdfArtifactLines = (lines = []) =>
  lines.filter((line) => {
    if (!String(line ?? "").trim()) return true;
    return !isPdfArtifactLine(line);
  });

/**
 * Whether two consecutive PDF lines should be merged into one paragraph.
 * Uses conservative rules: hyphenation and lowercase continuations only.
 */
export const shouldMergePdfLines = (current, next) => {
  const prev = String(current || "").trim();
  const following = String(next || "").trim();
  if (!prev || !following) return false;
  if (isPdfArtifactLine(prev) || isPdfArtifactLine(following)) return false;
  if (
    matchChapterHeader(prev) ||
    matchChapterHeader(following) ||
    matchStandaloneSectionHeader(prev) ||
    matchStandaloneSectionHeader(following)
  ) {
    return false;
  }
  if (PDF_POV_LINE_RE.test(prev) || PDF_POV_LINE_RE.test(following)) return false;
  if (prev.endsWith("-")) return true;
  if (/^[a-z(]/.test(following)) return true;
  return false;
};

/** Merge soft-wrapped PDF lines and drop extraction artifacts.
 * Blank lines are preserved as paragraph separators (empty strings).
 */
export const normalizePdfExtractedLines = (lines = []) => {
  const filtered = filterPdfArtifactLines(lines);
  const merged = [];

  for (const line of filtered) {
    const raw = String(line ?? "");
    const trimmed = raw.trim();
    if (!trimmed) {
      // Hard paragraph break — do not merge across it.
      if (merged.length && merged[merged.length - 1] !== "") {
        merged.push("");
      }
      continue;
    }

    if (
      merged.length &&
      merged[merged.length - 1] !== "" &&
      shouldMergePdfLines(merged[merged.length - 1], trimmed)
    ) {
      const prev = merged[merged.length - 1];
      const joiner = prev.endsWith("-") ? "" : " ";
      merged[merged.length - 1] = prev.replace(/-$/, "") + joiner + trimmed;
    } else {
      merged.push(trimmed);
    }
  }

  return merged;
};

/**
 * pdfjs-dist (via pdf-parse v2) calls DOMMatrix in its PDF worker; Node does not
 * provide that global unless we polyfill it from @napi-rs/canvas (pdf-parse dep).
 */
async function ensurePdfNodePolyfills() {
  if (pdfNodePolyfillsReady) return;
  if (typeof globalThis.DOMMatrix === "undefined") {
    const { DOMMatrix } = await import("@napi-rs/canvas");
    globalThis.DOMMatrix = DOMMatrix;
  }
  pdfNodePolyfillsReady = true;
}

/**
 * Mammoth only reads alignment set *directly* on a paragraph (`w:jc` in its
 * own `w:pPr`); it never resolves alignment inherited from a named paragraph
 * style (e.g. a "Body Text" or custom "Chapter Title" style whose alignment
 * lives in `word/styles.xml`). Real manuscripts commonly align text via a
 * style rather than per-paragraph direct formatting, so we parse the docx's
 * styles.xml ourselves and resolve the *effective* alignment (direct
 * override, else the paragraph's style, else that style's `w:basedOn`
 * ancestor, and so on).
 */
const readDocxStylesAlignmentMap = async (buffer) => {
  const stylesMap = new Map();
  try {
    const [{ default: JSZip }, { load: loadXml }] = await Promise.all([
      import("jszip"),
      import("cheerio"),
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const stylesFile = zip.file("word/styles.xml");
    if (!stylesFile) return stylesMap;

    const xml = await stylesFile.async("string");
    const $ = loadXml(xml, { xmlMode: true });

    $("*").each((_, el) => {
      if (el.tagName !== "w:style") return;
      const $style = $(el);
      const type = $style.attr("w:type");
      if (type && type !== "paragraph") return;
      const styleId = $style.attr("w:styleId");
      if (!styleId) return;

      let basedOn = null;
      let alignment = null;
      $style.children().each((__, child) => {
        if (child.tagName === "w:basedOn") {
          basedOn = $(child).attr("w:val") || basedOn;
        }
        if (child.tagName === "w:pPr") {
          $(child)
            .children()
            .each((___, ppChild) => {
              if (ppChild.tagName === "w:jc") {
                alignment = $(ppChild).attr("w:val") || alignment;
              }
            });
        }
      });

      stylesMap.set(styleId, { basedOn, alignment });
    });
  } catch {
    return stylesMap;
  }
  return stylesMap;
};

/** Walk a style's `basedOn` chain (cycle-safe) until an alignment is found. */
const resolveStyleAlignment = (styleId, stylesMap, seen = new Set()) => {
  if (!styleId || seen.has(styleId)) return null;
  seen.add(styleId);
  const style = stylesMap.get(styleId);
  if (!style) return null;
  if (style.alignment) return style.alignment;
  return resolveStyleAlignment(style.basedOn, stylesMap, seen);
};

/** OOXML `w:jc` values -> the synthetic style-name suffix we tag paragraphs with. */
const normalizeWordAlignmentValue = (value) => {
  switch (value) {
    case "center":
      return "Center";
    case "right":
    case "end":
      return "Right";
    case "both":
    case "justify":
    case "distribute":
      return "Justify";
    default:
      // "left" / "start" / unset all match Quill's default — no class needed.
      return null;
  }
};

const HEADING_STYLE_ID_RE = /^Heading([1-6])$/i;
const HEADING_STYLE_NAME_RE = /^heading\s*([1-6])$/i;

/** Detect Word's built-in heading level so alignment tagging doesn't clobber it. */
const detectHeadingLevel = (paragraph) => {
  const idMatch = HEADING_STYLE_ID_RE.exec(paragraph.styleId || "");
  if (idMatch) return idMatch[1];
  const nameMatch = HEADING_STYLE_NAME_RE.exec(paragraph.styleName || "");
  return nameMatch ? nameMatch[1] : null;
};

/**
 * Mammoth ignores paragraph alignment by default; tag it via a synthetic
 * style name so the styleMap below can turn it into a Quill align class.
 * List items are left untouched so mammoth's numbering-based list detection
 * (matched independently of style name) keeps working.
 */
const makeTagWordParagraphAlignment = (stylesMap) => (paragraph) => {
  if (paragraph.numbering) return paragraph;

  const rawAlignment =
    paragraph.alignment || resolveStyleAlignment(paragraph.styleId, stylesMap);
  const alignmentSuffix = normalizeWordAlignmentValue(rawAlignment);
  if (!alignmentSuffix) return paragraph;

  const headingLevel = detectHeadingLevel(paragraph);
  const styleName = headingLevel
    ? `SgH${headingLevel}Align${alignmentSuffix}`
    : `SgAlign${alignmentSuffix}`;

  return { ...paragraph, styleId: styleName, styleName };
};

const ALIGN_SUFFIX_TO_CLASS = [
  ["Center", "center"],
  ["Right", "right"],
  ["Justify", "justify"],
];

/** `SgH<n>Align<Suffix>` => `h<n>.ql-align-<class>`, for every heading level 1-6. */
const buildHeadingAlignStyleMapRules = () => {
  const rules = [];
  for (let level = 1; level <= 6; level += 1) {
    for (const [suffix, cls] of ALIGN_SUFFIX_TO_CLASS) {
      rules.push(
        `p[style-name='SgH${level}Align${suffix}'] => h${level}.ql-align-${cls}:fresh`
      );
    }
  }
  return rules;
};

const WORD_STYLE_MAP = [
  "p[style-name='SgAlignCenter'] => p.ql-align-center:fresh",
  "p[style-name='SgAlignRight'] => p.ql-align-right:fresh",
  "p[style-name='SgAlignJustify'] => p.ql-align-justify:fresh",
  ...buildHeadingAlignStyleMapRules(),
  "u => u",
  "strike => s",
];

/**
 * Extract Word content as Quill-safe HTML blocks (Phase A: alignment, bold,
 * italic, underline, strike, headings, lists, links). Falls back to a plain
 * `<p>` per line for TXT/MD/PDF, matching current behavior exactly.
 */
const extractDocxBlocks = async (buffer) => {
  const mammoth = await import("mammoth");
  const { normalizeWordHtmlToQuillBlocks, EMPTY_PARAGRAPH_SENTINEL } =
    await import("./wordHtmlToQuillHtml.js");
  const stylesMap = await readDocxStylesAlignmentMap(buffer);

  const collectMammothParagraphPlainText = (paragraph) => {
    let text = "";
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === "text") text += node.value || "";
        if (node.children) walk(node.children);
      }
    };
    walk(paragraph.children);
    return text;
  };

  /** Mammoth omits empty `<p>` from HTML — tag empties so normalization can restore them. */
  const tagEmptyWordParagraphsWithSentinel = (paragraph) => {
    if (paragraph.numbering) return paragraph;
    if (collectMammothParagraphPlainText(paragraph).trim()) return paragraph;
    return {
      ...paragraph,
      children: [{ type: "text", value: EMPTY_PARAGRAPH_SENTINEL }],
    };
  };

  const transformParagraph = (paragraph) =>
    tagEmptyWordParagraphsWithSentinel(
      makeTagWordParagraphAlignment(stylesMap)(paragraph)
    );

  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    {
      transformDocument: mammoth.transforms.paragraph(transformParagraph),
      styleMap: WORD_STYLE_MAP,
    }
  );
  return normalizeWordHtmlToQuillBlocks(html);
};

/** Plain-text line wrapped as a block with no rich HTML (TXT/MD/PDF path). */
const blockFromPlainLine = (line) => ({ text: line, html: null });

/**
 * Extract ordered content blocks from an uploaded manuscript buffer.
 * Supports TXT/MD, PDF, and DOCX (DOC best-effort via mammoth). DOCX blocks
 * carry Quill-safe rich HTML; TXT/MD/PDF blocks are plain text only.
 *
 * @returns {Promise<Array<{ text: string, html: string|null }>>}
 */
export const extractManuscriptBlocks = async (buffer, fileName = "") => {
  const lower = String(fileName).toLowerCase();

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return splitToLines(buffer.toString("utf8")).map(blockFromPlainLine);
  }

  if (lower.endsWith(".pdf")) {
    await ensurePdfNodePolyfills();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({ pageJoiner: "" });
      const lines = normalizePdfExtractedLines(splitToLines(result?.text || ""));
      return lines.map(blockFromPlainLine);
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  // Default: DOCX (and .doc best-effort) via mammoth.
  return extractDocxBlocks(buffer);
};

/**
 * Extract plain-text paragraph lines from an uploaded manuscript buffer.
 * Thin wrapper over `extractManuscriptBlocks` for callers that only need
 * chapter-detection text (kept for backward compatibility).
 */
export const extractManuscriptLines = async (buffer, fileName = "") => {
  const blocks = await extractManuscriptBlocks(buffer, fileName);
  return blocks.map((b) => b.text).filter(Boolean);
};

/** Split text into lines, preserving blank lines as paragraph separators. */
export const splitToLines = (text) => {
  const raw = String(text || "").split(/\r?\n/);
  const lines = [];
  for (const line of raw) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(trimmed);
  }
  return lines;
};

/**
 * Parse pre-extracted lines into title-page metadata and ordered chapters.
 *
 * @param {string[]} lines
 * @returns {{
 *   titlePage: { title: string, author: string, genre: string, subgenre: string, compTitles: string[] },
 *   chapters: Array<{ chapterNumber: number, chapterLabel: string, pov: string|null, timeline: string|null, contentLines: string[] }>,
 *   warnings: string[]
 * }}
 */
export const parseManuscriptLines = (lines = []) =>
  parseManuscriptBlocks(lines.map((line) => ({ text: line, html: null })));

/**
 * Parse pre-extracted content blocks into title-page metadata and ordered
 * chapters. Chapter/section headers are still matched on `block.text`, so
 * detection is unaffected by DOCX rich HTML; each chapter also accumulates
 * `contentBlocks` (rich HTML) alongside the existing `contentLines` (plain
 * text) so callers that only need text keep working unchanged.
 *
 * @param {Array<{ text: string, html: string|null }>} blocks
 * @returns same shape as `parseManuscriptLines`, plus `contentBlocks` per chapter.
 */
export const parseManuscriptBlocks = (blocks = []) => {
  const rawSections = [];
  const preChapterLines = [];
  let current = null;

  for (const block of blocks) {
    const line = block.text;
    const chapterHeader = matchChapterHeader(line);
    const standaloneHeader = chapterHeader
      ? null
      : matchStandaloneSectionHeader(line);

    if (chapterHeader) {
      if (current && isOrnamentDuplicateSectionHeader(current, chapterHeader)) {
        continue;
      }
      if (current) rawSections.push(current);
      current = { ...chapterHeader, contentLines: [], contentBlocks: [] };
    } else if (standaloneHeader) {
      if (current && isOrnamentDuplicateSectionHeader(current, standaloneHeader)) {
        continue;
      }
      if (current) rawSections.push(current);
      current = {
        ...standaloneHeader,
        chapterNumber: null,
        chapterSuffix: null,
        pov: null,
        timeline: null,
        contentLines: [],
        contentBlocks: [],
      };
    } else if (current) {
      current.contentLines.push(line);
      current.contentBlocks.push(block);
    } else {
      preChapterLines.push(line);
    }
  }
  if (current) rawSections.push(current);

  const dedupedSections = dropOrnamentEmptyDuplicateSections(rawSections);
  const withNumbers = assignStandaloneSectionNumbers(dedupedSections);
  const consolidated = consolidateChaptersByBaseNumber(withNumbers).map(
    ({ _isBackMatter, ...chapter }) => chapter
  );

  return {
    titlePage: parseTitlePage(preChapterLines),
    chapters: consolidated,
    warnings: validateChapterSequence(withNumbers),
  };
};

/**
 * Full pipeline: extract content blocks from a buffer and parse them.
 * @returns same shape as `parseManuscriptLines`, plus `contentBlocks` per chapter.
 */
export const parseManuscriptBuffer = async (buffer, fileName = "") => {
  const blocks = await extractManuscriptBlocks(buffer, fileName);
  return parseManuscriptBlocks(blocks);
};
