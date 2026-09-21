import Novel from "../models/novelModel.js";
import UserContent from "../models/userContentModel.js";
import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import { parseJSONResponse } from "./openaiService.js";
import { stripEllisOutputAdapter } from "../utils/reviewPrompts/ellisPromptUtils.js";
import { loadAgentPromptFromDb } from "../utils/loadAgentPrompt.js";
import { stripChapterHtmlToText } from "../utils/manuscriptText.js";
import {
  sortChapterRows,
  resolveChapterLabel,
  buildManuscriptMapContext,
  buildAdjacentChapterContext,
} from "./ellisManuscriptContext.js";
import {
  resolveFocusedChapterRow,
  buildEllisChapterEphemeralBlock,
  buildEllisChapterHeading,
  buildNovelGenreContext,
  buildPriorSavedNotesContext,
  parseEllisReviewBaseChapterFromContent,
  parseEllisReviewSectionLabelFromContent,
  parseEllisReviewSectionLabelFromHeader,
  buildEllisChapterSceneDetection,
  resolveEllisChapterPovName,
  resolveEllisReviewUnit,
  parseChapterRefFromRest,
} from "./ellisDynamicContext.js";
import {
  buildEllisChapterSceneInventoryBlock,
  buildEllisMultiSceneKickoffReminder,
} from "../utils/ellisChapterSceneDetection.js";
import {
  normalizeChapterSuffix,
  chapterProgressKey,
} from "../utils/manuscriptParser.js";
import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";
import {
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_CONVERSATIONAL,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
  textHasEllisRevisionCheckFooter,
} from "../constants/ellisUiMessages.js";
import { isEllisManuscriptChapterNumber } from "./ellisManuscriptContext.js";

export {
  sortChapterRows,
  resolveChapterLabel,
  buildManuscriptMapContext,
  buildAdjacentChapterContext,
  getDistinctBaseChapterRows,
  collectReadyChapterNumbers,
  isEllisBackfillInsert,
  resolveNextEllisOpenChapter,
  resolveEllisAdvanceTargetChapter,
  isEllisManuscriptChapterNumber,
} from "./ellisManuscriptContext.js";

export { buildNovelGenreContext, buildPriorSavedNotesContext } from "./ellisDynamicContext.js";

const normalizeChapterTitleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^chapter\s+/, "");

const chapterTitleKeys = (uc) =>
  [uc.chapterLabel, uc.sceneTitle]
    .filter(Boolean)
    .map((x) => normalizeChapterTitleKey(x));

const isPrefixChapterTitle = (key, norm) =>
  key.startsWith(`${norm} -`) ||
  key.startsWith(`${norm} –`) ||
  key.startsWith(`${norm} —`) ||
  key.startsWith(`${norm}:`);

const findChapterRefByLabel = (userContents = [], label) => {
  const norm = normalizeChapterTitleKey(label);
  if (!norm || !userContents.length) return null;

  const rows = getUploadedChapterRows(userContents);
  const exact = rows.find((uc) => chapterTitleKeys(uc).includes(norm));
  const prefixHits =
    !exact && norm.length >= 3
      ? rows.filter((uc) =>
          chapterTitleKeys(uc).some((key) => isPrefixChapterTitle(key, norm))
        )
      : [];
  const row = exact || (prefixHits.length === 1 ? prefixHits[0] : null);
  if (!row || !isEllisManuscriptChapterNumber(row.chapterNumber)) return null;

  return {
    chapterNumber: Number(row.chapterNumber),
    chapterSuffix: normalizeChapterSuffix(row.chapterSuffix) || "",
  };
};

/** First review-opener line title, minus trailing scene letter and " – POV:". */
const extractReviewOpenerTitle = (text) => {
  const line = String(text || "")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const cleaned = line.replace(
    /\s+\*{0,2}(?:Function in Story|Genre Beat Check|Scene Analysis|Creative Suggestions)\b.*$/i,
    ""
  );
  const withoutPov = cleaned.replace(/\s*[–—-]\s*POV\s*:.*$/i, "").trim();
  if (!withoutPov) return null;
  return withoutPov.replace(/\s+[A-Za-z]$/, "").trim() || withoutPov;
};

/** Map a parsed chapter token onto the manuscript row's integer chapterNumber. */
const canonicalizeSavedChapterRef = (ref, userContents = []) => {
  if (!ref || !isEllisManuscriptChapterNumber(ref.chapterNumber)) return ref;
  if (!userContents.length) return ref;
  const row = resolveEllisReviewUnit({
    userContents,
    chapterNumber: ref.chapterNumber,
    chapterSuffix: ref.chapterSuffix,
  });
  if (!row) return ref;
  return {
    chapterNumber: Number(row.chapterNumber ?? row.sceneIndex),
    chapterSuffix: normalizeChapterSuffix(row.chapterSuffix) || "",
  };
};

