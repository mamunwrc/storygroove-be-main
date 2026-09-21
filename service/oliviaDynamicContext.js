/**
 * Merge bounded dynamic context for Olivia V2 (memory block + supplements).
 */

import { stripChapterHtmlToText } from "../utils/manuscriptText.js";
import { buildNovelFoundationBlock } from "./characterCanonContext.js";

/**
 * @param {object} novel
 * @returns {string}
 */
export const buildMinimalNovelHeader = (novel) => {
  const block = buildNovelFoundationBlock(novel);
  if (!block) return "";
  return `\n\n---\n\n${block}\n\n---\n`;
};

const assemblerHasOutlineSlice = (assembled) => {
  const content = assembled?.memoryBlockMessage?.content || "";
  return content.includes("### OUTLINE SLICE");
};

/**
 * Compact act/slot map from the Book Editor outline (matches FE outlineLayout).
 * @param {Array<{ actNumber: number, sceneIndex: number, globalSceneNumber: number, title?: string, hasContent?: boolean, sceneId?: string }>} outlineLayout
 * @param {number|null} outlineRevision
 * @returns {string}
 */
export const buildOutlineLayoutBlock = (outlineLayout = [], outlineRevision = null) => {
  if (!Array.isArray(outlineLayout) || outlineLayout.length === 0) return "";

  const lines = [
    "OUTLINE LAYOUT (authoritative — sidebar titles and positions; use these over chat history):",
  ];
  for (const row of outlineLayout) {
    const act = Number(row.actNumber);
    const scene = Number(row.sceneIndex);
    const globalNum = Number(row.globalSceneNumber);
    const title = String(row.title || "Untitled").replace(/\n/g, " ").slice(0, 80);
    const status = row.hasContent ? "filled" : "empty";
    const idSuffix = row.sceneId ? ` id=${row.sceneId}` : "";
    lines.push(
      `- Act ${act} Chapter ${Number.isFinite(globalNum) && globalNum > 0 ? globalNum : scene}: "${title}" [${status}]${idSuffix}`
    );
  }
  if (outlineRevision != null && Number.isFinite(Number(outlineRevision))) {
    lines.push(`(Outline layout revision: ${outlineRevision})`);
  }
  return lines.join("\n");
};

const OUTLINE_STRUCTURE_CHANGE_PREFIX =
  "OUTLINE STRUCTURE CHANGE:";

/**
 * Human-readable notice when the writer mutates the outline sidebar.
 * @param {{ type?: string, sceneId?: string, sceneTitle?: string }} outlineChange
 * @returns {string}
 */
