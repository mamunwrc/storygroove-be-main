import crypto from "crypto";
import Message from "../models/messageModel.js";
import UserContent from "../models/userContentModel.js";
import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import { stripEllisOutputAdapter } from "../utils/reviewPrompts/ellisPromptUtils.js";
import { loadAgentPromptFromDb } from "../utils/loadAgentPrompt.js";
import { stripChapterHtmlToText } from "../utils/manuscriptText.js";
import { extractScenePov } from "../utils/extractSceneTitle.js";
import {
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_CONVERSATIONAL,
  ELLIS_METADATA_KIND_INSERT_CONFIRM,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
  ELLIS_METADATA_KIND_SCENE_WELCOME,
  ELLIS_FIRST_PASS_WRAP_UP_SNIPPET,
} from "../constants/ellisUiMessages.js";
import { ELLIS_PRIOR_REVIEW_EXCERPT_MAX_CHARS } from "../constants/ellisMemory.js";
import {
  normalizeChapterSuffix,
  chapterIdentityKey,
  chapterProgressKey,
  parseChapterLetterSuffix,
  matchStandaloneSectionHeader,
  STANDALONE_SECTION_NAMES,
} from "../utils/manuscriptParser.js";
import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";
import {
  sortChapterRows,
  resolveChapterLabel,
  buildManuscriptMapContext,
  buildAdjacentChapterContext,
  getDistinctBaseChapterRows,
  collectReadyChapterNumbers,
  resolveNextEllisOpenChapter,
  isEllisManuscriptChapterNumber,
} from "./ellisManuscriptContext.js";
import {
  detectChapterScenes,
  buildEllisChapterSceneInventoryBlock,
  buildEllisMultiSceneKickoffReminder,
} from "../utils/ellisChapterSceneDetection.js";

const START_CHAPTER_PREFIX =
  /^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:start\s+(?:with\s+)?|let'?s\s+(?:start|review)\s+)chapter\s+/i;

const FOCUS_CHAPTER_PREFIX =
  /^(?:review|look at|work on|focus on|tell me about|deliver|give me|show me|re-?deliver|edit)\s+(?:(?:again|please)\s+)*(?:the\s+)?chapter\s+/i;

/**
 * Same kickoff verbs as FOCUS_CHAPTER_PREFIX minus "tell me about" (which
 * stays Q&A-only even said bluntly), wrapped in an optional polite lead-in.
 * Keeps "Can you show me chapter 8" / "Please look at chapter 1.5" in sync
 * with their bare-verb form instead of only covering review/deliver/edit.
 */
const POLITE_KICKOFF_VERBS =
  "review|look at|work on|focus on|deliver|give me|show me|re-?deliver|edit|start";
const POLITE_REVIEW_CHAPTER_PREFIX = new RegExp(
  `^(?:(?:can|could|would)\\s+you\\s+|please\\s+)(?:${POLITE_KICKOFF_VERBS})\\s+(?:(?:again|please)\\s+)*(?:the\\s+)?chapter\\s+`,
  "i"
);

/** Integer or decimal chapter token (1, 2, 1.5, 2.5). */
const CHAPTER_DIGIT_TOKEN_RE = /^(\d{1,3}(?:\.\d+)?)(.*)$/;
const CHAPTER_DIGIT_CAPTURE = "(\\d{1,3}(?:\\.\\d+)?)";

/** Common misspellings / shorthand for "chapter" before a number.
 * Short `ch` / `chp` must be a complete token (followed by space, digit, or
 * period) so ordinary words like "changes" / "check" are not eaten as
 * chapter shorthand and hide a later "Chapter nine". */
const FUZZY_CHAPTER_WORD =
  /(?:chapter|hapter|chpater|charpter|chaptre|chpter|(?:chp|ch)\.?(?=\s|\d|$|\.))\s*/i;

const CHANGE_REQUEST_RE =
  /\b(?:different\s+lens|recalibrat\w*|revise|revised|revising|revision|change|changed|changing|changes|update|updated|updating|updates|adjust|adjusted|adjusting|adjustment|rewrite|rewrote|rewriting|rewrites|through\s+a\s+different|new\s+(?:angle|take|version)|make\s+(?:it\s+)?different)\b/i;

const AFFIRMATION_RE =
  /^(?:okay|ok|k|yes|yeah|yep|yup|sure|sounds\s+good|go\s+ahead|let'?s\s+do\s+(?:that|it)|please\s+do|do\s+it|absolutely|definitely|of\s+course|right|correct|affirmative|that\s+works|perfect|great)(?:[.!]?)$/i;

const ADVANCE_INTENT_RE =
  /^(?:next\s+(?:one|chapter|scene)[.!?]?)$|\b(?:(?:let'?s\s+)?move\s+(?:on\s+to|to)\s+(?:the\s+)?next(?:\s+(?:one|chapter|scene))?|(?:let'?s\s+)?(?:do|start|review)\s+(?:the\s+)?next\s+(?:one|chapter|scene)|ready\s+for\s+(?:the\s+)?next(?:\s+(?:one|chapter|scene))?|next\s+(?:one|chapter|scene)\s+please|continue(?:\s+to\s+the\s+next(?:\s+(?:one|chapter|scene))?)?|let'?s\s+continue)\b/i;

/** Chapter text is always reference. The writer's message decides kickoff vs Q&A. */
export const ELLIS_CHAPTER_REFERENCE_BANNER =
  "═══ CHAPTER BODY (reference only — the writer's message and the thread decide which chapter this turn is about; do NOT review this chapter just because its text is here, and do NOT deliver a chapter review / Output Standard unless they asked for that chapter's pass) ═══";

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

const parseWordChapterNumber = (rest) => {
  let remaining = String(rest || "").trim();
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

  return sawNumber && value > 0
    ? { number: value, remainder: remaining.trim() }
    : null;
};

export const parseChapterRefFromRest = (rest) => {
  const trimmed = String(rest || "").trim();
  const digitMatch = trimmed.match(CHAPTER_DIGIT_TOKEN_RE);
  if (digitMatch && /^\d/.test(trimmed)) {
    const num = Number(digitMatch[1]);
    if (!Number.isFinite(num) || num < 1) return null;
    const { suffix } = parseChapterLetterSuffix(digitMatch[2]);
    return { chapterNumber: num, chapterSuffix: suffix };
  }
  const wordParsed = parseWordChapterNumber(trimmed);
  if (!wordParsed) return null;
  const { suffix } = parseChapterLetterSuffix(wordParsed.remainder);
  return { chapterNumber: wordParsed.number, chapterSuffix: suffix };
};

/**
 * Parse chapter number + optional letter suffix from user chat text.
 * Accepts common misspellings (hapter, chpater) and shorthand (ch 8).
 * @returns {{ chapterNumber: number, chapterSuffix: string } | null}
 */
export const parseEllisChapterRefFromMessage = (message) => {
  const raw = String(message || "").trim();
  if (!raw) return null;

  for (const prefix of [
    START_CHAPTER_PREFIX,
    FOCUS_CHAPTER_PREFIX,
    POLITE_REVIEW_CHAPTER_PREFIX,
  ]) {
    const prefixMatch = raw.match(prefix);
    if (prefixMatch) {
      const ref = parseChapterRefFromRest(raw.slice(prefixMatch[0].length));
      if (ref) return ref;
    }
  }

  const fuzzyDigit = raw.match(
    new RegExp(`\\b${FUZZY_CHAPTER_WORD.source}${CHAPTER_DIGIT_CAPTURE}([A-Za-z])?\\b`, "i")
  );
  if (fuzzyDigit) {
    const num = Number(fuzzyDigit[1]);
    if (Number.isFinite(num) && num > 0) {
      return {
        chapterNumber: num,
        chapterSuffix: normalizeChapterSuffix(fuzzyDigit[2]),
      };
    }
  }

  // Scan every "chapter <words>" hit. A failed early match (e.g. leftover
  // letters after a shorthand) must not hide a later "Chapter nine".
  const fuzzyWordRe = new RegExp(
    `\\b${FUZZY_CHAPTER_WORD.source}([a-z][a-z\\s-]*)`,
    "gi"
  );
  for (const fuzzyWord of raw.matchAll(fuzzyWordRe)) {
    const ref = parseChapterRefFromRest(fuzzyWord[1]);
    if (ref) return ref;
  }

  // Bare decimal chapter number embedded anywhere in a longer message
  // ("can you go read 6.5 and give me feedback") — no "chapter" word needed.
  // Decimals are chapter-specific identifiers in this app (inserted/renumbered
  // chapters use X.Y), so this is safe even without a keyword anchor.
  // ponytail: a plain integer ("read 6 and give me feedback") is still not
  // matched here since a bare whole number is too ambiguous outside a decimal
  // or an explicit "chapter" word — upgrade path is a targeted verb+integer
  // parse, not a blanket bare-number match.
  const bareDecimal = raw.match(/\b(\d{1,3}\.\d+)\b/);
  if (bareDecimal) {
    const num = Number(bareDecimal[1]);
    if (Number.isFinite(num) && num > 0) {
      return { chapterNumber: num, chapterSuffix: "" };
    }
  }

  return parseEllisBareChapterRef(raw);
};

/**
 * Whole-message chapter shorthand (e.g. "Eleven", "11", "seven").
 * @returns {{ chapterNumber: number, chapterSuffix: string } | null}
 */
export const parseEllisBareChapterRef = (message) => {
  const raw = String(message || "").trim();
  if (!raw || raw.length > 32) return null;
  if (AFFIRMATION_RE.test(raw)) return null;
  if (ADVANCE_INTENT_RE.test(raw)) return null;
  if (CHANGE_REQUEST_RE.test(raw)) return null;
  if (
    START_CHAPTER_PREFIX.test(raw) ||
    FOCUS_CHAPTER_PREFIX.test(raw) ||
    POLITE_REVIEW_CHAPTER_PREFIX.test(raw)
  ) {
    return null;
  }

  // Allow a whole-message "Chapter N" / "Chapter One" / "Chapter 15 B" to act as
  // a bare chapter selector (kickoff), same as a bare number. Strip a leading
  // "chapter" word, then require the remainder to be ONLY a chapter number/word
  // (+ optional letter suffix) with nothing substantive after it — so a longer
  // message like "Chapter 3 feels slow" stays conversational.
  const leadChapterWord = raw.match(
    new RegExp(`^${FUZZY_CHAPTER_WORD.source}`, "i")
  );
  const hadChapterWord = Boolean(leadChapterWord);
  const candidate = hadChapterWord
    ? raw.slice(leadChapterWord[0].length).trim()
    : raw;
  if (!candidate) return null;

  // Digit form: "1", "15B", "15 B", "1.5", "2.5".
  const digitWhole = candidate.match(/^(\d{1,3}(?:\.\d+)?)\s*([A-Za-z])?\s*[.!?]*$/);
  if (digitWhole) {
    const num = Number(digitWhole[1]);
    if (Number.isFinite(num) && num >= 1) {
      return {
        chapterNumber: num,
        chapterSuffix: normalizeChapterSuffix(digitWhole[2]),
      };
    }
    return null;
  }

  // Word form: "One", "Fifteen", "Fifteen B".
  const wordParsed = parseWordChapterNumber(candidate);
  if (wordParsed) {
    const tail = String(wordParsed.remainder || "").trim();
    if (!tail) {
      return { chapterNumber: wordParsed.number, chapterSuffix: "" };
    }
    const suffixMatch = tail.match(/^([A-Za-z])[.!?]*$/);
    if (suffixMatch) {
      return {
        chapterNumber: wordParsed.number,
        chapterSuffix: normalizeChapterSuffix(suffixMatch[1]),
      };
    }
  }

  return null;
};

/**
 * Parse a whole-message standalone section name ("Prologue", "the Epilogue")
 * so it can load that section's text, the same way a bare chapter number
 * does. Returns the Title-cased label (e.g. "Prologue") or null.
 * @returns {string | null}
 */
export const parseEllisBareSectionLabel = (message) => {
  const raw = String(message || "").trim();
  if (!raw || raw.length > 32) return null;

  const cleaned = raw
    .replace(/^the\s+/i, "")
    .replace(/[.!?,:;]+$/, "")
    .trim();
  if (!cleaned) return null;

  const namePattern = STANDALONE_SECTION_NAMES.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const m = cleaned.match(new RegExp(`^(${namePattern})$`, "i"));
  if (!m) return null;

  return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
};

/**
 * Parse the base chapter number from a Scene Architect review header.
 * Scene labels like "Chapter Ten A" map to base chapter 10 only (suffix ignored).
 * @returns {{ chapterNumber: number, chapterSuffix: string } | null}
 */
export const parseEllisReviewBaseChapterFromContent = (text) => {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .slice(0, 6)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const ref = parseEllisChapterRefFromMessage(line);
    if (Number.isFinite(ref?.chapterNumber)) {
      return { chapterNumber: ref.chapterNumber, chapterSuffix: "" };
    }
  }

  if (lines.length > 0) {
    const ref = parseEllisChapterRefFromMessage(lines.join("\n"));
    if (Number.isFinite(ref?.chapterNumber)) {
      return { chapterNumber: ref.chapterNumber, chapterSuffix: "" };
    }
  }

  return null;
};

/**
 * Parse a standalone section label (Prologue, Epilogue, etc.) from a review header.
 * @returns {string | null}
 */
export const parseEllisReviewSectionLabelFromContent = (text) => {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .slice(0, 6)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const customTitle = titleFromStandaloneOpenerLine(line);
    if (customTitle) return customTitle;
    const standalone = matchStandaloneSectionHeader(line);
    if (standalone?.chapterLabel) return standalone.chapterLabel;
  }

  return null;
};

