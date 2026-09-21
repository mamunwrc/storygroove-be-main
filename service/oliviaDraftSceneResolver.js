/**
 * Book Editor manuscript rows for Olivia avatar/editor/scene chat.
 * Which pages to load is Olivia's call (load_manuscript_scenes), not regex.
 */

import { withoutArchivedScenes } from "../utils/archivedScenes.js";
import { getGlobalSceneNumber } from "../utils/globalSceneNumber.js";
import { stripChapterHtmlToText } from "../utils/manuscriptText.js";
import { buildManuscriptDraftPackBlock } from "./oliviaDynamicContext.js";

/** Book Editor sidebar numbering: at least 5 slots per act (3×5 spine). */
const computeOliviaOutlineOffsets = (userContents) => {
  const actMax = {};
  for (const uc of userContents || []) {
    const act = Number(uc.actNumber) || 1;
    const si = Number(uc.sceneIndex) || 0;
    if (si > (actMax[act] || 0)) actMax[act] = si;
  }
  for (let a = 1; a <= 3; a++) {
    actMax[a] = Math.max(5, actMax[a] || 0);
  }
  const offsets = {};
  let cumulative = 0;
  for (const act of Object.keys(actMax)
    .map(Number)
    .sort((a, b) => a - b)) {
    offsets[act] = cumulative;
    cumulative += actMax[act];
  }
  return offsets;
};

const rowKey = (row) => {
  if (row?._id) return `id:${row._id}`;
  return `slot:${Number(row?.actNumber)}:${Number(row?.sceneIndex)}`;
};

const sortRowsByGlobal = (rows, userContents) => {
  const offsets = computeOliviaOutlineOffsets(userContents);
  return [...rows].sort((a, b) => {
    const ga = getGlobalSceneNumber(a.actNumber, a.sceneIndex, offsets);
    const gb = getGlobalSceneNumber(b.actNumber, b.sceneIndex, offsets);
    return ga - gb;
  });
};

const countDraftWords = (html) => {
  const text = stripChapterHtmlToText(html || "");
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
};

const findByGlobalNumber = (userContents, globalNum) => {
  const offsets = computeOliviaOutlineOffsets(userContents);
  return (
    (userContents || []).find(
      (uc) =>
        getGlobalSceneNumber(uc.actNumber, uc.sceneIndex, offsets) ===
        Number(globalNum)
    ) || null
  );
};

const findRowsInAct = (userContents, actNumber) =>
  (userContents || []).filter(
    (uc) => Number(uc.actNumber) === Number(actNumber)
  );

export const draftSceneMetaFromRow = (row, userContents = []) => {
  if (!row) return null;
  const actNumber = Number(row.actNumber);
  const sceneIndex = Number(row.sceneIndex);
  if (!Number.isFinite(actNumber) || !Number.isFinite(sceneIndex)) return null;
  const offsets = computeOliviaOutlineOffsets(userContents);
  const sceneTitle = String(row.sceneTitle || "").trim().slice(0, 120);
  return {
    actNumber,
    sceneIndex,
    sceneId: row._id ? String(row._id) : undefined,
    globalSceneNumber: getGlobalSceneNumber(actNumber, sceneIndex, offsets),
    ...(sceneTitle ? { sceneTitle } : {}),
  };
};

export const isSameOliviaDraftScene = (a, b) => {
  if (!a || !b) return false;
  if (a.sceneId && b.sceneId && String(a.sceneId) === String(b.sceneId)) {
    return true;
  }
  return (
    a.actNumber != null &&
    a.sceneIndex != null &&
    Number(a.actNumber) === Number(b.actNumber) &&
    Number(a.sceneIndex) === Number(b.sceneIndex)
  );
};

/**
 * Cheap per-scene "what's on the page" rows for Olivia's DRAFT INDEX.
 * @param {object[]} userContents
 */
export const buildOliviaDraftIndexRows = (userContents = []) => {
  const active = withoutArchivedScenes(userContents);
  return sortRowsByGlobal(active, active).map((row) => {
    const meta = draftSceneMetaFromRow(row, active);
    const wordCount = countDraftWords(row?.userContent);
    return {
      ...meta,
      wordCount,
      hasProse: wordCount > 0,
    };
  });
};

/**
 * Map Olivia's load_manuscript_scenes args onto UserContent rows.
 * Globals not in the spine but within 1..max are missing; past max drop.
 */
