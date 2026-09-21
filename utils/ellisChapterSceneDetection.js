/**
 * Detect discrete scenes inside a consolidated chapter body for Ellis kickoff.
 * Handles both lettered sub-headers (Chapter Seven A) and untagged openings
 * (POV lines, prose before the first sub-header).
 */

import { extractScenePov } from "./extractSceneTitle.js";
import {
  isSceneBreakOrnamentLine,
} from "./manuscriptText.js";
import { matchChapterHeader, numberToWords } from "./manuscriptParser.js";

const MIN_LEADING_SCENE_CHARS = 80;
const MIN_PREVIEW_CHARS = 24;
const MAX_PREVIEW_CHARS = 100;

const findPrevNonEmptyLineIndex = (lines, fromIndex) => {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (String(lines[i] || "").trim()) return i;
  }
  return -1;
};

const parseStandalonePovLine = (line) => {
  const trimmed = String(line || "").trim();
  const m = trimmed.match(/^POV\s*:\s*(.+)$/i);
  if (!m || trimmed.length > 120) return null;
  const pov = String(m[1] || "").trim();
  return pov || null;
};

const isProseLikeLine = (line) => {
  const text = String(line || "").trim();
  if (!text) return false;
  if (matchChapterHeader(text)) return false;
  if (parseStandalonePovLine(text)) return false;
  if (isSceneBreakOrnamentLine(text)) return false;
  return text.length >= MIN_PREVIEW_CHARS;
};

const firstProsePreview = (lines, startIndex, endIndex) => {
  for (let i = startIndex; i < endIndex; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!isProseLikeLine(line)) continue;
    return line.length > MAX_PREVIEW_CHARS
      ? `${line.slice(0, MAX_PREVIEW_CHARS).trim()}…`
      : line;
  }
  return "";
};

const extractSegmentPov = (lines, startIndex, endIndex) => {
  for (let i = startIndex; i < endIndex; i += 1) {
    const pov = parseStandalonePovLine(lines[i]);
    if (pov) return pov;
  }
  const segmentText = lines.slice(startIndex, endIndex).join("\n");
  return extractScenePov(segmentText) || null;
};

const reviewLetterForIndex = (index) =>
  String.fromCharCode("A".charCodeAt(0) + index);

/**
 * Review opener label Ellis should use for one scene.
 * Multi-scene chapters: sequential A, B, C from the first scene (untagged openings are scene A).
 * Single-scene chapters: base chapter label without a letter (unless manuscript header has one).
 * @param {{ reviewLetter?: string, manuscriptSuffix?: string|null }} scene
 * @param {string} chapterLabel
 * @param {number} sceneCount
 * @returns {string}
 */
export const resolveSceneReviewLabel = (scene, chapterLabel, sceneCount) => {
  const suffix = scene?.manuscriptSuffix
    ? String(scene.manuscriptSuffix).toUpperCase()
    : "";

  if (sceneCount <= 1) {
    return suffix ? `${chapterLabel} ${suffix}` : chapterLabel;
  }

  const letter = scene?.reviewLetter || "";
  return letter ? `${chapterLabel} ${letter}` : chapterLabel;
};

/**
 * @typedef {object} EllisDetectedScene
 * @property {string} reviewLabel - Ellis scene opener label (e.g. "Chapter Seven A")
 * @property {string} reviewLetter - A, B, C for multi-scene; "" when sceneCount is 1
 * @property {string|null} pov
 * @property {string|null} manuscriptSuffix - A/B/C from manuscript sub-header if any
 * @property {string} markerKind
 * @property {string|null} manuscriptHeader
 * @property {string} preview
 */

/**
 * Detect scene boundaries inside one chapter's plain text.
 * @param {string} plainText
 * @param {number} chapterNumber
 * @param {string} [chapterLabel]
 * @returns {{ sceneCount: number, scenes: EllisDetectedScene[], chapterLabel: string }}
 */