/**
 * Resolve chapter number + suffix when saving a chat review to Revision Plan.
 * Review header text wins (the review body names its chapter), then kickoff
 * metadata, then the client-supplied chapterNumber. Decimal / custom titles
 * ("1.5", "Chapter 1.5") are mapped onto the added chapter's integer id so
 * Chapter Edits can load them by UserContent.chapterNumber.
 * @returns {{ chapterNumber: number, chapterSuffix: string } | null}
 */
export const resolveEllisSavedReviewChapterRef = ({
  messageMetadata = null,
  messageContent = "",
  requestedChapterNumber = null,
  requestedChapterSuffix: _requestedChapterSuffix = null,
  userContents = [],
}) => {
  // A standalone section (Prologue, Epilogue, …) is identified by its own header
  // line and must win over any "Chapter N" mentioned inside the section's prose,
  // otherwise a Prologue review that references "Chapter One" is filed as ch. 1.
  const headerSectionLabel =
    parseEllisReviewSectionLabelFromHeader(messageContent);
  if (headerSectionLabel) {
    const byHeaderSection = findChapterRefByLabel(
      userContents,
      headerSectionLabel
    );
    if (byHeaderSection) return byHeaderSection;
  }

  const openerTitle = extractReviewOpenerTitle(messageContent);
  if (openerTitle) {
    const byOpener = findChapterRefByLabel(userContents, openerTitle);
    if (byOpener) return byOpener;
  }

  const contentRef = parseEllisReviewBaseChapterFromContent(messageContent);
  if (contentRef) {
    return canonicalizeSavedChapterRef(contentRef, userContents);
  }

  const sectionLabel = parseEllisReviewSectionLabelFromContent(messageContent);
  if (sectionLabel) {
    const bySection = findChapterRefByLabel(userContents, sectionLabel);
    if (bySection) return bySection;
  }

  const metaNum = Number(messageMetadata?.chapterNumber);
  if (
    (messageMetadata?.kind === ELLIS_METADATA_KIND_CHAPTER_REVIEW ||
      messageMetadata?.kind === ELLIS_METADATA_KIND_REVISION_REVIEW) &&
    isEllisManuscriptChapterNumber(metaNum)
  ) {
    const metaRef = {
      chapterNumber: metaNum,
      chapterSuffix: "",
    };
    if (messageMetadata?.chapterId) {
      const byId = resolveEllisReviewUnit({
        userContents,
        chapterId: messageMetadata.chapterId,
      });
      if (byId) {
        return {
          chapterNumber: Number(byId.chapterNumber ?? byId.sceneIndex),
          chapterSuffix: normalizeChapterSuffix(byId.chapterSuffix) || "",
        };
      }
    }
    return canonicalizeSavedChapterRef(metaRef, userContents);
  }

  const requested = Number(requestedChapterNumber);
  if (isEllisManuscriptChapterNumber(requested)) {
    return canonicalizeSavedChapterRef(
      { chapterNumber: requested, chapterSuffix: "" },
      userContents
    );
  }

  return null;
};

/** @deprecated Prefer resolveEllisSavedReviewChapterRef */
export const resolveEllisSavedReviewChapterNumber = (args) =>
  resolveEllisSavedReviewChapterRef(args)?.chapterNumber ?? null;

/** Strict JSON schema for one chapter's structured Scene Architect review. */
export const ELLIS_CHAPTER_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          title: { type: "string" },
          firstLine: { type: "string" },
          functionInStory: { type: "string" },
          genreBeatCheck: { type: "string" },
          structureVerdict: {
            type: "string",
            enum: ["Keep", "Tighten", "Rewrite", "Move", "Cut"],
          },
          characterVerdict: {
            type: "string",
            enum: ["Keep", "Keep as-is", "Deepen", "Rework"],
          },
          sceneAnalysis: { type: "string" },
          creativeSuggestions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                category: { type: "string", enum: ["structure", "character"] },
                weakness: { type: "string" },
                suggestionName: { type: "string" },
                description: { type: "string" },
                examples: { type: "array", items: { type: "string" } },
              },
              required: [
                "category",
                "weakness",
                "suggestionName",
                "description",
                "examples",
              ],
            },
          },
        },
        required: [
          "label",
          "title",
          "firstLine",
          "functionInStory",
          "genreBeatCheck",
          "structureVerdict",
          "characterVerdict",
          "sceneAnalysis",
          "creativeSuggestions",
        ],
      },
    },
    cumulativeNote: { type: "string" },
  },
  required: ["scenes", "cumulativeNote"],
};

const loadSceneArchitectBasePrompt = async () => {
  const basePrompt = await loadAgentPromptFromDb("ellis_scene_architect");
  return stripEllisOutputAdapter(basePrompt);
};

