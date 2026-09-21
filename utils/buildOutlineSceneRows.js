import { extractScenePov } from "./extractSceneTitle.js";
import { computeActOffsets, getGlobalSceneNumber } from "./globalSceneNumber.js";
import { resolveOutlineSceneTitle } from "./resolveOutlineSceneTitle.js";
import { isArchivedScene, withoutArchivedScenes } from "./archivedScenes.js";

/**
 * Build ordered outline scene rows from UserContent + StoryResponse docs.
 * Shared by layering welcome table, outline export, and AI context helpers.
 * Archived scenes are omitted; callers should pass post-archive renumbered indices.
 */
export const buildOutlineSceneRows = (sceneDocs = [], userContents = []) => {
  const actGroups = {};
  for (const uc of userContents) {
    if (isArchivedScene(uc)) continue;
    const actNum = Number(uc.actNumber) || 1;
    if (!actGroups[actNum]) actGroups[actNum] = [];
    actGroups[actNum].push(uc);
  }

  const activeContents = withoutArchivedScenes(userContents);
  const actOffsets = computeActOffsets(activeContents);
  const rows = [];

  for (const actNum of Object.keys(actGroups).sort(
    (a, b) => Number(a) - Number(b)
  )) {
    const actScenes = [...actGroups[actNum]].sort((a, b) => {
      const ai = Number(a.sceneIndex) || 0;
      const bi = Number(b.sceneIndex) || 0;
      return ai - bi;
    });

    for (const uc of actScenes) {
      const globalNum = getGlobalSceneNumber(
        uc.actNumber,
        uc.sceneIndex,
        actOffsets
      );
      const sceneDoc = sceneDocs.find((s) => s.promptKey === uc.promptKey);
      const responseText = sceneDoc?.responseText || "";
      const title = resolveOutlineSceneTitle(uc, responseText, globalNum);
      let summary = "";
      let pov = "";
      let purpose = "";

      if (responseText) {
        const summaryMatch = responseText.match(/📝 Scene to Write:\s*(.+)/i);
        if (summaryMatch) summary = summaryMatch[1].trim().slice(0, 200);
        const extractedPov = extractScenePov(responseText);
        if (extractedPov) pov = extractedPov;
        const coachingMatch = responseText.match(
          /📘 Book Coaching for Scene:\s*([\s\S]*?)(?=\n(?:🎭|🧩|📏|📝|🏰|⚡|💔|🔗|📈))/i
        );
        if (coachingMatch) {
          purpose = coachingMatch[1].trim().split(/\n/)[0].slice(0, 120);
        }
        if (!purpose) {
          const arcMatch = responseText.match(
            /📈 Character Arc Movement:\s*(.+)/
          );
          if (arcMatch) purpose = arcMatch[1].trim().slice(0, 120);
        }
      }

      rows.push({
        globalNum,
        actNumber: Number(actNum),
        sceneIndex: Number(uc.sceneIndex) || 1,
        promptKey: uc.promptKey,
        title,
        pov,
        purpose,
        summary,
        responseText,
      });
    }
  }

  return rows;
};

const escapeTableCell = (v) =>
  String(v || "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");

/** GFM markdown table for layering welcome and outline summary section. */
export const formatOutlineSceneRowsAsMarkdownTable = (rows = []) => {
  let table = "| Chapter # | Act | Title | POV | Chapter Purpose | Summary |\n";
  table += "|---------|-----|-------|-----|---------------|----------|\n";
  for (const row of rows) {
    table += `| Chapter ${row.globalNum} | ${row.actNumber} | ${escapeTableCell(row.title)} | ${escapeTableCell(row.pov)} | ${escapeTableCell(row.purpose)} | ${escapeTableCell(row.summary)} |\n`;
  }
  return table;
};

/** Five-column GFM table for outline inventory list queries (no Scene Purpose). */
export const formatOutlineInventoryTable = (rows = []) => {
  if (!rows.length) return "";
  let table = "| Chapter # | Act | Title | POV | Summary |\n";
  table += "|---------|-----|-------|-----|----------|\n";
  for (const row of rows) {
    table += `| Chapter ${row.globalNum} | ${row.actNumber} | ${escapeTableCell(row.title)} | ${escapeTableCell(row.pov)} | ${escapeTableCell(row.summary)} |\n`;
  }
  return table;
};

/** Strip stored HTML chapter content down to a short plain-text summary. */
const stripHtmlToText = (html = "") =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Build Manuscript Map rows from uploaded-manuscript chapters.
 * Mirrors the outline scene-summary table, but sourced from the parsed draft
 * (chapter / POV / what-the-chapter-covers) rather than generated
 * outline beats.
 */
export const buildManuscriptMapRows = (userContents = []) =>
  [...userContents]
    .filter((uc) => uc.chapterNumber != null || uc.chapterLabel)
    .sort(
      (a, b) =>
        Number(a.chapterNumber || a.sceneIndex || 0) -
        Number(b.chapterNumber || b.sceneIndex || 0)
    )
    .map((uc) => ({
      chapterNumber: Number(uc.chapterNumber || uc.sceneIndex || 0),
      chapterLabel:
        uc.chapterLabel ||
        uc.sceneTitle ||
        (uc.chapterNumber ? `Chapter ${uc.chapterNumber}` : ""),
      pov: uc.pov || "",
      summary:
        uc.chapterSummary?.trim() ||
        stripHtmlToText(uc.userContent).slice(0, 180),
    }));

/** GFM markdown table for the Manuscript Map (docx export + UI). */
export const formatManuscriptMapAsMarkdownTable = (rows = []) => {
  let table = "| Chapter | POV | Summary |\n";
  table += "|---------|-----|----------|\n";
  for (const row of rows) {
    table += `| ${escapeTableCell(row.chapterLabel)} | ${escapeTableCell(row.pov)} | ${escapeTableCell(row.summary)} |\n`;
  }
  return table;
};