export const detectChapterScenes = (
  plainText,
  chapterNumber,
  chapterLabel = ""
) => {
  const num = Number(chapterNumber);
  const label =
    String(chapterLabel || "").trim() ||
    (Number.isFinite(num) && num > 0
      ? `Chapter ${numberToWords(num) || num}`
      : "Chapter");

  const lines = String(plainText || "").split(/\r?\n/);
  const trimmedLines = lines.map((line) => String(line || "").trim());
  const hasBody = trimmedLines.some((line) => isProseLikeLine(line));

  if (!hasBody || !Number.isFinite(num) || num < 1) {
    return { sceneCount: 1, scenes: [], chapterLabel: label };
  }

  /** @type {Array<{ lineIndex: number, kind: string, manuscriptSuffix: string|null, pov: string|null, headerLine: string|null }>} */
  const rawBoundaries = [];

  for (let i = 0; i < trimmedLines.length; i += 1) {
    const line = trimmedLines[i];
    if (!line) continue;

    const header = matchChapterHeader(line);
    if (header && header.chapterNumber === num) {
      rawBoundaries.push({
        lineIndex: i,
        kind: header.chapterSuffix ? "lettered_subheader" : "chapter_subheader",
        manuscriptSuffix: header.chapterSuffix || null,
        pov: header.pov || null,
        headerLine: line,
      });
      continue;
    }

    const pov = parseStandalonePovLine(line);
    if (!pov) continue;

    const prevIdx = findPrevNonEmptyLineIndex(trimmedLines, i);
    const prevLine = prevIdx >= 0 ? trimmedLines[prevIdx] : "";
    const prevHeader = prevLine ? matchChapterHeader(prevLine) : null;
    const prevIsSameChapterHeader =
      prevHeader && prevHeader.chapterNumber === num;

    if (prevIsSameChapterHeader) continue;

    const atChapterStart = prevIdx < 0;
    const afterOrnament =
      prevIdx >= 0 && isSceneBreakOrnamentLine(prevLine);

    if (atChapterStart || afterOrnament) {
      rawBoundaries.push({
        lineIndex: i,
        kind: "pov_line",
        manuscriptSuffix: null,
        pov,
        headerLine: line,
      });
      continue;
    }

    if (rawBoundaries.length > 0) {
      const last = rawBoundaries[rawBoundaries.length - 1];
      const gapLines = trimmedLines
        .slice(last.lineIndex + 1, i)
        .filter((l) => l.length > 0);
      const gapHasProse = gapLines.some((l) => isProseLikeLine(l));
      if (gapHasProse && i - last.lineIndex > 2) {
        rawBoundaries.push({
          lineIndex: i,
          kind: "pov_line",
          manuscriptSuffix: null,
          pov,
          headerLine: line,
        });
      }
    }
  }

  /** @type {typeof rawBoundaries} */
  const merged = [];
  for (let i = 0; i < rawBoundaries.length; i += 1) {
    const current = rawBoundaries[i];
    const next = rawBoundaries[i + 1];
    if (
      current.kind === "chapter_subheader" &&
      next?.kind === "pov_line" &&
      next.lineIndex - current.lineIndex <= 3
    ) {
      merged.push({
        ...current,
        pov: next.pov || current.pov,
      });
      i += 1;
      continue;
    }
    merged.push(current);
  }

  if (merged.length > 0) {
    const firstIdx = merged[0].lineIndex;
    const leadingText = trimmedLines.slice(0, firstIdx).join("\n").trim();
    if (leadingText.replace(/\s+/g, " ").length >= MIN_LEADING_SCENE_CHARS) {
      merged.unshift({
        lineIndex: 0,
        kind: "untagged_opening",
        manuscriptSuffix: null,
        pov: extractScenePov(leadingText) || null,
        headerLine: null,
      });
    }
  }

  if (!merged.length) {
    const singleScene = {
      reviewLetter: "",
      pov: extractScenePov(plainText) || null,
      manuscriptSuffix: null,
      markerKind: "single_scene",
      manuscriptHeader: null,
      preview: firstProsePreview(trimmedLines, 0, trimmedLines.length),
    };
    singleScene.reviewLabel = resolveSceneReviewLabel(singleScene, label, 1);
    return {
      sceneCount: 1,
      scenes: [singleScene],
      chapterLabel: label,
    };
  }

  if (merged.length === 1) {
    const boundary = merged[0];
    const endIndex = trimmedLines.length;
    const pov =
      boundary.pov ||
      extractSegmentPov(trimmedLines, boundary.lineIndex, endIndex);
    const singleScene = {
      reviewLetter: "",
      pov,
      manuscriptSuffix: boundary.manuscriptSuffix,
      markerKind: "single_scene",
      manuscriptHeader: boundary.headerLine,
      preview: firstProsePreview(trimmedLines, boundary.lineIndex, endIndex),
    };
    singleScene.reviewLabel = resolveSceneReviewLabel(singleScene, label, 1);
    return {
      sceneCount: 1,
      scenes: [singleScene],
      chapterLabel: label,
    };
  }

  const sceneCount = merged.length;
  const scenes = merged.map((boundary, index) => {
    const nextBoundary = merged[index + 1];
    const endIndex = nextBoundary ? nextBoundary.lineIndex : trimmedLines.length;
    const pov =
      boundary.pov || extractSegmentPov(trimmedLines, boundary.lineIndex, endIndex);
    const scene = {
      reviewLetter: reviewLetterForIndex(index),
      pov,
      manuscriptSuffix: boundary.manuscriptSuffix,
      markerKind: boundary.kind,
      manuscriptHeader: boundary.headerLine,
      preview: firstProsePreview(trimmedLines, boundary.lineIndex, endIndex),
    };
    scene.reviewLabel = resolveSceneReviewLabel(scene, label, sceneCount);
    return scene;
  });

  return {
    sceneCount: scenes.length,
    scenes,
    chapterLabel: label,
  };
};