/**
 * Assemble instructions + user input for a structured chapter review.
 * Includes the JSON output adapter (do not strip).
 */
export const buildEllisChapterReviewPayload = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = null,
  chapterId = null,
}) => {
  const chapterNum = Number(chapterNumber);
  if (!Number.isFinite(chapterNum)) {
    throw new Error("Valid chapterNumber is required");
  }
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);

  const novel = await Novel.findOne({ _id: novelId, user: userId })
    .select(
      "editorialLetter editorialLetterStatus genre subgenre compTitles"
    )
    .lean();
  if (!novel) throw new Error("Novel not found");

  if (novel.editorialLetterStatus !== "ready") {
    const err = new Error(
      "Ellis is finishing your editorial letter before scene-by-scene edits."
    );
    err.statusCode = 403;
    throw err;
  }

  const userContents = await UserContent.find({ novelId, user: userId })
    .select(
      "userContent sceneTitle sceneIndex chapterNumber chapterSuffix chapterLabel pov timeline chapterSummary archivedAt"
    )
    .sort({ createdAt: 1 })
    .lean();

  const chapterRow = resolveFocusedChapterRow({
    userContents,
    chapterId,
    chapterNumber: chapterNum,
    chapterSuffix: chapterSuf,
  });

  if (!chapterRow) {
    throw new Error(`Chapter ${chapterNum} not found in this manuscript.`);
  }

  const chapterLabel = resolveChapterLabel(chapterRow);
  const chapterEphemeral = buildEllisChapterEphemeralBlock(chapterRow);
  const chapterBody = stripChapterHtmlToText(chapterRow.userContent);
  if (!chapterEphemeral || !chapterBody.trim()) {
    const err = new Error(
      `${chapterLabel} doesn't have any draft content yet. Write or paste your chapter in the editor, then ask Ellis to review it.`
    );
    err.statusCode = 400;
    throw err;
  }

  const pov = resolveEllisChapterPovName(chapterRow) || null;
  const basePrompt = await loadSceneArchitectBasePrompt();

  const manuscriptMap = buildManuscriptMapContext(userContents);
  const manuscriptMapContext = manuscriptMap
    ? `\n\nMANUSCRIPT MAP (chapter order, POV, timeline, functional beats):\n${manuscriptMap}`
    : "";

  const genreContext = buildNovelGenreContext(novel);
  const ordered = sortChapterRows(userContents);
  const adjacentContext = buildAdjacentChapterContext(
    ordered,
    chapterNum,
    ""
  );

  const priorNotesContext = await buildPriorSavedNotesContext({
    novelId,
    userId,
    chapterNum,
    chapterSuffix: "",
    userContents,
  });

  const editorialLetterContext =
    novel.editorialLetter && novel.editorialLetterStatus === "ready"
      ? `\n\nGLOBAL EDITORIAL LETTER (keep your scene notes consistent with it):\n${novel.editorialLetter}`
      : "";

  const instructions = `${basePrompt}${genreContext}${editorialLetterContext}${manuscriptMapContext}${priorNotesContext}${adjacentContext}`;

  const chapterHeading = buildEllisChapterHeading(chapterRow);
  const sceneTitleHint =
    chapterRow.sceneTitle &&
    chapterRow.sceneTitle.trim() !== chapterLabel.trim()
      ? `Scene title: ${chapterRow.sceneTitle.trim()}\n\n`
      : "";

  const sceneDetection = buildEllisChapterSceneDetection(chapterRow);
  const sceneInventoryBlock = buildEllisChapterSceneInventoryBlock(
    sceneDetection
  );
  const multiSceneReminder = buildEllisMultiSceneKickoffReminder(sceneDetection);

  const openerFormat = /POV\s*:/i.test(chapterHeading)
    ? chapterHeading
    : `${chapterLabel} – POV: [Character Name]`;
  const userInput = `Produce the structured Scene Architect review for the following chapter only. When labeling scenes, use this chapter's exact title "${chapterLabel}" in the scene opener — do not rewrite it to "Chapter ${chapterNum}" or a spelled-out chapter number. Scene opener format: ${openerFormat}. Never omit the POV suffix. Scene letters A, B, C are in-review scene tags only — not separate manuscript chapters. For a single-scene chapter, label the scene "${openerFormat}". For multi-scene chapters, label scenes sequentially "${chapterLabel} A", "${chapterLabel} B", "${chapterLabel} C", and so on (space before the letter), each with – POV: [Character Name] — untagged openings are scene A; renumber manuscript sub-headers to follow in order. Deliver one Chapter Cumulative Editorial Note for the whole chapter after all scenes.${multiSceneReminder}

${sceneInventoryBlock ? `${sceneInventoryBlock}\n\n` : ""}${chapterHeading}

${sceneTitleHint}${chapterBody}`;

  return {
    instructions,
    userInput,
    chapterNum,
    chapterSuffix: "",
    chapterLabel,
    pov,
    chapterId: String(chapterRow._id),
    chapterRow,
  };
};