/**
 * Parse a standalone section label (Prologue, Epilogue, …) from the review's
 * HEADER line only. Unlike parseEllisReviewSectionLabelFromContent, this never
 * inspects body prose, so a Prologue review that mentions "Chapter One" inside
 * its analysis is not misread as a numbered chapter.
 * @returns {string | null}
 */
const stripEllisReviewOpenerDecorations = (line) =>
  String(line || "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(
      /\s+\*{0,2}(?:Function in Story|Genre Beat Check|Scene Analysis|Creative Suggestions)\b.*$/i,
      ""
    )
    .trim();

const titleFromStandaloneOpenerLine = (line) => {
  const cleaned = stripEllisReviewOpenerDecorations(line);
  if (!cleaned || /^chapter\s+/i.test(cleaned)) return null;

  const withPov = cleaned.match(/^(.+?)\s*[–—-]\s*POV\s*:/i);
  const title = (withPov ? withPov[1] : cleaned).trim();
  if (!title) return null;

  const namePattern = STANDALONE_SECTION_NAMES.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const starts = new RegExp(`^(${namePattern})(?:\\b|[\\s–—\\-:,]|$)`, "i");
  if (!starts.test(title)) return null;
  return title;
};

export const parseEllisReviewSectionLabelFromHeader = (text) => {
  const firstLine = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const customTitle = titleFromStandaloneOpenerLine(firstLine);
  if (customTitle) return customTitle;

  const standalone = matchStandaloneSectionHeader(firstLine);
  if (standalone?.chapterLabel) return standalone.chapterLabel;

  return null;
};

const findChapterRefByLabel = (userContents = [], label) => {
  const norm = String(label || "").trim().toLowerCase();
  if (!norm || !userContents.length) return null;

  const rows = getUploadedChapterRows(userContents);
  const keysOf = (uc) =>
    [uc.chapterLabel, uc.sceneTitle]
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase());
  const exact = rows.find((uc) => keysOf(uc).includes(norm));
  const prefixHits =
    !exact && norm.length >= 3
      ? rows.filter((uc) =>
          keysOf(uc).some(
            (key) =>
              key.startsWith(`${norm} -`) ||
              key.startsWith(`${norm} –`) ||
              key.startsWith(`${norm} —`) ||
              key.startsWith(`${norm}:`)
          )
        )
      : [];
  const row = exact || (prefixHits.length === 1 ? prefixHits[0] : null);
  if (!row || !isEllisManuscriptChapterNumber(row.chapterNumber)) return null;

  return {
    chapterNumber: Number(row.chapterNumber),
    chapterSuffix: normalizeChapterSuffix(row.chapterSuffix) || "",
  };
};

/** Short affirmative replies (okay, yes, go ahead, etc.). */
export const isEllisAffirmation = (message) => {
  const raw = String(message || "").trim();
  if (!raw || raw.length > 48) return false;
  return AFFIRMATION_RE.test(raw);
};

export const extractChapterRefFromAssistantContent = (content) => {
  const raw = String(content || "");
  if (!raw) return null;
  const parsed = parseEllisChapterRefFromMessage(raw);
  if (parsed) return parsed;
  const digitMatch = raw.match(
    new RegExp(`\\bchapter\\s+${CHAPTER_DIGIT_CAPTURE}([A-Za-z])?\\b`, "i")
  );
  if (digitMatch) {
    const num = Number(digitMatch[1]);
    if (Number.isFinite(num) && num > 0) {
      return {
        chapterNumber: num,
        chapterSuffix: normalizeChapterSuffix(digitMatch[2]),
      };
    }
  }
  return null;
};


const INSERT_CONFIRM_NEXT_OPEN_RE =
  /next open chapter is\s+\*{0,2}\s*([^*]+?)\s*\*{0,2}(?:\.|,|$)/i;

/** Parse "1.5", "Chapter 1.5", "Chapter Two" from insert-confirm copy or metadata. */
const parseChapterRefFromLabelOrRest = (raw) => {
  const text = String(raw || "")
    .replace(/\*+/g, "")
    .trim();
  if (!text) return null;
  const withoutWord = text.replace(/^chapter\s+/i, "").trim();
  return (
    parseChapterRefFromRest(withoutWord) ||
    parseEllisChapterRefFromMessage(text) ||
    parseEllisChapterRefFromMessage(`chapter ${withoutWord}`)
  );
};

/**
 * Next chapter an insert-confirm is inviting. Prefers the named label (1.5)
 * over the row's integer position (chapterNumber 2 after a 1.5 insert), which
 * otherwise resolves to "Chapter Two" via label match.
 */
