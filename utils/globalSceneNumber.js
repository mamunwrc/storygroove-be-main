/**
 * Continuous (global) scene numbering across acts.
 *
 * The database stores per-act `sceneIndex` (1-based within each act).
 * These helpers derive a running total so Act 2's first scene is displayed
 * as Scene 6 (not Scene 1) when Act 1 has 5 scenes, etc.
 */

/**
 * Build a map of { actNumber → offset } where offset is the total number
 * of scenes in all preceding acts. Default 5 per act for the standard grid.
 *
 * @param {Array} userContents - documents with at least { actNumber, sceneIndex }
 * @returns {{ [actNumber: number]: number }}
 */
export const computeActOffsets = (userContents) => {
  const actMaxIndex = {};
  for (const uc of userContents || []) {
    const act = Number(uc.actNumber) || 1;
    const si = Number(uc.sceneIndex) || 0;
    if (si > (actMaxIndex[act] || 0)) actMaxIndex[act] = si;
  }
  for (let a = 1; a <= 3; a++) {
    if (!actMaxIndex[a]) actMaxIndex[a] = 5;
  }
  const offsets = {};
  let cumulative = 0;
  const sortedActs = Object.keys(actMaxIndex)
    .map(Number)
    .sort((a, b) => a - b);
  for (const act of sortedActs) {
    offsets[act] = cumulative;
    cumulative += actMaxIndex[act];
  }
  return offsets;
};

/**
 * @param {number} actNumber
 * @param {number} sceneIndex   - 1-based within the act
 * @param {{ [actNumber: number]: number }} offsets - from computeActOffsets
 * @returns {number} global 1-based scene number
 */
export const getGlobalSceneNumber = (actNumber, sceneIndex, offsets) =>
  (offsets[Number(actNumber)] || 0) + Number(sceneIndex);

/** Continuous chapter number for a focus slot (Act 3 slot 1 → 11 on the 15-spine). */
export const chapterNumberForFocus = (focusScene, userContents = []) => {
  if (!focusScene?.actNumber || focusScene?.sceneIndex == null) return null;
  return getGlobalSceneNumber(
    focusScene.actNumber,
    focusScene.sceneIndex,
    computeActOffsets(userContents)
  );
};

export const formatActChapterRef = (actNumber, chapterNumber) =>
  `Act ${actNumber}, Chapter ${chapterNumber}`;

/**
 * Map per-act focus scene → PromptTemplate spine index (1–15).
 *
 * @param {{ actNumber: number, sceneIndex: number } | null} focusScene
 * @param {Array<{ actNumber?: number, sceneIndex?: number }>} userContents
 * @returns {number | null}
 */
export const resolveSpineSceneIndex = (focusScene, userContents = []) => {
  if (!focusScene?.actNumber || focusScene?.sceneIndex == null) return null;
  const actNumber = Number(focusScene.actNumber);
  const sceneIndex = Number(focusScene.sceneIndex);
  if (!Number.isFinite(actNumber) || !Number.isFinite(sceneIndex)) return null;
  const offsets = computeActOffsets(userContents);
  const spine = getGlobalSceneNumber(actNumber, sceneIndex, offsets);
  if (!Number.isFinite(spine) || spine < 1 || spine > 15) return null;
  return spine;
};