/** Minimum length for a saved chapter review markdown body. */
const MIN_REVIEW_MARKDOWN_LENGTH = 400;

/**
 * Scene Architect section headers as they appear in a real Output Standard:
 * each block leads with the label on its own line (optionally prefixed by
 * markdown ### / ** or the section emoji). Prose that merely name-drops
 * "your Scene Analysis" mid-sentence is NOT a header and will not match, so
 * this separates a real pass from conversation that cites the label names.
 */
const ELLIS_REVIEW_HEADER_LINE_PREFIX =
  "^[ \\t]*(?:[-*•][ \\t]+)?(?:#{1,6}[ \\t]*)?\\*{0,2}[ \\t]*";

const ELLIS_REVIEW_HEADER_MARKERS = {
  functionInStory: new RegExp(
    `${ELLIS_REVIEW_HEADER_LINE_PREFIX}Function in Story\\b`,
    "im"
  ),
  genreBeatCheck: new RegExp(
    `${ELLIS_REVIEW_HEADER_LINE_PREFIX}Genre Beat Check\\b`,
    "im"
  ),
  sceneAnalysis: new RegExp(
    `${ELLIS_REVIEW_HEADER_LINE_PREFIX}(?:🔍[ \\t]*)?Scene Analysis\\b`,
    "im"
  ),
  creativeSuggestions: new RegExp(
    `${ELLIS_REVIEW_HEADER_LINE_PREFIX}(?:🎨[ \\t]*)?Creative Suggestions?\\b`,
    "im"
  ),
};

const ELLIS_REVIEW_SECTION_HEADER_NAMES =
  "(?:🔍\\s*|🎨\\s*|📌\\s*)?(?:Function in Story|Genre Beat Check|Scene Analysis|Creative Suggestions|Chapter Cumulative Editorial Note)";

/**
 * Long custom openers often glue the first section onto the same line
 * (`Epilogue - September 1936 – POV: Myla Function in Story: …`). Lift those
 * headers so detection sees real section lines, not one long prose paragraph.
 */
export const liftEllisReviewSectionHeaders = (text) => {
  let out = String(text || "");
  const afterPov = new RegExp(
    `([–—-]\\s*POV\\s*:\\s*[^\\n]*?\\S)[ \\t]+(\\*{0,2}(?:#{1,6}\\s+)?(?:[-*•]\\s+)?${ELLIS_REVIEW_SECTION_HEADER_NAMES}\\b)`,
    "gi"
  );
  out = out.replace(afterPov, "$1\n\n$2");

  const midHeader = new RegExp(
    `([^\\n])[ \\t]+(\\*{0,2}(?:#{1,6}\\s+)?(?:[-*•]\\s+)?${ELLIS_REVIEW_SECTION_HEADER_NAMES}\\b)(?=[ \\t]*:|[ \\t]+[A-Z])`,
    "g"
  );
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(midHeader, "$1\n\n$2");
  }
  return out;
};

/** How many distinct Output Standard section headers lead their own line. */
const countEllisReviewHeaders = (text) =>
  Object.values(ELLIS_REVIEW_HEADER_MARKERS).filter((re) => re.test(text))
    .length;

const ELLIS_CONTAINMENT_CLOSE_RE = /we've pressure-tested this chapter/i;

/** Negative signal: containment-close phrasing from follow-up protocol. */
export const isEllisConversationalCloseText = (text) =>
  ELLIS_CONTAINMENT_CLOSE_RE.test(String(text || ""));

/**
 * Conversational revision-check feedback is flowing editorial prose, not a
 * Scene Architect table. Ellis ends a real revision-check with the Chapter
 * Notes footer from the system prompt. Length is not a signal — a long Q&A
 * must not get this tag.
 */
export const isEllisRevisionCheckFeedbackText = (text) =>
  textHasEllisRevisionCheckFooter(text);

/**
 * Tag the assistant row so the FE can withhold Insert on revision-check turns.
 * A chapter that already has original Chapter Edits is never a first-pass,
 * even if the model still emits Output Standard headings. Q&A stays
 * conversational unless Ellis emitted the revision-check close.
 */