const describeSceneMarker = (scene, chapterLabel) => {
  if (scene.markerKind === "untagged_opening") {
    return "untagged opening scene before any lettered sub-header";
  }
  if (scene.markerKind === "lettered_subheader" && scene.manuscriptHeader) {
    return `manuscript sub-header "${scene.manuscriptHeader}"`;
  }
  if (scene.markerKind === "chapter_subheader" && scene.manuscriptHeader) {
    return `manuscript section "${scene.manuscriptHeader}"`;
  }
  if (scene.markerKind === "pov_line" && scene.manuscriptHeader) {
    return `opens with ${scene.manuscriptHeader}`;
  }
  return "detected scene boundary in chapter text";
};

/**
 * Build authoritative scene-inventory text for Ellis kickoff.
 * @param {{ sceneCount: number, scenes: EllisDetectedScene[], chapterLabel: string }} detection
 * @returns {string}
 */
export const buildEllisChapterSceneInventoryBlock = (detection) => {
  if (!detection || detection.sceneCount <= 1 || !detection.scenes?.length) {
    return "";
  }

  const { sceneCount, scenes, chapterLabel } = detection;
  const reviewLabels = scenes.map((scene) => scene.reviewLabel);
  const lines = [
    "CHAPTER SCENE INVENTORY (authoritative — do not skip or merge any scene):",
    `- This chapter contains ${sceneCount} distinct scenes.`,
    `- Deliver exactly ${sceneCount} separate per-scene review blocks (Function in Story through Creative Suggestions) before the Chapter Cumulative Editorial Note.`,
    `- Label your review output sequentially: ${reviewLabels.join(", ")}.`,
    "- Number scenes from A for the first scene in this chapter — including untagged openings (they become scene A even when the manuscript has no letter).",
    "- Renumber from A even when manuscript sub-headers use different letters (e.g. an untagged opening is Chapter Seven A; manuscript Chapter Seven A becomes Chapter Seven B in your review).",
    "",
    "Scenes to review:",
  ];

  for (const scene of scenes) {
    const reviewLabel = scene.reviewLabel;
    const povPart = scene.pov ? `POV: ${scene.pov}` : "POV: (infer from text)";
    const markerPart = describeSceneMarker(scene, chapterLabel);
    const previewPart = scene.preview ? `Opens: "${scene.preview}"` : "";
    lines.push(
      `- ${reviewLabel} — ${povPart}; ${markerPart}${
        previewPart ? `; ${previewPart}` : ""
      }`
    );
  }

  return lines.join("\n");
};

/**
 * Kickoff reminder appended when multiple scenes are detected.
 * @param {{ sceneCount: number, chapterLabel: string }} detection
 * @returns {string}
 */
export const buildEllisMultiSceneKickoffReminder = (detection) => {
  if (!detection || detection.sceneCount <= 1) return "";
  const labels = detection.scenes?.map((scene) => scene.reviewLabel).join(", ");
  return (
    `\n\nMULTI-SCENE CHAPTER (${detection.sceneCount} scenes in ${detection.chapterLabel}): ` +
    `Read the full chapter text, then deliver ${detection.sceneCount} separate scene review blocks ` +
    `before the Chapter Cumulative Editorial Note. Label sequentially from A: ${labels}. ` +
    `Untagged openings are scene A. Renumber manuscript sub-header letters to follow in order (B, C, …). ` +
    `If multiple weaknesses exist in a scene, repeat the Creative Suggestions weakness template under the same header — calibrate per scene; do not pad across scenes. ` +
    `Never skip a scene because the manuscript did not label it with a letter.`
  );
};