export const resolveEllisInsertConfirmNextChapter = (msg) => {
  if (!msg) return null;
  const meta = msg.metadata || {};
  const content = String(msg.content || "");
  const nextId = meta.nextChapterId ? String(meta.nextChapterId) : null;
  const nextLabel = String(meta.nextChapterLabel || "").trim() || null;
  const fromMetaLabel = nextLabel
    ? parseChapterRefFromLabelOrRest(nextLabel)
    : null;
  const nextOpen = content.match(INSERT_CONFIRM_NEXT_OPEN_RE);
  const fromText = nextOpen
    ? parseChapterRefFromLabelOrRest(nextOpen[1])
    : null;
  const positional = Number(meta.nextChapterNumber);
  const chapterNumber =
    fromMetaLabel?.chapterNumber ??
    fromText?.chapterNumber ??
    (isEllisManuscriptChapterNumber(positional) ? positional : null);
  if (
    !nextId &&
    !nextLabel &&
    !isEllisManuscriptChapterNumber(chapterNumber)
  ) {
    return null;
  }
  return {
    chapterNumber: isEllisManuscriptChapterNumber(chapterNumber)
      ? chapterNumber
      : null,
    chapterSuffix: normalizeChapterSuffix(
      fromMetaLabel?.chapterSuffix ||
        fromText?.chapterSuffix ||
        meta.nextChapterSuffix
    ),
    chapterId: nextId,
    chapterLabel: nextLabel,
  };
};

/**
 * Every "Chapter <digit|word>" mention in an assistant message, in order.
 * @returns {{ chapterNumber: number, chapterSuffix: string }[]}
 */
export const extractChapterRefsFromAssistantContent = (content) => {
  const raw = String(content || "");
  if (!raw) return [];

  const chapterRe = /\bchapter\s+/gi;
  const refs = [];
  let match;
  while ((match = chapterRe.exec(raw)) !== null) {
    const rest = raw.slice(match.index + match[0].length);
    const digitMatch = rest.match(/^(\d{1,3}(?:\.\d+)?)([A-Za-z])?\b/);
    if (digitMatch) {
      const num = Number(digitMatch[1]);
      if (Number.isFinite(num) && num > 0) {
        refs.push({
          chapterNumber: num,
          chapterSuffix: normalizeChapterSuffix(digitMatch[2]),
        });
      }
      continue;
    }
    const wordParsed = parseChapterRefFromRest(rest);
    if (wordParsed?.chapterNumber) {
      refs.push(wordParsed);
    }
  }
  return refs;
};

/** Unique base chapter numbers named in an assistant reply. */
export const uniqueAssistantChapterNumbers = (content) => [
  ...new Set(
    extractChapterRefsFromAssistantContent(content).map((r) => r.chapterNumber)
  ),
];

/**
 * Find the LAST "Chapter <digit|word>" mention in an assistant message.
 * @returns {{ chapterNumber: number, chapterSuffix: string } | null}
 */
export const extractLastChapterRefFromAssistantContent = (content) => {
  const refs = extractChapterRefsFromAssistantContent(content);
  return refs.length ? refs[refs.length - 1] : null;
};

const topicFromConversationalAssistant = (msg) => {
  // Map / inventory answers name many chapters. They are not the topic.
  if (uniqueAssistantChapterNumbers(msg.content).length > 1) return null;
  const stampedNum = Number(msg.metadata?.chapterNumber);
  if (isEllisManuscriptChapterNumber(stampedNum)) {
    return {
      chapterNumber: stampedNum,
      chapterSuffix: normalizeChapterSuffix(msg.metadata?.chapterSuffix),
      chapterId: msg.metadata?.chapterId
        ? String(msg.metadata.chapterId)
        : null,
    };
  }
  const named = extractLastChapterRefFromAssistantContent(msg.content);
  if (!named?.chapterNumber) return null;
  return {
    chapterNumber: named.chapterNumber,
    chapterSuffix: named.chapterSuffix || null,
    chapterId: msg.metadata?.chapterId ? String(msg.metadata.chapterId) : null,
  };
};

/**
 * Pure scan of recent messages for conversational topic chapter (newest wins).
 * After a conversational Q&A reply that named a chapter, that chapter is the
 * topic — not the next-open insert-confirm and not a stale user stamp from
 * the previous sequential gap. Do not regex-parse the writer's text.
 */
export const resolveEllisTopicChapterFromMessages = (
  messages = [],
  { limit = 12 } = {}
) => {
  const slice = messages.slice(0, limit);

  for (const msg of slice) {
    if (msg.role !== "assistant") continue;
    const kind = msg.metadata?.kind;
    if (
      kind === ELLIS_METADATA_KIND_CHAPTER_REVIEW ||
      kind === ELLIS_METADATA_KIND_REVISION_REVIEW ||
      kind === ELLIS_METADATA_KIND_INSERT_CONFIRM ||
      kind === ELLIS_METADATA_KIND_SCENE_WELCOME
    ) {
      break;
    }
    if (kind && kind !== ELLIS_METADATA_KIND_CONVERSATIONAL) continue;
    const fromReply = topicFromConversationalAssistant(msg);
    if (fromReply) return fromReply;
  }

  let sawConversational = false;
  for (const msg of slice) {
    if (msg.role === "user") {
      if (sawConversational) continue;
      const chapterId = msg.metadata?.chapterId
        ? String(msg.metadata.chapterId)
        : null;
      const num = Number(msg.metadata?.chapterNumber);
      if (chapterId || isEllisManuscriptChapterNumber(num)) {
        return {
          chapterNumber: isEllisManuscriptChapterNumber(num) ? num : null,
          chapterSuffix: normalizeChapterSuffix(msg.metadata?.chapterSuffix),
          chapterId,
        };
      }
      continue;
    }

    if (msg.role !== "assistant") continue;

    const kind = msg.metadata?.kind;
    if (
      kind === ELLIS_METADATA_KIND_CONVERSATIONAL ||
      !kind
    ) {
      sawConversational = true;
      continue;
    }

    // Q&A after an insert-confirm or review means those rows are no longer
    // the conversation. Do not let "next open chapter is Six" win.
    if (sawConversational) continue;

    if (kind === ELLIS_METADATA_KIND_INSERT_CONFIRM) {
      const next = resolveEllisInsertConfirmNextChapter(msg);
      if (next) return next;
      continue;
    }

    const num = Number(msg.metadata?.chapterNumber);
    if (
      (kind === ELLIS_METADATA_KIND_CHAPTER_REVIEW ||
        kind === ELLIS_METADATA_KIND_REVISION_REVIEW) &&
      isEllisManuscriptChapterNumber(num)
    ) {
      return {
        chapterNumber: num,
        chapterSuffix: normalizeChapterSuffix(msg.metadata?.chapterSuffix),
        chapterId: msg.metadata?.chapterId
          ? String(msg.metadata.chapterId)
          : null,
      };
    }

    if (kind === ELLIS_METADATA_KIND_SCENE_WELCOME) {
      return {
        chapterNumber: isEllisManuscriptChapterNumber(num) ? num : 1,
        chapterSuffix: normalizeChapterSuffix(msg.metadata?.chapterSuffix),
        chapterId: msg.metadata?.chapterId
          ? String(msg.metadata.chapterId)
          : null,
      };
    }
  }

  return null;
};

/**
 * Scan recent thread messages for the conversational topic chapter (newest wins).
 */
export const resolveEllisTopicChapterFromThread = async (
  threadId,
  { limit = 10 } = {}
) => {
  if (!threadId) return null;

  const messages = await Message.find({ threadId })
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit)
    .select("role content metadata")
    .lean();

  return resolveEllisTopicChapterFromMessages(messages, { limit });
};

/**
 * SHA-1 of stripped chapter draft text. Stamped on saved chapter-review metadata.
 */
export const hashEllisChapterDraft = (htmlOrText = "") =>
  crypto
    .createHash("sha1")
    .update(stripChapterHtmlToText(htmlOrText))
    .digest("hex");

export const chapterHasEllisDraftContent = (userContent) =>
  Boolean(stripChapterHtmlToText(userContent).trim());

/**
 * True when a message row is a non-empty chapter review for the given base chapter.
 */
export const messageMatchesEllisChapterReview = (
  msg,
  chapterNumber,
  chapterId = null
) => {
  if (!msg) return false;
  const content = String(msg.content || "").trim();
  if (!content) return false;
  if (chapterId && String(msg.metadata?.chapterId || "") === String(chapterId)) {
    return true;
  }
  if (!Number.isFinite(Number(chapterNumber))) return false;
  const num = Number(chapterNumber);
  const metaNum = Number(msg.metadata?.chapterNumber);
  if (Number.isFinite(metaNum) && metaNum === num) return true;
  const fromHeader = parseEllisReviewBaseChapterFromContent(content);
  return fromHeader?.chapterNumber === num;
};

/**
 * In-thread chapter review message for a chapter (full content + meta).
 * Prefer stable chapterId; fall back to chapterNumber.
 * @param {{ preferOldest?: boolean }} options — oldest for redelivery replay; newest for repeat kickoff.
 */