export const resolveEllisAssistantTurnKind = ({
  text = "",
  hasOriginalPlan = false,
} = {}) => {
  const fullText = String(text || "");
  if (isEllisRevisionCheckFeedbackText(fullText)) {
    return ELLIS_METADATA_KIND_REVISION_REVIEW;
  }
  if (isEllisDevelopmentalReviewText(fullText) && !hasOriginalPlan) {
    return ELLIS_METADATA_KIND_CHAPTER_REVIEW;
  }
  if (isEllisDevelopmentalReviewText(fullText) && hasOriginalPlan) {
    return ELLIS_METADATA_KIND_REVISION_REVIEW;
  }
  return ELLIS_METADATA_KIND_CONVERSATIONAL;
};

/** After a real Output Standard, tag/rewrite from the delivered opener, not the thread chapter. */
export const resolveEllisDeliveredReviewChapter = ({
  text = "",
  userContents = [],
  fallback = null,
} = {}) => {
  if (!isEllisDevelopmentalReviewText(text)) return fallback;
  const lifted = liftEllisReviewSectionHeaders(text);
  const openerTitle = extractReviewOpenerTitle(lifted);
  if (openerTitle) {
    const byOpener = resolveFocusedChapterRow({
      userContents,
      chapterLabel: openerTitle,
    });
    if (byOpener) return byOpener;
  }
  const label = parseEllisReviewSectionLabelFromHeader(lifted);
  if (label) {
    const byLabel = resolveFocusedChapterRow({
      userContents,
      chapterLabel: label,
    });
    if (byLabel) return byLabel;
  }
  const ref = parseEllisReviewBaseChapterFromContent(text);
  if (ref) {
    const row = resolveEllisReviewUnit({
      userContents,
      chapterNumber: ref.chapterNumber,
      chapterSuffix: ref.chapterSuffix,
    });
    if (row) return row;
  }
  return fallback;
};

/**
 * True when text is a Scene Architect kickoff (full or truncated).
 * Detection is structural: the two mandatory section headers (Function in
 * Story, Genre Beat Check) must each lead their own line, plus at least three
 * distinct section headers overall. This tolerates a review that stops before
 * the Chapter Cumulative Editorial Note, while rejecting conversation that only
 * name-drops the section labels in prose.
 */
export const isEllisDevelopmentalReviewText = (text) => {
  const t = liftEllisReviewSectionHeaders(stripEllisLegacyWorkflowCta(text));
  if (t.length < MIN_REVIEW_MARKDOWN_LENGTH) return false;
  if (isEllisConversationalCloseText(t)) return false;
  if (!ELLIS_REVIEW_HEADER_MARKERS.functionInStory.test(t)) return false;
  if (!ELLIS_REVIEW_HEADER_MARKERS.genreBeatCheck.test(t)) return false;
  return countEllisReviewHeaders(t) >= 3;
};

