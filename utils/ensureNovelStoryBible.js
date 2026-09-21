import { stripDossierBlocksFromMasterPrompt } from "../service/characterCanonContext.js";
import Novel from "../models/novelModel.js";

/**
 * Lazy-populate the dossier-free `storyBible` field from `masterPrompt`.
 * Mutates and persists the passed Mongoose doc so chat controllers that load
 * the novel directly (and skip getNovelDetails) still expose a Story Bible to
 * the full-canon context assembler. No-op when storyBible is already set or
 * masterPrompt is missing.
 * @param {object} novel - Mongoose Novel document (or plain object with _id).
 * @returns {Promise<object>} the same novel reference.
 */
export async function ensureNovelStoryBible(novel) {
  if (!novel) return novel;
  if (String(novel.storyBible || "").trim()) return novel;
  const mp = String(novel.masterPrompt || "").trim();
  if (!mp) return novel;
  const derived = stripDossierBlocksFromMasterPrompt(mp);
  if (!derived) return novel;
  novel.storyBible = derived;
  await Novel.findByIdAndUpdate(novel._id, { storyBible: derived }).catch(() => {});
  return novel;
}