export const findStoredEllisChapterReview = async ({
  threadId,
  chapterNumber,
  chapterId = null,
  preferOldest = false,
}) => {
  if (!threadId) return null;
  const sort = preferOldest
    ? { timestamp: 1, _id: 1 }
    : { timestamp: -1, _id: -1 };

  if (chapterId) {
    const byId = await Message.findOne({
      threadId,
      role: "assistant",
      "metadata.kind": {
        $in: [
          ELLIS_METADATA_KIND_CHAPTER_REVIEW,
          ELLIS_METADATA_KIND_REVISION_REVIEW,
        ],
      },
      "metadata.chapterId": String(chapterId),
    })
      .sort(sort)
      .select("content metadata")
      .lean();
    if (byId?.content) return byId;
  }

  if (!Number.isFinite(Number(chapterNumber))) return null;

  const query = {
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_CHAPTER_REVIEW,
    "metadata.chapterNumber": Number(chapterNumber),
    $or: [
      { "metadata.chapterSuffix": "" },
      { "metadata.chapterSuffix": { $exists: false } },
      { "metadata.chapterSuffix": null },
    ],
  };

  return Message.findOne(query)
    .sort(sort)
    .select("content metadata")
    .lean();
};

/**
 * Chapter review message the writer inserted into the Revision Plan (pinned canonical copy).
 */
export const findInsertedEllisChapterReviewMessage = async ({
  threadId,
  chapterNumber,
  chapterId = null,
  savedMessageIds = [],
}) => {
  const ids = (savedMessageIds || []).filter(Boolean);
  if (!threadId || !ids.length) return null;

  const msgs = await Message.find({
    _id: { $in: ids },
    threadId,
    role: "assistant",
  })
    .select("content metadata")
    .lean();

  for (const msg of msgs) {
    if (messageMatchesEllisChapterReview(msg, chapterNumber, chapterId)) {
      return msg;
    }
  }
  return null;
};

/**
 * Resolve the canonical stored review to replay on redelivery / repeat kickoff.
 * Priority: inserted chat message → Revision Plan markdown → in-thread review
 * (chapterId first, then chapterNumber).
 */
export const resolveStoredEllisChapterReviewForRedelivery = async ({
  threadId,
  novelId,
  userId,
  chapterNumber,
  chapterId = null,
  chapterSuffix = "",
  savedMessageIds = [],
  redeliveryRequest = false,
}) => {
  const inserted = await findInsertedEllisChapterReviewMessage({
    threadId,
    chapterNumber,
    chapterId,
    savedMessageIds,
  });
  if (inserted?.content) return inserted;

  if (novelId && userId) {
    let planReview = null;
    if (chapterId) {
      planReview = await EllisChapterReview.findOne({
        novel: novelId,
        user: userId,
        chapterId,
        status: "ready",
      })
        .select("reviewMarkdown draftContentHash")
        .lean();
    }
    if (!planReview && Number.isFinite(Number(chapterNumber))) {
      const suffix = String(chapterSuffix || "");
      planReview = await EllisChapterReview.findOne({
        novel: novelId,
        user: userId,
        chapterNumber: Number(chapterNumber),
        chapterSuffix: suffix,
        status: "ready",
      })
        .select("reviewMarkdown draftContentHash")
        .lean();
    }
    const markdown = String(planReview?.reviewMarkdown || "").trim();
    if (markdown) {
      return {
        content: markdown,
        metadata: {
          source: "revision_plan",
          draftContentHash: planReview?.draftContentHash || null,
        },
      };
    }
  }

  if (!Number.isFinite(Number(chapterNumber)) && !chapterId) return null;

  const preferOldest = Boolean(redeliveryRequest);
  const withChapterId = chapterId
    ? await findStoredEllisChapterReview({
        threadId,
        chapterNumber,
        chapterId,
        preferOldest,
      })
    : null;
  if (withChapterId?.content) return withChapterId;

  if (!Number.isFinite(Number(chapterNumber))) return null;
  const relaxed = await findStoredEllisChapterReview({
    threadId,
    chapterNumber,
    chapterId: null,
    preferOldest,
  });
  if (relaxed?.content) return relaxed;

  return null;
};

/**
 * Latest insert-confirm assistant row (next open chapter hint after Revision Plan save).
 */
export const findLastEllisInsertConfirmHint = async (threadId) => {
  if (!threadId) return null;
  const msg = await Message.findOne({
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_INSERT_CONFIRM,
  })
    .sort({ timestamp: -1, _id: -1 })
    .select("metadata")
    .lean();

  const nextId = msg?.metadata?.nextChapterId
    ? String(msg.metadata.nextChapterId)
    : null;
  const nextNum = msg?.metadata?.nextChapterNumber;
  if (!nextId && !isEllisManuscriptChapterNumber(nextNum)) return null;
  return {
    chapterNumber: Number(msg.metadata.chapterNumber),
    chapterSuffix: normalizeChapterSuffix(msg.metadata.chapterSuffix),
    nextChapterNumber: isEllisManuscriptChapterNumber(nextNum)
      ? Number(nextNum)
      : null,
    nextChapterId: nextId,
    nextChapterSuffix: normalizeChapterSuffix(msg.metadata.nextChapterSuffix),
  };
};

/** True once the first-pass wrap-up insert-confirm has been posted in this thread. */
export const hasEllisFirstPassWrapUpPosted = async (threadId) => {
  if (!threadId) return false;
  const msg = await Message.findOne({
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_INSERT_CONFIRM,
    $or: [
      { "metadata.firstPassComplete": true },
      {
        content: {
          $regex: ELLIS_FIRST_PASS_WRAP_UP_SNIPPET,
          $options: "i",
        },
      },
    ],
  })
    .select("_id")
    .lean();
  return Boolean(msg);
};

/**
 * Most recent chapter Ellis reviewed in this thread (for sticky focus).
 * @returns {{ chapterNumber: number, chapterSuffix: string, chapterId: string|null } | null}
 */
export const findLastDiscussedEllisChapter = async (threadId) => {
  if (!threadId) return null;
  const msg = await Message.findOne({
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  })
    .sort({ timestamp: -1, _id: -1 })
    .select("metadata")
    .lean();

  const num = Number(msg?.metadata?.chapterNumber);
  if (!isEllisManuscriptChapterNumber(num)) return null;
  return {
    chapterNumber: num,
    chapterSuffix: "",
    chapterId: msg.metadata?.chapterId
      ? String(msg.metadata.chapterId)
      : null,
  };
};

/**
 * Chapters that already have a developmental review Message in this thread.
 */
export const listReviewedEllisChaptersInThread = async (threadId) => {
  if (!threadId) return [];
  const rows = await Message.find({
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  })
    .select("metadata")
    .lean();

  const byKey = new Map();
  for (const r of rows) {
    const num = Number(r.metadata?.chapterNumber);
    if (!isEllisManuscriptChapterNumber(num)) continue;
    const key = String(num);
    if (!byKey.has(key)) {
      byKey.set(key, { chapterNumber: num, chapterSuffix: "" });
    }
  }
  return [...byKey.values()].sort((a, b) => a.chapterNumber - b.chapterNumber);
};

/**
 * Resolve the single Ellis review unit row for a base chapter number.
 */
export const resolveEllisReviewUnit = ({
  userContents = [],
  chapterNumber = null,
  chapterId = null,
  chapterSuffix = null,
}) => {
  const distinct = getDistinctBaseChapterRows(userContents);
  const num = Number(chapterNumber);
  // A number named in the message wins over the FE's selected chapterId.
  // Otherwise "review chapter 6" while chapter 4 is open loads chapter 4.
  // Guard null: Number(null) is 0 (Prologue), which is a valid chapter.
  if (
    chapterNumber != null &&
    chapterNumber !== "" &&
    isEllisManuscriptChapterNumber(num)
  ) {
    const wantSuffix = normalizeChapterSuffix(chapterSuffix);
    if (wantSuffix) {
      const bySuffix = getUploadedChapterRows(userContents).find(
        (uc) =>
          Number(uc.chapterNumber ?? uc.sceneIndex) === num &&
          normalizeChapterSuffix(uc.chapterSuffix) === wantSuffix
      );
      if (bySuffix) return bySuffix;
    }

    // Label match wins over positional chapterNumber. Add Chapter renumbers
    // later rows' chapterNumber/sceneIndex on insert but never touches their
    // chapterLabel, so after inserting "1.5" the row literally labeled
    // "Chapter Two" holds chapterNumber 3, while chapterNumber 2 belongs to the
    // new "1.5" row. A writer asking for "chapter 2" means the labeled chapter,
    // not whatever row currently occupies that position — check the label
    // first so positional resolution only kicks in when no label matches.
    return (
      findChapterRowByNumericLabel(userContents, num) ||
      distinct.find((uc) => Number(uc.chapterNumber ?? uc.sceneIndex) === num) ||
      null
    );
  }
  if (chapterId) {
    // Archived ids must not remap onto a live neighbor that reused the number.
    const byId = getUploadedChapterRows(userContents).find(
      (uc) => String(uc._id) === String(chapterId)
    );
    if (byId?.chapterNumber != null) {
      const idNum = Number(byId.chapterNumber);
      return (
        distinct.find((uc) => Number(uc.chapterNumber) === idNum) || byId
      );
    }
  }
  return null;
};