export const applyOliviaDraftNeedDecision = (parsed, userContents = []) => {
  const active = withoutArchivedScenes(userContents);
  if (!active.length) {
    return { rows: [], missingGlobals: [] };
  }

  if (parsed?.wholeBook === true) {
    return {
      rows: sortRowsByGlobal(active, active),
      missingGlobals: [],
    };
  }

  const collected = new Map();
  const requestedGlobals = new Set();

  const actNumbers = [
    ...new Set(
      (parsed?.actNumbers || [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 3)
    ),
  ];
  for (const act of actNumbers) {
    for (const row of findRowsInAct(active, act)) {
      collected.set(rowKey(row), row);
    }
  }

  const offsets = computeOliviaOutlineOffsets(active);
  const maxGlobal = Math.max(
    0,
    ...active.map((uc) =>
      getGlobalSceneNumber(uc.actNumber, uc.sceneIndex, offsets)
    )
  );

  const requested = [
    ...new Set(
      (parsed?.globalSceneNumbers || [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxGlobal)
    ),
  ];
  for (const n of requested) {
    requestedGlobals.add(n);
    const row = findByGlobalNumber(active, n);
    if (row) collected.set(rowKey(row), row);
  }

  const rows = sortRowsByGlobal([...collected.values()], active);
  const foundGlobals = new Set(
    rows.map((row) => Number(draftSceneMetaFromRow(row, active)?.globalSceneNumber))
  );
  const missingGlobals = [...requestedGlobals]
    .filter((n) => !foundGlobals.has(n))
    .sort((a, b) => a - b);

  return { rows, missingGlobals };
};

const overlayLiveDraft = (row, userContents, selectedDraft, selectedMeta) => {
  const selectedText = String(selectedDraft || "").trim();
  const meta = draftSceneMetaFromRow(row, userContents);
  if (selectedText && isSameOliviaDraftScene(meta, selectedMeta)) {
    return selectedText;
  }
  return String(row?.userContent || "").trim();
};

export const parseOliviaDraftNeedArgs = (args) => {
  let parsed = args;
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    wholeBook: parsed.wholeBook === true,
    actNumbers: Array.isArray(parsed.actNumbers) ? parsed.actNumbers : [],
    globalSceneNumbers: Array.isArray(parsed.globalSceneNumbers)
      ? parsed.globalSceneNumbers
      : [],
  };
};

/** Last load_manuscript_scenes args stamped on an assistant turn (Ellis topic). */
export const findLastOliviaLoadedDraftNeed = (messages = []) => {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const parsed = parseOliviaDraftNeedArgs(msg.metadata?.loadedDraftNeed);
    if (!parsed) continue;
    if (
      parsed.wholeBook ||
      parsed.actNumbers.length > 0 ||
      parsed.globalSceneNumbers.length > 0
    ) {
      return parsed;
    }
  }
  return null;
};

const packScenesFromNeed = ({
  draftNeed,
  userContents = [],
  selectedDraft = "",
  selectedMeta = null,
}) => {
  const active = withoutArchivedScenes(userContents);
  const { rows, missingGlobals } = applyOliviaDraftNeedDecision(
    draftNeed,
    active
  );
  const scenes = rows.map((row) => ({
    meta: draftSceneMetaFromRow(row, active),
    text: overlayLiveDraft(row, active, selectedDraft, selectedMeta),
  }));
  return { scenes, missingGlobals };
};

/**
 * Open editor scene + draft index. Extra pages come from load_manuscript_scenes
 * this turn, or the last loaded set carried on the thread (follow-ups).
 */
export const resolveOliviaAvatarDrafts = ({
  userContents = [],
  selectedDraft = "",
  selectedMeta = null,
  draftNeed = null,
} = {}) => {
  const active = withoutArchivedScenes(userContents);
  const selectedText = String(selectedDraft || "").trim();
  const base = {
    manuscriptDraft: selectedText,
    draftSceneMeta: selectedMeta,
    openEditorDraft: "",
    openEditorSceneMeta: null,
    draftPackScenes: null,
    draftIndexRows: buildOliviaDraftIndexRows(active),
    missingDraftGlobals: [],
  };
  if (!draftNeed) return base;
  const { scenes, missingGlobals } = packScenesFromNeed({
    draftNeed,
    userContents: active,
    selectedDraft,
    selectedMeta,
  });
  if (!scenes.length && !missingGlobals.length) return base;
  const selectedInPack = scenes.some((item) =>
    isSameOliviaDraftScene(item.meta, selectedMeta)
  );
  return {
    ...base,
    draftPackScenes: scenes,
    missingDraftGlobals: missingGlobals,
    openEditorDraft: selectedInPack || !selectedText ? "" : selectedText,
    openEditorSceneMeta:
      selectedInPack || !selectedText ? null : selectedMeta,
  };
};

const EMPTY_PACK_NOTE =
  "No extra manuscript scenes matched. Use the open editor draft already in context.";

/**
 * Run load_manuscript_scenes from Olivia's structured tool arguments.
 */
export const executeOliviaLoadManuscriptScenes = ({
  args,
  userContents = [],
  selectedDraft = "",
  selectedMeta = null,
} = {}) => {
  const parsed = parseOliviaDraftNeedArgs(args);
  if (!parsed) return "Could not parse scene request.";
  const { scenes, missingGlobals } = packScenesFromNeed({
    draftNeed: parsed,
    userContents,
    selectedDraft,
    selectedMeta,
  });
  if (!scenes.length && !missingGlobals.length) return EMPTY_PACK_NOTE;
  return buildManuscriptDraftPackBlock(scenes, { missingGlobals }) || EMPTY_PACK_NOTE;
};