export const buildOutlineStructureChangeNotice = (outlineChange = null) => {
  if (!outlineChange?.type) return "";

  const sceneIdSuffix = outlineChange.sceneId
    ? ` (scene id=${outlineChange.sceneId})`
    : "";

  switch (outlineChange.type) {
    case "reorder":
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer reordered scenes in the outline sidebar. Use OUTLINE LAYOUT below for current act/scene positions; do not assume positions from earlier chat turns.`;
    case "add":
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer added a scene in the outline sidebar${sceneIdSuffix}. Use OUTLINE LAYOUT below for the new act/slot and title; do not assume the previous slot map from earlier chat turns.`;
    case "delete":
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer deleted a scene from the outline sidebar${sceneIdSuffix}. Do not reference that scene id or its former act/scene/global numbers from earlier chat turns; use OUTLINE LAYOUT below.`;
    case "archive":
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer archived a scene from the outline sidebar${sceneIdSuffix}. Remaining scenes were renumbered; do not use that scene's former act/scene/global numbers from earlier chat turns. Use OUTLINE LAYOUT below.`;
    case "restore":
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer restored an archived scene to the outline sidebar${sceneIdSuffix}. Scenes were renumbered to make room; use OUTLINE LAYOUT below for current act/scene positions.`;
    case "rename": {
      const title = String(outlineChange.sceneTitle || "").replace(/\n/g, " ").trim().slice(0, 80);
      const titlePart = title ? ` to "${title}"` : "";
      return `${OUTLINE_STRUCTURE_CHANGE_PREFIX} The writer renamed a scene in the outline sidebar${sceneIdSuffix}${titlePart}. Use the title in OUTLINE LAYOUT below for that scene id; do not use older labels from prior chat turns.`;
    }
    default:
      return "";
  }
};

export const MANUSCRIPT_DRAFT_MAX_CHARS = 40_000;

/** Shared cap for a multi-scene pack (not 40k × N). */
export const MANUSCRIPT_DRAFT_PACK_MAX_CHARS = 100_000;

/**
 * Truncate manuscript prose for Olivia context (~8k words). Cuts at the last
 * whitespace before the cap when possible so excerpts do not end mid-word.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {{ text: string, truncated: boolean }}
 */
export const truncateManuscriptDraftForContext = (
  text = "",
  maxChars = MANUSCRIPT_DRAFT_MAX_CHARS
) => {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length <= maxChars) {
    return { text: trimmed, truncated: false };
  }
  const sliceEnd = trimmed.lastIndexOf(" ", maxChars);
  const cutAt = sliceEnd > 0 ? sliceEnd : maxChars;
  return { text: trimmed.slice(0, cutAt), truncated: true };
};

/**
 * Normalize act/scene label fields from a request body scene object.
 * @param {object|null|undefined} scene
 * @returns {{ actNumber?: *, sceneIndex?: *, globalSceneNumber?: *, sceneTitle?: * } | null}
 */
export const sceneMetaFromPayload = (scene) => {
  if (!scene || typeof scene !== "object") return null;
  const sceneTitle = String(scene.sceneTitle || "").trim();
  if (
    scene.actNumber == null &&
    scene.sceneIndex == null &&
    scene.globalSceneNumber == null &&
    !sceneTitle
  ) {
    return null;
  }
  return {
    actNumber: scene.actNumber,
    sceneIndex: scene.sceneIndex,
    globalSceneNumber: scene.globalSceneNumber,
    sceneTitle: sceneTitle || scene.sceneTitle,
    sceneId: scene.sceneId ? String(scene.sceneId) : undefined,
  };
};

const formatDraftSceneLabel = (sceneMeta = {}, fallback = "selected scene") => {
  const act = sceneMeta.actNumber;
  const global = Number(sceneMeta.globalSceneNumber);
  const slot = Number(sceneMeta.sceneIndex);
  const chapter =
    Number.isFinite(global) && global > 0
      ? global
      : Number.isFinite(slot) && slot > 0
        ? slot
        : null;
  const title = String(sceneMeta.sceneTitle || "")
    .replace(/\n/g, " ")
    .trim()
    .slice(0, 120);

  if (act != null && chapter != null) {
    return title
      ? `Act ${act}, Chapter ${chapter} — "${title}"`
      : `Act ${act}, Chapter ${chapter}`;
  }
  if (title) return `"${title}"`;
  return fallback;
};

/**
 * Manuscript prose block for Coach Scene (draft review mode) or avatar/editor read.
 * @param {string} draft
 * @param {{ actNumber?: number, sceneIndex?: number, globalSceneNumber?: number, sceneTitle?: string }} sceneMeta
 * @param {{ mode?: "coaching" | "editor" }} [options]
 * @returns {string}
 */
export const buildManuscriptDraftBlock = (
  draft = "",
  sceneMeta = {},
  { mode = "coaching" } = {}
) => {
  const trimmed = String(draft || "").trim();
  if (!trimmed) return "";

  const sceneLabel = formatDraftSceneLabel(
    sceneMeta,
    mode === "editor" ? "selected scene" : "coached scene"
  );

  const { text: body, truncated } = truncateManuscriptDraftForContext(trimmed);
  const truncationNote = truncated
    ? `(Draft truncated to ${MANUSCRIPT_DRAFT_MAX_CHARS} characters for context limits.)`
    : "";

  const lines =
    mode === "editor"
      ? [
          "═══ WRITER'S MANUSCRIPT DRAFT (Book Editor) ═══",
          "This is the writer's current prose for this scene in the Book Editor. When the writer asks you to look at, assess, or discuss what they have written, use this text as the source of truth for what is on the page.",
          "The outline and scene-design sections are provisional intent. If the draft and outline disagree, prefer this draft for the pages and note the drift.",
          "Do NOT run an Office 3 six-part coaching pass, completion gate, or rewrite the chapter unless the writer explicitly asks.",
          "Do not ask the writer to paste the chapter into chat.",
          `Scene: ${sceneLabel}`,
        ]
      : [
          "═══ COACHING TARGET — WRITER'S MANUSCRIPT DRAFT (coach ONLY this prose) ═══",
          "This is the writer's drafted scene in the Book Editor. All coaching feedback must reference and critique this text.",
          "Do NOT treat outline/scene-design reference sections, StoryResponse summaries, or layering tables as the draft.",
          `Scene: ${sceneLabel}`,
        ];
  if (truncationNote) lines.push(truncationNote);
  lines.push(body);
  return lines.join("\n\n");
};

const formatPackSceneHeading = (sceneMeta = {}) => {
  const global = sceneMeta.globalSceneNumber;
  const act = sceneMeta.actNumber;
  const slot = sceneMeta.sceneIndex;
  const title = String(sceneMeta.sceneTitle || "")
    .replace(/\n/g, " ")
    .trim()
    .slice(0, 120);
  let heading = "";
  if (act != null && Number.isFinite(Number(act))) {
    const chapter =
      global != null && Number.isFinite(Number(global)) && Number(global) > 0
        ? Number(global)
        : slot != null && Number.isFinite(Number(slot))
          ? Number(slot)
          : null;
    heading = chapter != null ? `Act ${act} Chapter ${chapter}` : "";
  } else {
    heading = formatDraftSceneLabel(sceneMeta, "scene");
  }
  if (title) heading += ` — "${title}"`;
  return heading;
};

const formatSceneNumberList = (nums = []) => {
  const sorted = [
    ...new Set(
      nums.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    ),
  ].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = () => {
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    flush();
    start = sorted[i];
    prev = sorted[i];
  }
  flush();
  return parts.join(", ");
};

/**
 * Always-on cheap map of which Drafting Space scenes have prose.
 * @param {Array<{ globalSceneNumber?: number, actNumber?: number, sceneTitle?: string, wordCount?: number, hasProse?: boolean }>} draftIndexRows
 */
export const buildDraftIndexBlock = (draftIndexRows = []) => {
  if (!Array.isArray(draftIndexRows) || draftIndexRows.length === 0) return "";
  const lines = [
    "═══ DRAFT INDEX (what is on the page — not outline beats) ═══",
    "Use this to know which scenes have manuscript prose. The open editor draft is already attached. If MANUSCRIPT DRAFT PACK is present this turn, quote it when asked what is written — including one-line / marker placeholders; those still count as on-page text. If you need other pages (including 'those scenes', 'the placeholders', 'what's written there'), call load_manuscript_scenes. Do not invent prose. Outline/structure talk does not need this tool.",
  ];
  for (const row of draftIndexRows) {
    const global = row.globalSceneNumber ?? "?";
    const act = row.actNumber ?? "?";
    const title = String(row.sceneTitle || "")
      .replace(/\n/g, " ")
      .trim()
      .slice(0, 80);
    const titlePart = title ? ` — "${title}"` : "";
    const status = row.hasProse
      ? `${Number(row.wordCount) || 0} words`
      : "empty";
    lines.push(
      `- Act ${act} Chapter ${global}${titlePart} [${status}]`
    );
  }
  return lines.join("\n");
};

/**
 * Multi-scene manuscript pack for range / whole-draft avatar questions.
 * Strips Quill HTML and splits a shared char budget across scenes with prose.
 *
 * @param {Array<{ meta?: object, text?: string }>} scenes
 * @param {{ maxChars?: number }} [options]
 */
export const buildManuscriptDraftPackBlock = (
  scenes = [],
  { maxChars = MANUSCRIPT_DRAFT_PACK_MAX_CHARS, missingGlobals = [] } = {}
) => {
  const missing = (Array.isArray(missingGlobals) ? missingGlobals : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!Array.isArray(scenes)) return "";
  if (scenes.length === 0 && missing.length === 0) return "";

  const PREAMBLE_CHARS = 700;
  const PER_SCENE_OVERHEAD = 80;

  const prepared = scenes.map((item) => ({
    meta: item.meta || {},
    text: stripChapterHtmlToText(item.text || ""),
  }));

  const proseItems = prepared.filter((s) => s.text);
  const bodyBudget = Math.max(
    80,
    maxChars - PREAMBLE_CHARS - prepared.length * PER_SCENE_OVERHEAD
  );
  const withProseCount = proseItems.length || 1;
  const fair = Math.max(80, Math.floor(bodyBudget / withProseCount));
  const caps = proseItems.map((item) => Math.min(item.text.length, fair));
  let leftover = bodyBudget - caps.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < proseItems.length && leftover > 0; i++) {
    const room = proseItems[i].text.length - caps[i];
    if (room <= 0) continue;
    const extra = Math.min(room, leftover);
    caps[i] += extra;
    leftover -= extra;
  }

  const capByItem = new Map();
  proseItems.forEach((item, i) => capByItem.set(item, caps[i]));

  const included = [];
  const truncatedLabels = [];
  const omittedLabels = [];
  const emptyLabels = [];

  for (const item of prepared) {
    const label = formatPackSceneHeading(item.meta);
    if (!item.text) {
      emptyLabels.push(label);
      included.push({
        label,
        text: "(no prose yet)",
        globalSceneNumber: item.meta.globalSceneNumber,
      });
      continue;
    }
    const cap = capByItem.get(item) ?? 0;
    if (cap <= 0) {
      omittedLabels.push(label);
      continue;
    }
    const { text, truncated } = truncateManuscriptDraftForContext(
      item.text,
      cap
    );
    if (truncated) truncatedLabels.push(label);
    included.push({
      label,
      text,
      globalSceneNumber: item.meta.globalSceneNumber,
    });
  }

  if (!included.length && missing.length === 0) return "";

  const includedList = formatSceneNumberList(
    included.map((s) => s.globalSceneNumber)
  );
  const lines = [
    "═══ WRITER'S MANUSCRIPT DRAFT PACK (Book Editor) ═══",
    "This is the writer's current prose for the requested scenes in the Book Editor. Prefer this pack over outline/Scene Design for what is on the page. One-line and marker drafts still count as written text — quote them verbatim when the writer asks what is on the page. Do NOT run an Office 3 six-part coaching pass unless the writer explicitly asks. Do not ask the writer to paste chapters. Do not claim you read scenes that are omitted, missing, or listed as empty.",
  ];
  if (includedList) lines.push(`Scenes included: ${includedList}.`);
  if (emptyLabels.length) {
    lines.push(`(No prose yet: ${emptyLabels.join("; ")}.)`);
  }
  if (truncatedLabels.length) {
    lines.push(
      `(Truncated to fit context limits: ${truncatedLabels.join("; ")}.)`
    );
  }
  if (omittedLabels.length) {
    lines.push(
      `(Omitted — context limit: ${omittedLabels.join("; ")}. Do not pretend you read these pages.)`
    );
  }
  if (missing.length) {
    lines.push(
      `(Requested scenes not in the outline: ${formatSceneNumberList(missing)}. Do not invent them.)`
    );
  }
  for (const item of included) {
    lines.push(`--- ${item.label} ---`);
    lines.push(item.text);
  }
  return lines.join("\n\n");
};

export const buildOpenEditorDraftBlock = (draft = "", sceneMeta = {}) => {
  const trimmed = String(draft || "").trim();
  if (!trimmed) return "";
  const sceneLabel = formatDraftSceneLabel(sceneMeta, "open scene");
  const { text: body, truncated } = truncateManuscriptDraftForContext(trimmed);
  const truncationNote = truncated
    ? `(Draft truncated to ${MANUSCRIPT_DRAFT_MAX_CHARS} characters for context limits.)`
    : "";
  const lines = [
    "═══ CURRENTLY OPEN IN THE EDITOR (not the scene named in this message) ═══",
    "The writer has another scene open in the drafting area. This is supporting context only. Answer about the WRITER'S MANUSCRIPT DRAFT above — the scene they named — and do not redirect back to this open scene unless they ask.",
    `Scene: ${sceneLabel}`,
  ];
  if (truncationNote) lines.push(truncationNote);
  lines.push(body);
  return lines.join("\n\n");
};

/**
 * Office 3 scope reminder when coaching a scene (prepended to supplements).
 */
export const buildCoachingScopeBlock = (hasManuscriptDraft) => {
  if (hasManuscriptDraft) {
    return [
      "OFFICE 3 COACHING SCOPE:",
      "- Primary artifact: the WRITER'S MANUSCRIPT DRAFT block below (selected scene prose).",
      "- Supporting context only: Story Bible, character dossiers, outline/scene-design reference — use these to judge whether the draft fulfills intent; do not coach or rewrite scene-design text.",
      "- In-scene examples: use only characters, setting, and beats established in the manuscript draft below (and supporting Story Bible/outline context). Do not invent new characters, relationships, backstory, or plot.",
    ].join("\n");
  }
  return [
    "OFFICE 3 COACHING SCOPE:",
    "- No manuscript draft was supplied for the coached scene.",
    "- Ask the writer to add draft prose in the editor before a full coaching pass, or brainstorm at a high level.",
    "- Do not critique outline or scene-design reference text as if it were draft prose.",
  ].join("\n");
};

/**
 * Revision intelligence — compare current draft to prior full coaching pass.
 * @param {{ metadata?: object }} priorPass
 * @param {string} currentDraft
 * @param {{ actNumber?: number, sceneIndex?: number, sceneTitle?: string }} coachSceneMeta
 */
export const buildRevisionComparisonBlock = ({
  priorPass = null,
  currentDraft = "",
  coachSceneMeta = {},
} = {}) => {
  const meta = priorPass?.metadata || {};
  const sceneLabel = formatDraftSceneLabel(
    {
      actNumber: coachSceneMeta.actNumber ?? meta.actNumber,
      sceneIndex: coachSceneMeta.sceneIndex ?? meta.sceneIndex,
      globalSceneNumber:
        coachSceneMeta.globalSceneNumber ?? meta.globalSceneNumber,
      sceneTitle: coachSceneMeta.sceneTitle || meta.sceneTitle,
    },
    "coached scene"
  );

  const priorOpportunity = String(meta.primaryOpportunity || "").trim();
  const priorSnapshot = String(meta.manuscriptDraftSnapshot || "").trim();

  const { text: priorBody, truncated } =
    truncateManuscriptDraftForContext(priorSnapshot);
  const truncationNote = truncated
    ? `(Prior draft snapshot truncated to ${MANUSCRIPT_DRAFT_MAX_CHARS} characters for context limits.)`
    : "";

  const lines = [
    "═══ REVISION REVIEW — COMPARE TO PRIOR COACHING PASS ═══",
    `Scene: ${sceneLabel}`,
    "Mode: REVISION REVIEW — do not deliver a new full six-part pass unless the writer explicitly asks for one or the revision introduces a new major structural problem.",
    "",
    "Prior primary coaching opportunity:",
    priorOpportunity || "(See prior full coaching pass in thread.)",
    "",
    "Prior draft snapshot (at first full pass):",
    priorBody || "(No prior snapshot stored.)",
    "",
    "Current revised draft: see WRITER'S MANUSCRIPT DRAFT block below for the full revised text.",
  ];
  if (truncationNote) lines.push(truncationNote);
  return lines.join("\n");
};

export const buildDraftUnchangedSinceFullPassBlock = () =>
  [
    "REVISION REVIEW NOTE:",
    "The manuscript draft appears unchanged since the last full coaching pass on this scene.",
    "Do not deliver a revision review pass or a new full six-part pass.",
    "Tell the writer the draft matches the prior snapshot, invite them to revise first or discuss the existing feedback, and use the post-pass feedback discussion CTA.",
  ].join("\n");

/**
 * Notice when a scene is being coached but no draft prose was supplied for it.
 * Olivia should ask the writer to open/add the draft — never invent or guess it,
 * and never ask the writer to paste the chapter into chat.
 */
export const buildManuscriptDraftMissingBlock = () =>
  [
    "COACHING NOTE — NO DRAFT PROSE AVAILABLE:",
    "The writer triggered coaching for this scene but there is no manuscript draft prose for it in the editor yet.",
    "Do not fabricate, summarize, or guess the draft, and do not ask the writer to paste the chapter into the chat.",
    "Briefly let the writer know you need the scene's draft in the Book Editor to coach it, and ask them to open or add the draft in the editor for this scene; otherwise offer to brainstorm at a high level.",
  ].join("\n");

/**
 * Gate option 1 — writer confirmed chapter complete; deliver a fresh six-part pass.
 */
export const buildFullCoachingPassRequestedBlock = () =>
  [
    "COACHING MODE — FULL PASS (gate option 1):",
    "The writer confirmed this chapter is complete and wants a new full six-part coaching pass on the WRITER'S MANUSCRIPT DRAFT below.",
    "Deliver the full coaching pass structure (### 1. What's Working through ### 6. Forward Momentum Close).",
    "Do NOT deliver the Revision Assessment Template on this turn.",
    "A prior full coaching pass may exist in this thread — treat this as a fresh full read of the current draft at full-pass depth, not revision review.",
  ].join("\n");

export const buildOutlineInventoryTableBlock = (tableMarkdown = "") =>
  tableMarkdown?.trim()
    ? `CURRENT OUTLINE INVENTORY (authoritative — respond with this table format):\n${tableMarkdown.trim()}`
    : "";

export const buildOutlineInventoryListingRule = ({ hasInventoryTable = false } = {}) => {
  if (hasInventoryTable) {
    return [
      "OUTLINE LISTING (MANDATORY):",
      "Respond with a five-column GFM markdown table: Chapter #, Act, Title, POV, Summary. Start the table on its own line after a blank line.",
      "Use CURRENT OUTLINE INVENTORY below for every column (titles, positions, POV, and Summary).",
      "Do not use scene titles from prior chat turns, delivered scene blocks, or OUTLINE SLICE memories if they conflict with this table.",
      "Do not add a Status column or substitute filled/empty labels for POV or Summary.",
    ].join(" ");
  }
  return [
    "OUTLINE LISTING (MANDATORY):",
    "List scene positions and titles from OUTLINE LAYOUT below.",
    "POV and Summary are not available until scenes are saved with scene design content.",
    "Do not use scene titles from prior chat turns, delivered scene blocks, or OUTLINE SLICE memories if they conflict.",
  ].join(" ");
};

export const buildOutlineTableAuthorityRule = () =>
  [
    "OUTLINE TABLE AUTHORITY:",
    "Whenever you render any outline or scene table, take Chapter #, Act, and Title from the authoritative outline reference in this turn's context (CURRENT OUTLINE INVENTORY if present, otherwise OUTLINE LAYOUT).",
    "Never copy scene rows, titles, or positions from earlier chat tables, delivered scene blocks, or OUTLINE SLICE memories when they conflict with that reference.",
    "Only NEW rows you are proposing may be absent from the reference; mark them clearly.",
  ].join(" ");

/**
 * Scene/editor chat extras: target line, structure-change notice, layout snapshot, manuscript draft.
 */
export const buildSceneExtrasBlock = ({
  sceneContext = "",
  outlineChange = null,
  outlineLayout = [],
  outlineRevision = null,
  outlineInventoryQuery = false,
  outlineInventoryTable = "",
  manuscriptDraft = "",
  coachSceneMeta = null,
  draftSceneMeta = null,
  openEditorDraft = "",
  openEditorSceneMeta = null,
  draftPackScenes = null,
  draftIndexRows = null,
  missingDraftGlobals = null,
  revisionReview = false,
  priorCoachingPass = null,
  draftUnchangedSinceFullPass = false,
  manuscriptDraftMissing = false,
  fullCoachingPassRequested = false,
  outlineSaveStatus = "",
} = {}) => {
  const parts = [];
  if (coachSceneMeta) {
    parts.push(
      buildCoachingScopeBlock(Boolean(String(manuscriptDraft || "").trim()))
    );
  }
  if (manuscriptDraftMissing && !String(manuscriptDraft || "").trim()) {
    parts.push(buildManuscriptDraftMissingBlock());
  }
  if (fullCoachingPassRequested) {
    parts.push(buildFullCoachingPassRequestedBlock());
  } else if (draftUnchangedSinceFullPass) {
    parts.push(buildDraftUnchangedSinceFullPassBlock());
  } else if (revisionReview && priorCoachingPass) {
    parts.push(
      buildRevisionComparisonBlock({
        priorPass: priorCoachingPass,
        currentDraft: manuscriptDraft,
        coachSceneMeta,
      })
    );
  }
  const changeNotice = buildOutlineStructureChangeNotice(outlineChange);
  if (changeNotice) parts.push(changeNotice);
  if (sceneContext?.trim()) parts.push(sceneContext.trim());
  if (outlineSaveStatus?.trim()) parts.push(outlineSaveStatus.trim());

  const inventoryTable = String(outlineInventoryTable || "").trim();
  const useInventoryTable = outlineInventoryQuery && Boolean(inventoryTable);

  if (outlineInventoryQuery) {
    parts.push(
      buildOutlineInventoryListingRule({ hasInventoryTable: useInventoryTable })
    );
    if (useInventoryTable) {
      parts.push(buildOutlineInventoryTableBlock(inventoryTable));
    }
  }

  if (
    !outlineInventoryQuery &&
    Array.isArray(outlineLayout) &&
    outlineLayout.length > 0
  ) {
    parts.push(buildOutlineTableAuthorityRule());
  }

  if (!useInventoryTable) {
    const layoutBlock = buildOutlineLayoutBlock(outlineLayout, outlineRevision);
    if (layoutBlock) parts.push(layoutBlock);
  }

  if (!coachSceneMeta && Array.isArray(draftIndexRows) && draftIndexRows.length > 0) {
    const indexBlock = buildDraftIndexBlock(draftIndexRows);
    if (indexBlock) parts.push(indexBlock);
  }

  const packBlock =
    !coachSceneMeta && Array.isArray(draftPackScenes)
      ? buildManuscriptDraftPackBlock(draftPackScenes, {
          missingGlobals: missingDraftGlobals,
        })
      : "";
  if (packBlock) {
    parts.push(packBlock);
  } else {
    const draftMeta = coachSceneMeta || draftSceneMeta || {};
    const draftMode = coachSceneMeta ? "coaching" : "editor";
    const draftBlock = buildManuscriptDraftBlock(manuscriptDraft, draftMeta, {
      mode: draftMode,
    });
    if (draftBlock) parts.push(draftBlock);
  }
  if (!coachSceneMeta) {
    const openBlock = buildOpenEditorDraftBlock(
      openEditorDraft,
      openEditorSceneMeta || {}
    );
    if (openBlock) parts.push(openBlock);
  }
  return parts.filter(Boolean).join("\n\n");
};

/**
 * Outline / bible slice / POV supplements — always safe to send on chain-hot turns
 * (separate from the skippable assembler memory block).
 */
export const buildOliviaSupplementBlock = ({
  assembled,
  outlineContext = "",
  povRotationBlock = "",
  bibleSlice = "",
  sceneExtras = "",
  layeringQueue = "",
  novel = null,
}) => {
  const supplements = [];

  if (layeringQueue?.trim()) supplements.push(layeringQueue.trim());

  if (bibleSlice?.trim()) supplements.push(bibleSlice.trim());

  if (sceneExtras?.trim()) supplements.push(sceneExtras.trim());

  const hasMemoryOutline = assemblerHasOutlineSlice(assembled);
  if (hasMemoryOutline) {
    if (povRotationBlock?.trim()) supplements.push(povRotationBlock.trim());
  } else if (outlineContext?.trim()) {
    supplements.push(outlineContext.trim());
    if (povRotationBlock?.trim()) supplements.push(povRotationBlock.trim());
  } else if (novel) {
    supplements.push(buildMinimalNovelHeader(novel));
    if (povRotationBlock?.trim()) supplements.push(povRotationBlock.trim());
  }

  const supplementBody = supplements.filter(Boolean).join("\n\n");
  if (!supplementBody) return null;

  return { role: "system", content: supplementBody };
};

/**
 * @param {Object} args
 * @param {Object|null} args.assembled - assembleOliviaContext result
 * @param {string} args.outlineContext - from buildOutlineAndPovContext (may be windowed)
 * @param {string} args.povRotationBlock
 * @param {string} args.bibleSlice - from buildMasterPromptSlice
 * @param {string} args.sceneExtras - scene chat only (target + beat hints)
 * @param {string} args.layeringQueue - editor-only NEW-row delivery queue
 * @param {object} args.novel - for minimal header fallback
 * @returns {{ role: 'system', content: string } | null}
 */
export const buildOliviaDynamicContext = (args) => {
  const supplementBlock = buildOliviaSupplementBlock(args);
  const memoryContent = args.assembled?.memoryBlockMessage?.content?.trim() || "";

  if (!memoryContent && !supplementBlock?.content) return null;

  const content = [memoryContent, supplementBlock?.content].filter(Boolean).join("\n\n");
  return { role: "system", content };
};
