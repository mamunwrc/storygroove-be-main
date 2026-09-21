const SCENE_TITLE_LINE_RE =
  /(?:^|\n)([ \t]*(?:\*{0,2})?[ \t]*Scene Title[ \t]*(?:\*{0,2})?[ \t]*:[ \t]*)([^\n]*)/i;

/**
 * Sync the Scene Title line in rich scene design text after a sidebar rename.
 * @param {string} responseText
 * @param {string} newTitle
 * @returns {string}
 */
export function replaceSceneTitleInResponseText(responseText, newTitle) {
  const title = String(newTitle || "").trim();
  if (!title) return responseText || "";
  const text = String(responseText || "");
  if (!text.trim()) return text;

  const match = text.match(SCENE_TITLE_LINE_RE);
  if (match) {
    const fullMatch = match[0];
    const prefix = match[1];
    const replacement = fullMatch.startsWith("\n")
      ? `\n${prefix}${title}`
      : `${prefix}${title}`;
    return text.replace(fullMatch, replacement);
  }

  return `Scene Title: ${title}\n${text}`;
}