/** Remove false claims that the model inserted into the Revision Plan. */
export const stripEllisFalseInsertClaims = (text) =>
  String(text || "")
    .replace(
      /^.*\b(?:was\s+|has\s+been\s+)?inserted\s+into\s+(?:your\s+)?revision\s+plan\.?\s*$/gim,
      ""
    )
    .replace(
      /^.*\bI(?:'ve|\s+have)\s+inserted\b.*revision\s+plan\.?\s*$/gim,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Remove open-ended "next step" offers Ellis appends in conversation, e.g.
 * "👉 If you want, I can help you think through…" or
 * "👉 If you want, ask me the specific issue and I'll answer that directly."
 * These invitations create yes/yes loops that waste the writer's time and burn
 * tokens. Only 👉-led offer lines whose opener signals an optional-work offer
 * are removed, so this never touches Output Standard "👉 Editorial Logic:" /
 * "👉 Application Example" lines or the designed containment-close question
 * ("👉 We've pressure-tested this chapter…").
 */
const ELLIS_OPEN_OFFER_LINE_RE =
  /^[ \t>*_-]*👉\s*(?:\*+\s*)?(?:If\s+you(?:'d| would)?\s+(?:want|like|prefer)|Want\s+me\s+to|Would\s+you\s+like|Do\s+you\s+want\s+me\s+to|Shall\s+I|Happy\s+to|Let\s+me\s+know\s+if|I\s+can\s+(?:help|walk|break|show|isolate|draft|map|outline|pull|sketch))\b.*$/gim;

export const stripEllisOpenEndedOffers = (text) =>
  String(text || "")
    .replace(ELLIS_OPEN_OFFER_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Revision-check replies must not announce internal routing ("this is a
 * revision check, not a fresh first pass"). Peel that scaffolding off the
 * front so the writer only sees the editorial judgment.
 */
const ELLIS_INTERNAL_MODE_NAME_RE =
  /\b(?:REVISION REVIEW MODE|CHAPTER REVIEW KICKOFF MODE|CONVERSATIONAL MODE)\b:?\s*/gi;
const ELLIS_LEADING_REVISION_MODE_SENTENCE_RE =
  /^(?:[-*#\s>*_]*)?(?:\*{1,3}|_{1,3})?(?:This (?:one|turn|reply|pass|review) is |This is )?(?:a )?(?:revision (?:check|review)|not a (?:fresh )?(?:first[ -]?pass|second Output Standard))(?:,)?(?: not a (?:fresh )?(?:first[ -]?pass|Output Standard))?[^.!?\n]*[.!?:]?\s*/i;
const ELLIS_LEADING_AGAINST_ORIGINAL_NOTES_RE =
  /^(?:Against|Compared with|Compared to|Relative to) (?:the )?(?:original )?(?:notes|chapter edits|revision plan|plan)[,:]?\s+/i;
const ELLIS_CHAPTER_IN_PLAY_SENTENCE_RE =
  /(?:^|[.!?]\s+)[^.!?\n]*\bchapter in play\b[^.!?\n]*[.!?]?/gi;
const ELLIS_ATTACHED_BODY_LEAK_RE =
  /(?:^|[.!?]\s+)[^.!?\n]*(?:I see Chapter\b[^.\n]*\bhere\b|following reference text|still looking at Chapter\b|don['’]t have Chapter\b[^.\n]*in front of me|from this context alone|text in front of us is)[^.!?\n]*[.!?]?/gim;

export const stripEllisLeakedModeFraming = (text) => {
  let t = String(text || "")
    .replace(ELLIS_INTERNAL_MODE_NAME_RE, "")
    .replace(ELLIS_CHAPTER_IN_PLAY_SENTENCE_RE, "")
    .replace(/\bchapter in play\b/gi, "chapter we were discussing")
    .trim();
  let prev = "";
  while (t && t !== prev) {
    prev = t;
    ELLIS_ATTACHED_BODY_LEAK_RE.lastIndex = 0;
    t = t.replace(ELLIS_ATTACHED_BODY_LEAK_RE, "").trim();
    t = t.replace(ELLIS_LEADING_REVISION_MODE_SENTENCE_RE, "").trim();
    t = t.replace(ELLIS_LEADING_AGAINST_ORIGINAL_NOTES_RE, "").trim();
  }
  t = t.replace(/^([a-z])/, (_, c) => c.toUpperCase());
  return t.replace(/\n{3,}/g, "\n\n").trim();
};

const ELLIS_CHAPTER_N_POV_OPENER_RE =
  /^(Chapter\s+.+?)\s*[–—-]\s*(POV\s*:\s*.+)$/i;

const escapeEllisOpenerLabel = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripEllisOpenerDecorations = (line) =>
  String(line || "")
    .trim()
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();

const applyEllisOpenerDecorations = (originalLine, nextBody) => {
  const trimmed = originalLine.trim();
  const lead = originalLine.match(/^\s*/)[0];
  const heading = trimmed.match(/^(#{1,6}\s+)/);
  if (heading) return `${lead}${heading[1]}${nextBody}`;
  if (/^\*\*.*\*\*$/.test(trimmed)) return `${lead}**${nextBody}**`;
  return `${lead}${nextBody}`;
};

const splitOpenerTitleAndSceneLetter = (title, chapterLabel) => {
  const trimmed = String(title || "").trim();
  const label = String(chapterLabel || "").trim();
  if (!trimmed) return { base: "", letter: "" };
  if (trimmed.toLowerCase() === label.toLowerCase()) {
    return { base: trimmed, letter: "" };
  }
  const lettered = trimmed.match(/^(.*)\s+([A-Za-z])$/);
  if (!lettered) return { base: trimmed, letter: "" };
  return { base: lettered[1].trim(), letter: lettered[2].toUpperCase() };
};

/**
 * Ellis's Output Standard examples are "Chapter One – POV: Name", so the model
 * often emits that even when the writer named the chapter "1.5" / a custom
 * title. Rewrite Chapter-N openers to the stored chapter title. Scene letters
 * (A/B/C) are preserved. Bare titles (`Chapter One`) and title+following
 * `POV: Name` lines are collapsed to `Chapter One – POV: Name` when POV is
 * known from metadata or the next line.
 */
export const rewriteEllisReviewOpenersToChapterTitle = (
  text,
  chapterLabel,
  pov = ""
) => {
  const label = String(chapterLabel || "").trim();
  const povName = String(pov || "").trim();
  if (!label) return String(text || "");
  const escaped = escapeEllisOpenerLabel(label);
  // Title alone, optional scene letter, optional trailing dash/colon/period.
  const bareOrDashRe = new RegExp(
    `^${escaped}(?:\\s+([A-Za-z]))?\\s*[–—.:-]*\\s*$`,
    "i"
  );
  const lines = String(text || "").split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 160) {
      out.push(line);
      continue;
    }

    const stripped = stripEllisOpenerDecorations(line.trim());
    const match = stripped.match(ELLIS_CHAPTER_N_POV_OPENER_RE);
    if (match) {
      const [, titlePart, povPart] = match;
      const { letter } = splitOpenerTitleAndSceneLetter(titlePart, label);
      const nextTitle = letter ? `${label} ${letter}` : label;
      if (titlePart.trim().toLowerCase() === nextTitle.toLowerCase()) {
        out.push(line);
      } else {
        out.push(
          applyEllisOpenerDecorations(
            line,
            `${nextTitle} – ${povPart.trim()}`
          )
        );
      }
      continue;
    }

    const bare = stripped.match(bareOrDashRe);
    if (!bare) {
      out.push(line);
      continue;
    }

    const letter = bare[1] ? ` ${bare[1].toUpperCase()}` : "";
    const nextTitle = `${label}${letter}`;

    let j = i + 1;
    while (j < lines.length && !String(lines[j] || "").trim()) j += 1;
    const nextStripped =
      j < lines.length
        ? stripEllisOpenerDecorations(String(lines[j] || "").trim())
        : "";
    const nextPov = nextStripped.match(/^POV\s*:\s*(.+)$/i);
    const resolvedPov = nextPov ? String(nextPov[1] || "").trim() : povName;

    if (!resolvedPov) {
      out.push(line);
      continue;
    }

    out.push(
      applyEllisOpenerDecorations(
        line,
        `${nextTitle} – POV: ${resolvedPov}`
      )
    );
    if (nextPov) i = j;
  }

  return stampEllisRepeatedSceneOpenerLetters(out.join("\n"));
};

/**
 * One chapter, multiple scenes: if Ellis repeats the same unlabeled opener
 * (`Chapter Five – POV: Myla` twice), stamp A/B/C so it does not read as two
 * chapter reviews. Lettered openers are left alone.
 */
export const stampEllisRepeatedSceneOpenerLetters = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const unlabeledByBase = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > 160) continue;
    const stripped = stripEllisOpenerDecorations(lines[i].trim());
    const match = stripped.match(ELLIS_CHAPTER_N_POV_OPENER_RE);
    if (!match) continue;
    const titlePart = match[1].trim();
    const lettered = titlePart.match(/^(.*)\s+([A-Za-z])$/);
    if (lettered) continue;
    const key = titlePart.toLowerCase();
    const group = unlabeledByBase.get(key) || [];
    group.push({
      index: i,
      base: titlePart,
      povPart: match[2],
      line: lines[i],
    });
    unlabeledByBase.set(key, group);
  }

  const out = lines.slice();
  for (const group of unlabeledByBase.values()) {
    if (group.length < 2) continue;
    group.forEach((opener, n) => {
      const letter = String.fromCharCode(65 + n);
      out[opener.index] = applyEllisOpenerDecorations(
        opener.line,
        `${opener.base} ${letter} – ${opener.povPart.trim()}`
      );
    });
  }
  return out.join("\n");
};

/** Remove legacy copy-to-Word workflow lines the model may still emit. */
export const stripEllisLegacyWorkflowCta = (text) =>
  String(text || "")
    .replace(
      /Scene complete! Click the copy icon[\s\S]*?ready for the next scene\.?\s*/gi,
      ""
    )
    .trim();

/** Strip optional markdown fences and parse chapter review JSON. */
export const parseEllisChapterReviewJson = (rawText) => {
  if (!rawText || typeof rawText !== "string") return null;
  let text = rawText.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const parsed = parseJSONResponse(text);
    if (!parsed || !Array.isArray(parsed.scenes)) return null;
    return {
      scenes: parsed.scenes,
      cumulativeNote: parsed.cumulativeNote || "",
    };
  } catch (_) {
    return null;
  }
};

/** True when the original Chapter Edits body must not be overwritten. */
export const shouldPreserveOriginalEllisReview = (existing) =>
  Boolean(
    existing &&
      existing.status === "ready" &&
      String(existing.reviewMarkdown || "").trim()
  );

export const upsertEllisChapterReview = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = "",
  reviewMarkdown,
  chapterLabel,
  pov,
  draftContentHash = null,
  chapterId = null,
}) => {
  const chapterNum = Number(chapterNumber);
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);
  const cleaned = stripEllisLegacyWorkflowCta(reviewMarkdown);
  const hash = draftContentHash ? String(draftContentHash) : null;
  const rowId = chapterId || null;
  const existing = await EllisChapterReview.findOne({
    novel: novelId,
    chapterNumber: chapterNum,
    chapterSuffix: chapterSuf,
  })
    .select("status reviewMarkdown revisionMarkdown revisionGeneratedAt revisionMessageId chapterLabel pov generatedAt")
    .lean();

  if (shouldPreserveOriginalEllisReview(existing)) {
    return existing;
  }

  return EllisChapterReview.findOneAndUpdate(
    { novel: novelId, chapterNumber: chapterNum, chapterSuffix: chapterSuf },
    {
      $set: {
        user: userId,
        chapterSuffix: chapterSuf,
        chapterLabel,
        pov: pov || null,
        reviewMarkdown: cleaned,
        status: "ready",
        error: null,
        generatedAt: new Date(),
        ...(hash ? { draftContentHash: hash } : {}),
        ...(rowId ? { chapterId: rowId } : {}),
      },
      $setOnInsert: {
        novel: novelId,
        chapterNumber: chapterNum,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
};

export const markEllisChapterReviewGenerating = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = "",
}) => {
  const chapterNum = Number(chapterNumber);
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);
  return EllisChapterReview.findOneAndUpdate(
    { novel: novelId, chapterNumber: chapterNum, chapterSuffix: chapterSuf },
    {
      $set: { status: "generating", error: null, user: userId },
      $setOnInsert: {
        novel: novelId,
        chapterNumber: chapterNum,
        chapterSuffix: chapterSuf,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const markEllisChapterReviewFailed = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = "",
  errorMessage,
}) => {
  const chapterNum = Number(chapterNumber);
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);
  return EllisChapterReview.findOneAndUpdate(
    { novel: novelId, chapterNumber: chapterNum, chapterSuffix: chapterSuf },
    {
      $set: {
        status: "failed",
        error: errorMessage || "Scene review generation failed",
        user: userId,
      },
      $setOnInsert: {
        novel: novelId,
        chapterNumber: chapterNum,
        chapterSuffix: chapterSuf,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch(() => {});
};

/**
 * Load the Revision Plan review for a manuscript-map row. Exact chapterNumber
 * first; if a prior insert stored the review under a decimal parsed from the
 * chapter title (1.5 vs integer 2), fall back to that key.
 */
export const findEllisChapterReviewForMapRow = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = "",
  userContents = [],
}) => {
  const chapterNum = Number(chapterNumber);
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);
  const selected = getUploadedChapterRows(userContents).find(
    (uc) =>
      Number(uc.chapterNumber ?? uc.sceneIndex) === chapterNum &&
      (normalizeChapterSuffix(uc.chapterSuffix) || "") === chapterSuf
  );
  if (selected?._id) {
    const byId = await EllisChapterReview.findOne({
      novel: novelId,
      user: userId,
      chapterId: selected._id,
    }).lean();
    if (byId) return byId;
  }

  const exact = await EllisChapterReview.findOne({
    novel: novelId,
    user: userId,
    chapterNumber: chapterNum,
    chapterSuffix: chapterSuf,
  }).lean();
  if (exact) return exact;

  if (!selected) return null;
  const fromLabel = parseChapterRefFromRest(
    String(resolveChapterLabel(selected)).replace(/^chapter\s+/i, "")
  )?.chapterNumber;
  if (!Number.isFinite(fromLabel) || fromLabel === chapterNum) return null;
  return EllisChapterReview.findOne({
    novel: novelId,
    user: userId,
    chapterNumber: fromLabel,
    chapterSuffix: chapterSuf,
  }).lean();
};

const putEllisReviewProgressEntry = (progress, key, entry) => {
  if (!key) return;
  const existing = progress[key];
  if (!existing || (entry.status === "ready" && existing.status !== "ready")) {
    progress[key] = entry;
  }
};

/** Map stored reviews onto current manuscript-map rows for the sidebar dots. */
export const buildEllisReviewProgressMap = (reviews = [], userContents = []) => {
  const progress = {};
  for (const r of reviews) {
    let row = null;
    if (r.chapterId) {
      row = userContents.find((uc) => String(uc._id) === String(r.chapterId));
    }
    if (!row) {
      const keyNum = Number(r.chapterNumber);
      if (Number.isFinite(keyNum) && !Number.isInteger(keyNum)) {
        row = resolveEllisReviewUnit({
          userContents,
          chapterNumber: keyNum,
        });
      }
    }
    const keyNum = Number(
      row?.chapterNumber ?? row?.sceneIndex ?? r.chapterNumber
    );
    if (!Number.isFinite(keyNum)) continue;
    const suffix = normalizeChapterSuffix(
      row?.chapterSuffix ?? r.chapterSuffix
    );
    const entry = {
      status: r.status,
      generatedAt: r.generatedAt || null,
      chapterNumber: keyNum,
      chapterSuffix: suffix,
      ...(row?._id ? { chapterId: String(row._id) } : {}),
    };
    putEllisReviewProgressEntry(
      progress,
      chapterProgressKey(keyNum, suffix),
      entry
    );
    if (row?._id) {
      putEllisReviewProgressEntry(progress, `id:${String(row._id)}`, entry);
    }
  }
  return progress;
};