/**
 * Parse the chapter number a label/title represents, whether written as
 * digits ("2", "Chapter 2.5") or words ("Chapter Two" — how the manuscript
 * parser actually labels uploaded chapters via numberToWords). Reuses the
 * same digit/word parsing chat input goes through, so "2" never matches a
 * "20" or "2.5" label — parseChapterRefFromRest's digit capture is greedy
 * and decimal-aware. Returns null for custom titles with no embedded number
 * (e.g. "The Betrayal").
 */
const extractChapterNumberFromLabel = (label) => {
  const raw = String(label || "").trim();
  if (!raw) return null;
  const rest = raw.replace(/^chapter\s+/i, "").trim();
  if (!rest) return null;

  let chapterNumber = null;
  let afterNumber = "";
  const digitMatch = rest.match(CHAPTER_DIGIT_TOKEN_RE);
  if (digitMatch && /^\d/.test(rest)) {
    const parsed = Number(digitMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      chapterNumber = parsed;
      afterNumber = digitMatch[2] || "";
    }
  } else {
    const wordParsed = parseWordChapterNumber(rest);
    if (wordParsed) {
      chapterNumber = wordParsed.number;
      afterNumber = wordParsed.remainder || "";
    }
  }
  if (chapterNumber == null) return null;

  const leftover = String(
    parseChapterLetterSuffix(afterNumber).remainder || ""
  ).trim();
  if (!leftover) return chapterNumber;
  // "Chapter 15 B — 1932" / "6 – POV: Myla" still count as that chapter.
  // "Six months later" does not.
  if (/^[-–—:|,]/.test(leftover)) return chapterNumber;
  return null;
};

/**
 * Match a chapter number (integer or decimal, e.g. 2, 1.5, 2.5) against a
 * row's chapterLabel/sceneTitle. Added chapters keep an integer
 * chapterNumber but a decimal label ("1.5", "Chapter 2.5"); renumbered
 * chapters keep their original label text even after their chapterNumber
 * shifts on insert. Matching the label first means "review chapter 1.5" and
 * "review chapter 2" both resolve to what the writer actually named, not
 * whatever row a later insert happened to leave at that position.
 */
export const findChapterRowByNumericLabel = (userContents = [], chapterNumber) => {
  const num = Number(chapterNumber);
  if (!Number.isFinite(num)) return null;
  const rows = getUploadedChapterRows(userContents);
  const byChapterLabel = rows.find(
    (uc) => extractChapterNumberFromLabel(uc.chapterLabel) === num
  );
  if (byChapterLabel) return byChapterLabel;
  // sceneTitle is a story title — only use it when chapterLabel is missing,
  // so "Six months later" on Chapter Four cannot steal "review chapter 6".
  return (
    rows.find(
      (uc) =>
        !String(uc.chapterLabel || "").trim() &&
        extractChapterNumberFromLabel(uc.sceneTitle) === num
    ) || null
  );
};

/**
 * Resolve a chapter row from a custom renamed title / label mentioned in chat
 * text (e.g. "Start The Betrayal", "what happens in Birthday Glass").
 * Matches chapterLabel and sceneTitle case-insensitively; prefers the longest
 * matching label to avoid short ambiguous hits.
 * @returns {object | null} UserContent-like row
 */
const GENERIC_CHAPTER_DIGIT_LABEL_RE = /^chapter\s+\d+(?:\.\d+)?$/i;
const GENERIC_CHAPTER_WORD_LABEL_RE =
  /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/i;

const stripLeadingChapterWord = (label) =>
  String(label || "")
    .trim()
    .replace(/^chapter\s+/i, "")
    .trim();

const escapeRegExp = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const resolveChapterFromLabel = (message, userContents = []) => {
  const raw = String(message || "").trim().toLowerCase();
  if (!raw || !userContents.length) return null;

  let best = null;
  let bestLen = 0;
  for (const uc of getUploadedChapterRows(userContents)) {
    for (const candidate of [uc.chapterLabel, uc.sceneTitle]) {
      const label = String(candidate || "").trim().toLowerCase();
      if (!label) continue;
      // Skip bare "Chapter N" / "Chapter {word}" only — numeric parsers cover those.
      // Lettered labels (Chapter Fifteen B, Chapter 15 B) and custom titles stay.
      if (GENERIC_CHAPTER_DIGIT_LABEL_RE.test(label)) continue;
      if (GENERIC_CHAPTER_WORD_LABEL_RE.test(label)) continue;

      const stripped = stripLeadingChapterWord(label);
      const variants = [...new Set([label, stripped].filter(Boolean))];
      for (const variant of variants) {
        let matched = false;
        if (variant.length >= 3) {
          matched = raw.includes(variant);
        } else if (variant.length >= 1) {
          // Short custom titles ("A"): only "chapter A", never a bare letter.
          matched = new RegExp(
            `\\bchapter\\s+${escapeRegExp(variant)}\\b`,
            "i"
          ).test(raw);
        }
        if (matched && variant.length > bestLen) {
          best = uc;
          bestLen = variant.length;
        }
      }
    }
  }
  return best;
};

/**
 * Chapter the writer named in this message: numeric/word refs first
 * ("Chapter 9", "Chapter nine"), then a custom title that actually appears
 * in the message. Live Ellis chat does not use this to pick a body —
 * Ellis loads named chapters via load_manuscript_chapters.
 * @returns {{ row: object, chapterNumber: number, chapterSuffix: string, namedBy: "number" | "label" } | null}
 */
export const resolveEllisNamedChapterFromMessage = (
  message,
  userContents = []
) => {
  const ref = parseEllisChapterRefFromMessage(message);
  if (isEllisManuscriptChapterNumber(ref?.chapterNumber)) {
    const row = resolveEllisReviewUnit({
      userContents,
      chapterNumber: ref.chapterNumber,
      chapterSuffix: ref.chapterSuffix,
    });
    if (row) {
      return {
        row,
        chapterNumber: Number(row.chapterNumber ?? row.sceneIndex),
        chapterSuffix: normalizeChapterSuffix(
          ref.chapterSuffix || row.chapterSuffix
        ),
        namedBy: "number",
      };
    }
  }

  const labeled = resolveChapterFromLabel(message, userContents);
  if (
    labeled &&
    isEllisManuscriptChapterNumber(labeled.chapterNumber ?? labeled.sceneIndex)
  ) {
    return {
      row: labeled,
      chapterNumber: Number(labeled.chapterNumber ?? labeled.sceneIndex),
      chapterSuffix: normalizeChapterSuffix(labeled.chapterSuffix),
      namedBy: "label",
    };
  }

  return null;
};

/**
 * Chapter whose manuscript text to load from the thread topic. Extra
 * named-chapter bodies come from load_manuscript_chapters.
 */
const rowFromEllisTopic = (userContents, topic) => {
  if (!topic) return null;
  if (topic.chapterId) {
    const byId = userContents.find(
      (uc) => String(uc._id) === String(topic.chapterId)
    );
    if (byId) return byId;
  }
  if (topic.chapterLabel) {
    const byLabel = resolveFocusedChapterRow({
      userContents,
      chapterLabel: topic.chapterLabel,
    });
    if (byLabel) return byLabel;
  }
  return resolveEllisReviewUnit({
    userContents,
    chapterNumber: topic.chapterNumber,
    chapterSuffix: topic.chapterSuffix,
    chapterId: topic.chapterId,
  });
};

export const resolveEllisConversationChapter = ({
  userContents = [],
  topicFromThread = null,
}) => rowFromEllisTopic(userContents, topicFromThread);

/**
 * Next base chapter row after the given chapter number.
 */
export const resolveNextEllisChapterRow = (
  userContents = [],
  chapterNumber,
  _chapterSuffix = null
) => {
  const distinct = getDistinctBaseChapterRows(userContents);
  if (!distinct.length || !Number.isFinite(Number(chapterNumber))) return null;
  const idx = distinct.findIndex(
    (uc) => Number(uc.chapterNumber ?? uc.sceneIndex) === Number(chapterNumber)
  );
  if (idx < 0 || idx >= distinct.length - 1) return null;
  return distinct[idx + 1];
};

/** Extra manuscript rows to inject as reference (named other chapter, then next map chapter). */
export const resolveEllisSupportingChapterRows = ({
  focusedChapter = null,
  namedChapterRow = null,
  userContents = [],
} = {}) => {
  const rows = [];
  const seen = new Set(
    focusedChapter?._id ? [String(focusedChapter._id)] : []
  );
  const push = (row) => {
    if (!row?._id) return;
    const id = String(row._id);
    if (seen.has(id)) return;
    seen.add(id);
    rows.push(row);
  };
  push(namedChapterRow);
  if (focusedChapter) {
    push(
      resolveNextEllisChapterRow(
        userContents,
        focusedChapter.chapterNumber ?? focusedChapter.sceneIndex,
        focusedChapter.chapterSuffix
      )
    );
  }
  return rows;
};

export const ELLIS_NEXT_MAP_CHAPTER_BANNER =
  "═══ FOLLOWING CHAPTER IN MANUSCRIPT ORDER (reference only — this is NOT the next open chapter unless DEVELOPMENTAL PASS PROGRESS names it) ═══";

