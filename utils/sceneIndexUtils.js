import UserContent from "../models/userContentModel.js";

const EXTRA_SLOT_PROMPT_KEY_RE = /^scene\d+_\d+$/;
/** Spine keys from initial Olivia generation: scene1 … scene15 */
const SPINE_PROMPT_KEY_RE = /^scene([1-9]|1[0-5])$/;

export const normalizeActNumber = (act) => {
  const n = Number(act);
  if (Number.isFinite(n) && n >= 1 && n <= 3) return n;
  return 1;
};

const compareRows = (a, b) => {
  const ai = Number(a.sceneIndex);
  const bi = Number(b.sceneIndex);
  const aValid = Number.isFinite(ai) && ai >= 1;
  const bValid = Number.isFinite(bi) && bi >= 1;
  if (aValid && bValid && ai !== bi) return ai - bi;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (aTime !== bTime) return aTime - bTime;
  return String(a._id).localeCompare(String(b._id));
};

/** Active (non-archived) scenes in an act. Soft-deleted rows already excluded by model hook. */
export const scenesInActQuery = (novelId, userId, actNumber) => ({
  novelId,
  user: userId,
  actNumber: normalizeActNumber(actNumber),
  archivedAt: null,
});

/** Next safe 1-based sceneIndex when appending to an act (active scenes only). */
export const nextSceneIndexForAct = async (novelId, userId, actNumber) => {
  const act = normalizeActNumber(actNumber);
  const rows = await UserContent.find(scenesInActQuery(novelId, userId, act))
    .select("sceneIndex")
    .lean();
  let max = 0;
  for (const row of rows) {
    const si = Number(row.sceneIndex);
    if (Number.isFinite(si) && si >= 1 && si > max) max = si;
  }
  return max > 0 ? max + 1 : 1;
};

const actNeedsHeal = (rows) => {
  if (!rows.length) return false;
  const seen = new Set();
  for (const row of rows) {
    const si = Number(row.sceneIndex);
    if (!Number.isFinite(si) || si < 1) return true;
    if (seen.has(si)) return true;
    seen.add(si);
  }
  // Gaps (e.g. 1,3,4 after a pre-renumber archive) also need a contiguous 1..N pass.
  for (let i = 1; i <= rows.length; i++) {
    if (!seen.has(i)) return true;
  }
  return false;
};

/**
 * Reassign contiguous sceneIndex 1..N within an act when duplicates or invalid
 * indices exist. Preserves relative order (sceneIndex asc, then createdAt).
 * Returns true if any row was updated.
 */
export const healActSceneIndices = async (novelId, userId, actNumber) => {
  const act = normalizeActNumber(actNumber);
  const rows = await UserContent.find(scenesInActQuery(novelId, userId, act))
    .sort({ sceneIndex: 1, createdAt: 1 })
    .lean();

  if (!rows.length || !actNeedsHeal(rows)) return false;

  const sorted = [...rows].sort(compareRows);
  const ops = [];
  for (let i = 0; i < sorted.length; i++) {
    const nextIndex = i + 1;
    if (Number(sorted[i].sceneIndex) !== nextIndex) {
      ops.push({
        updateOne: {
          filter: { _id: sorted[i]._id },
          update: { $set: { sceneIndex: nextIndex, actNumber: act } },
        },
      });
    }
  }
  if (ops.length > 0) await UserContent.bulkWrite(ops);
  return ops.length > 0;
};

/**
 * Rewrite scene{act}_{idx} promptKeys to match current actNumber/sceneIndex.
 * Spine keys (scene1–scene15), user_*, and layered_* are left unchanged.
 */
export const syncExtraSlotPromptKeys = async (novelId, userId, actNumber) => {
  const act = normalizeActNumber(actNumber);
  const rows = await UserContent.find(scenesInActQuery(novelId, userId, act))
    .select("promptKey actNumber sceneIndex")
    .lean();

  const ops = [];
  for (const row of rows) {
    const pk = row.promptKey || "";
    if (!EXTRA_SLOT_PROMPT_KEY_RE.test(pk)) continue;
    const expected = `scene${row.actNumber}_${row.sceneIndex}`;
    if (pk !== expected) {
      ops.push({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { promptKey: expected } },
        },
      });
    }
  }
  if (ops.length > 0) await UserContent.bulkWrite(ops);
  return ops.length > 0;
};

/**
 * Resolve promptKey when saving an Olivia-generated scene to the outline.
 *
 * promptKey is a stable spine identity (scene1…scene15) assigned at generation time.
 * actNumber/sceneIndex are physical outline positions and change when scenes are
 * reordered. Deriving promptKey from position would overwrite an existing scene
 * (e.g. scene7 at Act 2 Scene 1 gets replaced when saving to Act 2 Scene 2).
 */
export const resolvePromptKeyForOliviaSave = async (
  novelId,
  userId,
  actNumber,
  sceneIndex
) => {
  const act = normalizeActNumber(actNumber);
  const si = Number(sceneIndex);

  const existingAtSlot = await UserContent.findOne({
    novelId,
    user: userId,
    actNumber: act,
    sceneIndex: si,
    archivedAt: null,
  })
    .select("promptKey")
    .lean();

  if (existingAtSlot?.promptKey) {
    return existingAtSlot.promptKey;
  }

  const rows = await UserContent.find({ novelId, user: userId })
    .select("promptKey")
    .lean();
  const usedSpine = new Set();
  for (const row of rows) {
    const pk = row.promptKey || "";
    if (SPINE_PROMPT_KEY_RE.test(pk)) usedSpine.add(pk);
  }

  for (let n = 1; n <= 15; n++) {
    const pk = `scene${n}`;
    if (!usedSpine.has(pk)) return pk;
  }

  return `scene${act}_${si}`;
};

/** Heal indices and sync extra-slot keys for acts 1–3. Returns whether anything changed. */
export const healNovelSceneIndices = async (novelId, userId) => {
  let changed = false;
  for (let act = 1; act <= 3; act++) {
    if (await healActSceneIndices(novelId, userId, act)) changed = true;
    if (await syncExtraSlotPromptKeys(novelId, userId, act)) changed = true;
  }
  return changed;
};
