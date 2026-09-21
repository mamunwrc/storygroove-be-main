import { extractSceneTitle } from "./extractSceneTitle.js";

export const OUTLINE_SCENE_TITLE_MAX_CHARS = 80;

/**
 * Resolve the display title for an outline scene row.
 * UserContent.sceneTitle (sidebar rename) wins over StoryResponse extraction.
 *
 * @param {{ sceneTitle?: string }} userContent
 * @param {string} [responseText]
 * @param {number|string} [globalSceneNumber]
 * @returns {string}
 */
export function resolveOutlineSceneTitle(
  userContent,
  responseText = "",
  globalSceneNumber = ""
) {
  const fromUser = String(userContent?.sceneTitle || "").trim();
  if (fromUser) {
    return fromUser.slice(0, OUTLINE_SCENE_TITLE_MAX_CHARS);
  }

  const text = String(responseText || "").trim();
  if (text) {
    const extracted = extractSceneTitle(text);
    if (extracted) {
      return extracted.slice(0, OUTLINE_SCENE_TITLE_MAX_CHARS);
    }
  }

  if (globalSceneNumber !== "" && globalSceneNumber != null) {
    return `Chapter ${globalSceneNumber}`;
  }

  return "Untitled";
}