export const ELLIS_REVISED_CHAPTER_BANNER =
  "═══ CURRENT MANUSCRIPT FOR A CHAPTER THAT ALREADY HAS NOTES (use only if the writer asked to review or look at this chapter — not a command, and not the next open chapter) ═══";

// ponytail: 2 extra ready-chapter bodies (changed draft, then Chapter One). Upgrade: Ellis fetches a named chapter on demand.
const ELLIS_REVISION_CANDIDATE_LIMIT = 2;

/**
 * Current drafts of chapters already in the Revision Plan, so a jump-back
 * ("I revised Chapter One") has manuscript text without parsing the writer.
 */
export const resolveEllisRevisionCandidateRows = ({
  userContents = [],
  readyReviews = [],
  focusedChapter = null,
  limit = ELLIS_REVISION_CANDIDATE_LIMIT,
} = {}) => {
  const focusedId = focusedChapter?._id ? String(focusedChapter._id) : null;
  const ranked = [];
  for (const row of getDistinctBaseChapterRows(userContents)) {
    if (focusedId && String(row._id) === focusedId) continue;
    const ready = findReadyReviewForChapter(readyReviews, {
      chapterId: row._id,
      chapterNumber: row.chapterNumber ?? row.sceneIndex,
      chapterSuffix: row.chapterSuffix,
    });
    if (!ready) continue;
    const currentHash = hashEllisChapterDraft(row.userContent);
    const storedHash = ready.draftContentHash
      ? String(ready.draftContentHash)
      : "";
    ranked.push({
      row,
      changed: Boolean(storedHash && currentHash !== storedHash),
      isOne: Number(row.chapterNumber ?? row.sceneIndex) === 1,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0,
    });
  }
  ranked.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    if (a.isOne !== b.isOne) return a.isOne ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return ranked.slice(0, limit).map((item) => item.row);
};

/**
 * Progress block for every Ellis turn — from in-thread reviews, not only inserts.
 */
export const buildEllisPassProgressBlock = ({
  userContents = [],
  reviewedChapters = [],
  readyChapterNumbers = null,
  focusedChapter = null,
  conversationChapter = null,
  lastReviewedChapter = null,
  firstPassAlreadyComplete = false,
  forConversationalTurn = false,
}) => {
  const ordered = getDistinctBaseChapterRows(
    [...userContents].filter(
      (uc) => uc.chapterNumber != null || uc.chapterLabel
    )
  );
  const total = ordered.length;
  if (!total) return "";

  const reviewedNumbers = new Set(
    reviewedChapters.map((r) => Number(r.chapterNumber)).filter(Number.isFinite)
  );
  const reviewedLabels = [...reviewedNumbers]
    .sort((a, b) => a - b)
    .map((num) => {
      const row = ordered.find((uc) => Number(uc.chapterNumber) === num);
      return row ? resolveChapterLabel(row) : `Chapter ${num}`;
    });

  let nextLabel = null;
  if (readyChapterNumbers != null) {
    const readySet =
      readyChapterNumbers instanceof Set
        ? readyChapterNumbers
        : new Set(readyChapterNumbers);
    const gapRow = resolveNextEllisOpenChapter(ordered, readySet);
    nextLabel = gapRow ? resolveChapterLabel(gapRow) : null;
  } else {
    for (const uc of ordered) {
      const num = Number(uc.chapterNumber ?? uc.sceneIndex);
      if (!reviewedNumbers.has(num)) {
        nextLabel = resolveChapterLabel(uc);
        break;
      }
    }
  }

  const allRevisionPlanComplete =
    readyChapterNumbers != null && nextLabel == null;

  const topicChapter = conversationChapter || focusedChapter;
  const lastOrdered = ordered[ordered.length - 1];
  const isOnFinalChapter =
    topicChapter &&
    lastOrdered &&
    chapterIdentityKey(
      topicChapter.chapterNumber ?? topicChapter.sceneIndex,
      topicChapter.chapterSuffix
    ) ===
      chapterIdentityKey(
        lastOrdered.chapterNumber || lastOrdered.sceneIndex,
        lastOrdered.chapterSuffix
      );

  const lines = [
    "DEVELOPMENTAL PASS PROGRESS (authoritative — do not invent completion status):",
    `- Manuscript chapters total: ${total}`,
    `- Chapters reviewed in this thread: ${
      reviewedLabels.length ? reviewedLabels.join(", ") : "none yet"
    } (${reviewedNumbers.size} of ${total})`,
  ];
  if (nextLabel) {
    lines.push(
      `- Next open chapter (authoritative — first chapter still needing a developmental pass): ${nextLabel}`
    );
    lines.push(
      `- If the writer asks "what is the next open chapter" / "what's next", answer with ${nextLabel} in one sentence. Do not skip ahead. Do not answer from a following-chapter reference body.`
    );
  } else if (allRevisionPlanComplete) {
    lines.push("- All manuscript chapters are in your Revision Plan.");
  } else {
    lines.push("- All manuscript chapters have a review in this thread.");
  }
  if (forConversationalTurn) {
    lines.push(
      "- Pass progress is internal only except when the writer asked. Do not volunteer or propose the next open chapter unless they asked which it is or asked to continue."
    );
  }

  if (topicChapter) {
    const conversationLabel = resolveChapterLabel(topicChapter);
    lines.push(
      `- Conversation chapter this turn (authoritative): ${conversationLabel}`
    );
    lines.push(
      `- If the writer asks to deliver / do the edit / run the pass this turn, that request is for ${conversationLabel} — not a stale next-open invite and not a different map-gap chapter.`
    );
  }

  lines.push(
    firstPassAlreadyComplete
      ? "- The first developmental-pass wrap-up already happened in this thread. Do NOT repeat the congratulations or say the edit is complete. Review any newly added chapters normally."
      : isOnFinalChapter
        ? "- This is the final chapter in the manuscript map. You may use the completion line only after finishing this chapter's review."
        : "- This is NOT the final chapter. Do NOT say the developmental pass is complete. Do NOT wrap up the edit."
  );
  return lines.join("\n");
};

/**
 * Parse a chapter number from user chat text (digits or word numbers).
 * Broader than kickoff-only parsing — includes review/focus phrasing.
 */
export const parseEllisChapterNumberFromMessage = (message) =>
  parseEllisChapterRefFromMessage(message)?.chapterNumber ?? null;

/** Parse route/param values like "7" or "7A". */
export const parseChapterRouteParam = (param) => {
  const m = String(param || "")
    .trim()
    .match(/^(\d{1,3}(?:\.\d+)?)([A-Za-z])?$/);
  if (!m) return null;
  return {
    chapterNumber: Number(m[1]),
    chapterSuffix: normalizeChapterSuffix(m[2]),
  };
};

export const buildNovelGenreContext = (novel) => {
  const parts = [];
  if (novel?.genre) parts.push(`Genre: ${novel.genre}`);
  if (novel?.subgenre) parts.push(`Subgenre: ${novel.subgenre}`);
  if (Array.isArray(novel?.compTitles) && novel.compTitles.length) {
    parts.push(`Comp titles: ${novel.compTitles.join("; ")}`);
  }
  return parts.length
    ? `\n\nMANUSCRIPT METADATA:\n${parts.join("\n")}`
    : "";
};

/**
 * Resolve the UserContent row for the chapter in focus.
 * Parsed chapter number (+ suffix) wins over chapterId when both are present.
 * Archived rows are never returned (Olivia-parity: Ellis cannot read them).
 */
export const resolveFocusedChapterRow = ({
  userContents = [],
  chapterId = null,
  chapterNumber = null,
  chapterSuffix = null,
  chapterLabel = null,
}) => {
  const ordered = getUploadedChapterRows(userContents);

  if (chapterLabel) {
    const labelNorm = String(chapterLabel).trim().toLowerCase();
    if (labelNorm) {
      const byLabel = ordered.find(
        (uc) =>
          String(uc.chapterLabel || uc.sceneTitle || "")
            .trim()
            .toLowerCase() === labelNorm
      );
      if (byLabel) return byLabel;
      const prefixHits = ordered.filter((uc) => {
        const key = String(uc.chapterLabel || uc.sceneTitle || "")
          .trim()
          .toLowerCase();
        return (
          key.startsWith(`${labelNorm} -`) ||
          key.startsWith(`${labelNorm} –`) ||
          key.startsWith(`${labelNorm} —`) ||
          key.startsWith(`${labelNorm}:`)
        );
      });
      if (prefixHits.length === 1) return prefixHits[0];
    }
  }

  const parsedNum =
    chapterNumber != null && Number.isFinite(Number(chapterNumber))
      ? Number(chapterNumber)
      : null;

  if (parsedNum != null) {
    const byBase = getDistinctBaseChapterRows(ordered).find(
      (uc) => Number(uc.chapterNumber ?? uc.sceneIndex) === parsedNum
    );
    if (byBase) return byBase;

    if (normalizeChapterSuffix(chapterSuffix)) return null;

    const bare = ordered.find(
      (uc) =>
        Number(uc.chapterNumber || uc.sceneIndex || 0) === parsedNum &&
        !normalizeChapterSuffix(uc.chapterSuffix)
    );
    if (bare) return bare;

    return (
      ordered.find(
        (uc) => Number(uc.chapterNumber || uc.sceneIndex || 0) === parsedNum
      ) || null
    );
  }

  if (chapterId) {
    return (
      ordered.find((uc) => String(uc._id) === String(chapterId)) || null
    );
  }

  return null;
};

