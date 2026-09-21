import { formatActChapterRef, getGlobalSceneNumber } from "./globalSceneNumber.js";

/**
 * Core 15-spine slots that already have outline content (StoryResponse or
 * UserContent body). Same fill rule as getNextEmptyOliviaCoreSlot.
 */
export const collectFilledOliviaCoreSlotKeys = (
  userContents = [],
  storyResponses = []
) => {
  const responseTextByKey = {};
  for (const sr of storyResponses) {
    if (sr.promptKey && sr.responseText) responseTextByKey[sr.promptKey] = true;
  }
  const filled = new Set();
  for (const uc of userContents) {
    if (uc.actNumber == null || uc.sceneIndex == null) continue;
    if (responseTextByKey[uc.promptKey] || uc.userContent) {
      filled.add(`${uc.actNumber}-${uc.sceneIndex}`);
    }
  }
  return filled;
};

export const findNextEmptyOliviaCoreSlot = (filledSlotKeys) => {
  const filled = filledSlotKeys instanceof Set ? filledSlotKeys : new Set();
  for (let act = 1; act <= 3; act++) {
    for (let sc = 1; sc <= 5; sc++) {
      if (!filled.has(`${act}-${sc}`)) return { actNumber: act, sceneIndex: sc };
    }
  }
  return null;
};

const formatSlotRef = (slot, actOffsets) => {
  if (!slot || slot.actNumber == null || slot.sceneIndex == null) return null;
  return formatActChapterRef(
    slot.actNumber,
    getGlobalSceneNumber(slot.actNumber, slot.sceneIndex, actOffsets)
  );
};

/**
 * Always-on scene-chat guard. Chain-hot turns do not replay the Mongo
 * "scene is now in your outline" confirm, so the last rich block's Save CTA
 * still looks unsaved unless we say otherwise here.
 */
export const buildOliviaOutlineSaveStatusBlock = ({
  targetScene = null,
  nextEmptySlot = null,
  filledSlotKeys = new Set(),
  actOffsets = {},
} = {}) => {
  const filled =
    filledSlotKeys instanceof Set ? filledSlotKeys : new Set(filledSlotKeys);
  const lines = [
    'OUTLINE SAVE STATUS (MANDATORY — supersedes the post-scene "Save Chapter to Outline" CTA on earlier assistant messages; that CTA is stale after a successful insert):',
    "Every chapter listed in CURRENT OUTLINE is already saved. Never tell the writer a listed chapter isn't saved to the outline yet.",
  ];

  const targetKey =
    targetScene?.actNumber != null && targetScene?.sceneIndex != null
      ? `${targetScene.actNumber}-${targetScene.sceneIndex}`
      : null;
  const targetLabel = formatSlotRef(targetScene, actOffsets);
  const nextLabel = formatSlotRef(nextEmptySlot, actOffsets);

  if (targetLabel && targetKey && filled.has(targetKey)) {
    lines.push(
      `- CURRENT TARGET ${targetLabel} is already saved. Do not ask to lock it in. Do not re-deliver it.`
    );
  } else if (targetLabel) {
    lines.push(`- CURRENT TARGET ${targetLabel} is not in the outline yet.`);
  }

  if (nextLabel) {
    lines.push(`- Next unsaved core slot: ${nextLabel}.`);
    lines.push(
      `- If the writer says "next scene" or "move on", go to ${nextLabel}. Do not flag a saved chapter as unsaved.`
    );
  } else {
    lines.push("- All 15 core outline slots are saved.");
  }

  return lines.join("\n");
};
