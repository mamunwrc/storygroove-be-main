import UserContent from "../models/userContentModel.js";

export const MAX_SCENE_TITLE_LEN = 120;

/**
 * Pure dedupe given a set of taken lowercase titles (for tests and DB-backed resolver).
 * @param {string} desiredTitle
 * @param {Set<string>} takenTitlesLower
 * @returns {{ finalTitle: string, titleWasRenamed: boolean }}
 */
export function resolveUniqueSceneTitleFromTaken(desiredTitle, takenTitlesLower) {
  const trimmed = String(desiredTitle || "")
    .trim()
    .slice(0, MAX_SCENE_TITLE_LEN);
  if (!trimmed) {
    return { finalTitle: "", titleWasRenamed: false };
  }

  let finalTitle = trimmed;
  let titleWasRenamed = false;
  if (takenTitlesLower.has(finalTitle.toLowerCase())) {
    let n = 2;
    while (takenTitlesLower.has(`${trimmed} (${n})`.toLowerCase())) {
      n += 1;
    }
    finalTitle = `${trimmed} (${n})`.slice(0, MAX_SCENE_TITLE_LEN);
    titleWasRenamed = true;
  }

  return { finalTitle, titleWasRenamed };
}

/**
 * Case-insensitive novel-wide scene title dedupe (mirrors addScene).
 * @param {{ novelId: string, userId: string, desiredTitle: string, excludeSceneId?: string | null }} params
 * @returns {Promise<{ finalTitle: string, titleWasRenamed: boolean }>}
 */
export async function resolveUniqueSceneTitle({
  novelId,
  userId,
  desiredTitle,
  excludeSceneId = null,
}) {
  const existing = await UserContent.find(
    { novelId, user: userId },
    { sceneTitle: 1, _id: 1 }
  ).lean();

  const takenTitles = new Set(
    existing
      .filter(
        (row) =>
          !excludeSceneId || String(row._id) !== String(excludeSceneId)
      )
      .map((row) => (row.sceneTitle || "").trim().toLowerCase())
      .filter(Boolean)
  );

  return resolveUniqueSceneTitleFromTaken(desiredTitle, takenTitles);
}