export const buildEllisChapterHeading = (chapterRow) => {
  const chapterLabel = resolveChapterLabel(chapterRow);
  const pov = resolveEllisChapterPovName(chapterRow);
  return pov ? `${chapterLabel} – POV: ${pov}` : chapterLabel;
};

/** Scene inventory for one chapter row (used on Ellis kickoff). */
export const buildEllisChapterSceneDetection = (chapterRow) => {
  if (!chapterRow) return null;
  const chapterBody = stripChapterHtmlToText(chapterRow.userContent);
  if (!chapterBody.trim()) return null;
  const chapterNum = Number(
    chapterRow.chapterNumber ?? chapterRow.sceneIndex
  );
  const chapterLabel = resolveChapterLabel(chapterRow);
  return detectChapterScenes(chapterBody, chapterNum, chapterLabel);
};

/** POV name for review openers: stored metadata, then a POV line in the chapter text. */
export const resolveEllisChapterPovName = (chapterRow) => {
  const stored = String(chapterRow?.pov || "").trim();
  if (stored) return stored;
  const chapterBody = stripChapterHtmlToText(chapterRow?.userContent);
  const fromText = extractScenePov(chapterBody);
  if (fromText) return fromText;
  const detection = buildEllisChapterSceneDetection(chapterRow);
  const fromScene = detection?.scenes?.find((scene) =>
    String(scene?.pov || "").trim()
  )?.pov;
  return String(fromScene || "").trim();
};

/**
 * Ephemeral user-role block: full chapter text for the model (not persisted).
 * Default banner is reference-only; the writer's message decides kickoff vs Q&A.
 * @param {object} options
 * @param {string} [options.banner] - Section banner. Defaults to reference
 *   framing. Pass a distinct banner for a secondary, referenced-only chapter.
 */
export const buildEllisChapterEphemeralBlock = (chapterRow, options = {}) => {
  if (!chapterRow) return null;
  const chapterBody = stripChapterHtmlToText(chapterRow.userContent);
  if (!chapterBody.trim()) return null;

  const heading = buildEllisChapterHeading(chapterRow);
  const chapterLabel = resolveChapterLabel(chapterRow);
  const sceneTitleHint =
    chapterRow.sceneTitle &&
    chapterRow.sceneTitle.trim() !== chapterLabel.trim()
      ? `Scene title: ${chapterRow.sceneTitle.trim()}\n\n`
      : "";

  const sceneDetection =
    options.sceneDetection || buildEllisChapterSceneDetection(chapterRow);
  const sceneInventoryBlock = buildEllisChapterSceneInventoryBlock(
    sceneDetection
  );
  const multiSceneReminder = buildEllisMultiSceneKickoffReminder(sceneDetection);

  const banner = options.banner || ELLIS_CHAPTER_REFERENCE_BANNER;

  return {
    role: "user",
    content: [
      banner,
      heading,
      "",
      sceneInventoryBlock ? `${sceneInventoryBlock}\n\n` : "",
      multiSceneReminder ? `${multiSceneReminder.trim()}\n\n` : "",
      sceneTitleHint + chapterBody,
    ].join("\n"),
  };
};

export const buildPriorSavedNotesContext = async ({
  novelId,
  userId,
  chapterNum,
  chapterSuffix = null,
  userContents = null,
}) => {
  if (!Number.isFinite(chapterNum)) return "";

  let priorReviews;
  if (Array.isArray(userContents) && userContents.length) {
    const ordered = sortChapterRows(userContents);
    const wantKey = chapterIdentityKey(chapterNum, chapterSuffix);
    const idx = ordered.findIndex(
      (uc) =>
        chapterIdentityKey(
          uc.chapterNumber || uc.sceneIndex || 0,
          uc.chapterSuffix
        ) === wantKey
    );
    const priorOrdered = idx > 0 ? ordered.slice(0, idx) : [];
    const priorKeys = priorOrdered.map((uc) =>
      chapterProgressKey(uc.chapterNumber, uc.chapterSuffix)
    );
    const priorKeySet = new Set(priorKeys);
    const allReady = await EllisChapterReview.find({
      novel: novelId,
      user: userId,
      status: "ready",
    })
      .select("chapterNumber chapterSuffix chapterLabel cumulativeNote")
      .lean();
    priorReviews = allReady
      .filter((r) =>
        priorKeySet.has(chapterProgressKey(r.chapterNumber, r.chapterSuffix))
      )
      .sort((a, b) => {
        const ia = priorKeys.indexOf(
          chapterProgressKey(a.chapterNumber, a.chapterSuffix)
        );
        const ib = priorKeys.indexOf(
          chapterProgressKey(b.chapterNumber, b.chapterSuffix)
        );
        return ia - ib;
      });
  } else {
    priorReviews = await EllisChapterReview.find({
      novel: novelId,
      user: userId,
      status: "ready",
      chapterNumber: { $lt: chapterNum },
    })
      .select("chapterNumber chapterSuffix chapterLabel cumulativeNote")
      .sort({ chapterNumber: 1, chapterSuffix: 1 })
      .lean();
  }

  if (!priorReviews.length) return "";

  return `\n\nCUMULATIVE NOTES FROM EARLIER CHAPTERS (for continuity — do not repeat, build on them):\n${priorReviews
    .map(
      (r) =>
        `- ${r.chapterLabel || `Chapter ${r.chapterNumber}`}: ${
          r.cumulativeNote || "(no note)"
        }`
    )
    .join("\n")}`;
};

const truncateReviewExcerpt = (text, maxChars) => {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const sliceEnd = trimmed.lastIndexOf(" ", maxChars);
  const cutAt = sliceEnd > 0 ? sliceEnd : maxChars;
  return `${trimmed.slice(0, cutAt)}\n\n(Prior review truncated for context limits.)`;
};

/** Latest in-thread review for this chapter (follow-up continuity). */
export const buildEllisPriorReviewBlock = async ({
  threadId,
  chapterNumber,
  chapterSuffix = null,
  chapterId = null,
}) => {
  if (!threadId || !Number.isFinite(Number(chapterNumber))) return "";

  const query = {
    threadId,
    role: "assistant",
    "metadata.kind": ELLIS_METADATA_KIND_CHAPTER_REVIEW,
    "metadata.chapterNumber": Number(chapterNumber),
  };
  const suf = normalizeChapterSuffix(chapterSuffix);
  if (suf) {
    query["metadata.chapterSuffix"] = suf;
  } else if (chapterId) {
    query["metadata.chapterId"] = String(chapterId);
  }

  const msg = await Message.findOne(query)
    .sort({ timestamp: -1, _id: -1 })
    .select("content")
    .lean();

  const content = String(msg?.content || "").trim();
  if (!content) return "";

  const excerpt = truncateReviewExcerpt(
    content,
    ELLIS_PRIOR_REVIEW_EXCERPT_MAX_CHARS
  );

  return [
    "PRIOR DEVELOPMENTAL REVIEW FOR THIS CHAPTER (for follow-up continuity):",
    excerpt,
  ].join("\n\n");
};

/**
 * Canonical first-pass notes for a chapter that already has a review.
 * When this is present, a review/start/yes kickoff is a revision check,
 * not a new Output Standard.
 */
export const buildEllisOriginalPlanBlock = ({
  chapterLabel = "",
  reviewMarkdown = "",
} = {}) => {
  const markdown = String(reviewMarkdown || "").trim();
  if (!markdown) return "";
  const label = String(chapterLabel || "this chapter").trim();
  return [
    `ORIGINAL CHAPTER EDITS / REVISION PLAN FOR ${label} (internal: evaluate the CURRENT manuscript against these notes. Do not deliver a new Output Standard. Never announce "revision check," "first pass," or REVISION REVIEW MODE to the writer.):`,
    markdown,
  ].join("\n\n");
};

export const findReadyReviewForChapter = (
  reviews = [],
  { chapterId = null, chapterNumber = null, chapterSuffix = null } = {}
) => {
  if (chapterId) {
    const byId = reviews.find(
      (r) => String(r.chapterId || "") === String(chapterId)
    );
    if (byId) return byId;
  }
  if (!isEllisManuscriptChapterNumber(chapterNumber)) return null;
  const suf = normalizeChapterSuffix(chapterSuffix);
  return (
    reviews.find(
      (r) =>
        Number(r.chapterNumber) === Number(chapterNumber) &&
        normalizeChapterSuffix(r.chapterSuffix) === suf
    ) || null
  );
};

/**
 * System-role supplement block: letter, map, adjacent, saved notes, prior review, progress.
 */
