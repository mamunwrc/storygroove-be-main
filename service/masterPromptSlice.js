/**
 * Bounded story-bible slice for Olivia V2 dynamic context (Layer A lite).
 */

import { extractNovelDataFromResponse } from "../utils/extractNovelData.js";
import { buildNovelFoundationBlock } from "./characterCanonContext.js";
import { formatActChapterRef } from "../utils/globalSceneNumber.js";

export const MAX_MASTER_PROMPT_SLICE_CHARS = 2500;

const STRUCTURE_SECTION_RE =
  /(?:\*{0,2}\s*(?:13\.?\s*)?Structure\s*\*{0,2}\s*\n)([\s\S]*?)(?=\n\s*(?:\*{0,2}\s*(?:14|---|\*{0,2}\s*Tone)))/i;

const extractStructureSection = (storyBibleText) => {
  if (!storyBibleText) return "";
  const m = String(storyBibleText).match(STRUCTURE_SECTION_RE);
  return m?.[1]?.trim() || "";
};

const premiseLinesFromExtract = (extracted, novel = {}) => {
  const lines = [];
  if (extracted?.genre || novel.genre) {
    lines.push(`Genre: ${extracted?.genre || novel.genre}`);
  }
  if (extracted?.protagonist || novel.protagonist) {
    lines.push(`Protagonist: ${extracted?.protagonist || novel.protagonist}`);
  }
  if (extracted?.antagonist || novel.antagonist) {
    lines.push(`Antagonist: ${extracted?.antagonist || novel.antagonist}`);
  }
  if (extracted?.theme || novel.theme) {
    lines.push(`Theme: ${extracted?.theme || novel.theme}`);
  }
  if (extracted?.subplot || novel.subplot) {
    lines.push(`Subplot: ${extracted?.subplot || novel.subplot}`);
  }
  if (extracted?.summary) {
    lines.push(`Premise: ${extracted.summary.slice(0, 400)}`);
  }
  return lines;
};

const capSlice = (text) => {
  const s = String(text || "").trim();
  if (s.length <= MAX_MASTER_PROMPT_SLICE_CHARS) return s;
  console.warn(
    JSON.stringify({
      scope: "masterPromptSlice",
      op: "truncate",
      fromChars: s.length,
      toChars: MAX_MASTER_PROMPT_SLICE_CHARS,
    })
  );
  return `${s.slice(0, MAX_MASTER_PROMPT_SLICE_CHARS - 3)}...`;
};

/**
 * Build a bounded Story Bible slice for Olivia V2 dynamic context.
 * The first argument is `novel.storyBible` — the dossier-free, lazy-populated
 * field. Character profiles are shipped separately via CHARACTER PROFILES, so
 * this slice intentionally never contains dossier prose.
 *
 * @param {string} storyBibleText
 * @param {{ layeringPhase?: string, focusScene?: { actNumber: number, sceneIndex: number } | null, novel?: object }} options
 * @returns {string} Markdown section or empty string
 */
export const buildMasterPromptSlice = (
  storyBibleText,
  { layeringPhase = "outlining", focusScene = null, novel = {} } = {}
) => {
  const body = String(storyBibleText || "").trim();
  if (!body) {
    const fromNovel = buildNovelFoundationBlock(novel);
    if (!fromNovel) return "";
    return capSlice(
      fromNovel.replace("### NOVEL DETAILS", "### STORY BIBLE SLICE (from novel record)")
    );
  }

  const phase = layeringPhase || "outlining";
  const structure = extractStructureSection(body);
  const extracted = extractNovelDataFromResponse(body);
  const parts = ["### STORY BIBLE SLICE (canonical setup — character profiles ship separately)"];

  if (phase === "outlining" || phase === "phase1_table") {
    parts.push(...premiseLinesFromExtract(extracted, novel));
    if (structure) {
      parts.push("\n**Structure / overlay (from Story Bible):**");
      parts.push(structure.slice(0, 1200));
    }
  } else {
    if (structure) {
      parts.push("\n**Structure / POV overlay (honor for this turn):**");
      parts.push(structure.slice(0, 900));
    }
    if (focusScene?.actNumber && focusScene?.sceneIndex) {
      const chapter =
        Number(focusScene.globalSceneNumber) > 0
          ? Number(focusScene.globalSceneNumber)
          : focusScene.sceneIndex;
      parts.push(
        `\nFocus scene: ${formatActChapterRef(focusScene.actNumber, chapter)}.`
      );
    }
  }

  return capSlice(parts.join("\n"));
};
