import UserContent from "../models/userContentModel.js";
import { extractSceneTitle } from "./extractSceneTitle.js";
import { computeActOffsets, getGlobalSceneNumber } from "./globalSceneNumber.js";

const PLACEHOLDER_TITLE = /^(untitled scene|new scene|scene\s*)$/i;

/**
 * Persisted outline title: robust extraction, non-generic default by slot, de-dupe across the novel.
 */
export async function resolveSceneTitleForOutline({
  novelId,
  userId,
  promptKey,
  actNumber,
  sceneIndex,
  sceneContent,
}) {
  let base = extractSceneTitle(sceneContent).trim();
  if (!base || PLACEHOLDER_TITLE.test(base)) {
    const allContents = await UserContent.find({ novelId, user: userId })
      .select("actNumber sceneIndex")
      .lean();
    const offsets = computeActOffsets(allContents);
    const globalNum = getGlobalSceneNumber(actNumber, sceneIndex, offsets);
    base = `Act ${actNumber} · Chapter ${globalNum}`;
  }

  const siblings = await UserContent.find({
    novelId,
    user: userId,
    promptKey: { $ne: promptKey },
  })
    .select("sceneTitle")
    .lean();

  const usedLower = new Set(
    siblings.map((s) => (s.sceneTitle || "").trim().toLowerCase()).filter(Boolean)
  );

  if (!usedLower.has(base.toLowerCase())) {
    return base.slice(0, 120);
  }

  let n = 2;
  let candidate = base;
  while (usedLower.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})`;
    n += 1;
    if (n > 60) {
      candidate = `${base} · ${String(promptKey).slice(-8)}`;
      break;
    }
  }
  return candidate.slice(0, 120);
}