export const buildEllisSupplementBlock = ({
  novel,
  userContents = [],
  focusedChapter = null,
  priorSavedNotesContext = "",
  priorThreadReviewBlock = "",
  passProgressBlock = "",
  originalPlanBlock = "",
}) => {
  const parts = [];

  if (passProgressBlock?.trim()) {
    parts.push(passProgressBlock.trim());
  }

  if (originalPlanBlock?.trim()) {
    parts.push(originalPlanBlock.trim());
  }

  if (novel?.editorialLetter && novel.editorialLetterStatus === "ready") {
    parts.push(
      `GLOBAL EDITORIAL LETTER (Phase 1 context — keep scene notes consistent with it):\n${novel.editorialLetter}`
    );
  }

  const manuscriptMap = buildManuscriptMapContext(userContents);
  if (manuscriptMap) {
    parts.push(
      `MANUSCRIPT MAP (chapter order, POV, timeline, functional beats). Each row has a chapterId. The writer may refer to a chapter by any short form of its map title — you decide which row they mean. If that chapter's body is not already in this turn, call load_manuscript_chapters with its chapterId before you answer or review. Do not say you lack the manuscript until the tool returns nothing for that id.\n${manuscriptMap}`
    );
  }

  if (priorSavedNotesContext?.trim()) {
    parts.push(priorSavedNotesContext.trim());
  }

  if (focusedChapter?.chapterNumber != null) {
    const ordered = sortChapterRows(userContents);
    const adjacent = buildAdjacentChapterContext(
      ordered,
      Number(focusedChapter.chapterNumber ?? focusedChapter.sceneIndex),
      focusedChapter.chapterSuffix
    );
    if (adjacent?.trim()) {
      parts.push(adjacent.trim());
    }
  }

  if (priorThreadReviewBlock?.trim()) {
    parts.push(priorThreadReviewBlock.trim());
  }

  const body = parts.filter(Boolean).join("\n\n");
  if (!body) return null;
  return { role: "system", content: body };
};

const loadSceneArchitectBasePrompt = async () => {
  const basePrompt = await loadAgentPromptFromDb("ellis_scene_architect");
  return stripEllisOutputAdapter(basePrompt);
};

/**
 * Assemble instructions, supplements, and ephemeral chapter for one Ellis chat turn.
 * Kickoff vs conversation vs revision stay on ellis-scene-architect (INTENT
 * DETECTION). This assembler injects the thread-topic chapter (and the next map
 * chapter as reference) as facts only. Named-chapter bodies the writer asked
 * for this turn come from load_manuscript_chapters — Ellis picks the map row.
 */
export const buildEllisChatTurnContext = async ({
  novel,
  userId,
  novelId,
  threadId,
}) => {
  const userContents = await UserContent.find({ novelId, user: userId })
    .select(
      "userContent sceneTitle sceneIndex chapterNumber chapterSuffix chapterLabel pov timeline chapterSummary archivedAt updatedAt"
    )
    .sort({ createdAt: 1 })
    .lean();

  const lastDiscussed = await findLastDiscussedEllisChapter(threadId);

  const readyReviews = await EllisChapterReview.find({
    novel: novelId,
    user: userId,
    status: "ready",
  })
    .select("chapterNumber chapterSuffix status chapterId reviewMarkdown draftContentHash")
    .lean();
  const readyChapterNumbers = collectReadyChapterNumbers(
    readyReviews,
    userContents
  );

  const recentMessages = threadId
    ? await Message.find({ threadId })
        .sort({ timestamp: -1, _id: -1 })
        .limit(12)
        .select("role content metadata")
        .lean()
    : [];
  const topicFromThread = resolveEllisTopicChapterFromMessages(
    recentMessages,
    { limit: 12 }
  );
  const focusedChapter = resolveEllisConversationChapter({
    userContents,
    topicFromThread,
  });

  const resolvedChapterId = focusedChapter ? String(focusedChapter._id) : null;
  const chapterNum = focusedChapter
    ? Number(focusedChapter.chapterNumber ?? focusedChapter.sceneIndex)
    : null;
  const chapterSuf = normalizeChapterSuffix(focusedChapter?.chapterSuffix);
  const userMessageMetadata = focusedChapter
    ? {
        chapterId: resolvedChapterId,
        chapterNumber: chapterNum,
        chapterSuffix: chapterSuf,
      }
    : null;

  const reviewedChapters = await listReviewedEllisChaptersInThread(threadId);
  const firstPassAlreadyComplete = await hasEllisFirstPassWrapUpPosted(threadId);
  const passProgressBlock = buildEllisPassProgressBlock({
    userContents,
    reviewedChapters,
    readyChapterNumbers,
    focusedChapter,
    conversationChapter: focusedChapter,
    lastReviewedChapter: lastDiscussed,
    firstPassAlreadyComplete,
    forConversationalTurn: true,
  });

  const distinctChapters = getDistinctBaseChapterRows(userContents);
  const lastRow = distinctChapters[distinctChapters.length - 1];
  const isFinalChapter =
    focusedChapter &&
    lastRow &&
    Number(focusedChapter.chapterNumber ?? focusedChapter.sceneIndex) ===
      Number(lastRow.chapterNumber ?? lastRow.sceneIndex);

  const basePrompt = await loadSceneArchitectBasePrompt();
  const genreContext = buildNovelGenreContext(novel);
  const sceneDetection = focusedChapter
    ? buildEllisChapterSceneDetection(focusedChapter)
    : null;

  const instructions = `${basePrompt}${genreContext}

CHAPTER TEXT LOADING:
The writer may refer to a chapter by any short form of a MANUSCRIPT MAP title (for example "Emon Work" for a row titled "Emon Work - September 1936 - California"). You decide which row they mean. If that chapter's body is not already in this turn, call load_manuscript_chapters with that row's chapterId before you answer or review. Never say you lack the manuscript until that tool returns nothing for that id.`;

  let priorSavedNotesContext = "";
  if (Number.isFinite(chapterNum)) {
    priorSavedNotesContext = await buildPriorSavedNotesContext({
      novelId,
      userId,
      chapterNum,
      chapterSuffix: chapterSuf,
      userContents,
    });
  }

  let priorThreadReviewBlock = "";
  if (focusedChapter && Number.isFinite(chapterNum)) {
    priorThreadReviewBlock = await buildEllisPriorReviewBlock({
      threadId,
      chapterNumber: chapterNum,
      chapterSuffix: chapterSuf,
      chapterId: resolvedChapterId,
    });
  }

  const readyForFocus = findReadyReviewForChapter(readyReviews, {
    chapterId: resolvedChapterId,
    chapterNumber: chapterNum,
    chapterSuffix: chapterSuf,
  });
  const originalPlanSource =
    String(readyForFocus?.reviewMarkdown || "").trim() ||
    (priorThreadReviewBlock
      ? priorThreadReviewBlock.replace(
          /^PRIOR DEVELOPMENTAL REVIEW FOR THIS CHAPTER \(for follow-up continuity\):\s*/i,
          ""
        )
      : "");
  const revisionRows = resolveEllisRevisionCandidateRows({
    userContents,
    readyReviews,
    focusedChapter,
  });
  const originalPlanBlock = [
    buildEllisOriginalPlanBlock({
      chapterLabel: focusedChapter ? resolveChapterLabel(focusedChapter) : "",
      reviewMarkdown: originalPlanSource,
    }),
    ...revisionRows.map((row) =>
      buildEllisOriginalPlanBlock({
        chapterLabel: resolveChapterLabel(row),
        reviewMarkdown: findReadyReviewForChapter(readyReviews, {
          chapterId: row._id,
          chapterNumber: row.chapterNumber ?? row.sceneIndex,
          chapterSuffix: row.chapterSuffix,
        })?.reviewMarkdown,
      })
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  // Don't send the same first-pass twice when it is already the original plan.
  if (originalPlanBlock && priorThreadReviewBlock) {
    priorThreadReviewBlock = "";
  }

  const supplementBlockMessage = buildEllisSupplementBlock({
    novel,
    userContents,
    focusedChapter,
    priorSavedNotesContext,
    priorThreadReviewBlock,
    passProgressBlock,
    originalPlanBlock,
  });

  const chapterEphemeral = buildEllisChapterEphemeralBlock(focusedChapter, {
    sceneDetection,
  });

  const supportingEphemeral = resolveEllisSupportingChapterRows({
    focusedChapter,
    namedChapterRow: null,
    userContents,
  }).map((row) =>
    buildEllisChapterEphemeralBlock(row, {
      banner: ELLIS_NEXT_MAP_CHAPTER_BANNER,
    })
  );

  const revisionEphemeral = revisionRows.map((row) =>
    buildEllisChapterEphemeralBlock(row, {
      banner: ELLIS_REVISED_CHAPTER_BANNER,
    })
  );

  const ephemeralModelContext = [
    chapterEphemeral,
    ...supportingEphemeral,
    ...revisionEphemeral,
  ].filter(Boolean);

  return {
    focusedChapter,
    instructions,
    supplementBlockMessage,
    ephemeralModelContext,
    resolvedChapterId,
    isFinalChapter: Boolean(isFinalChapter),
    hasOriginalPlan: Boolean(originalPlanBlock),
    currentDraftHash: focusedChapter
      ? hashEllisChapterDraft(focusedChapter.userContent)
      : null,
    userContents,
    readyReviews,
    userMessageMetadata,
  };
};

