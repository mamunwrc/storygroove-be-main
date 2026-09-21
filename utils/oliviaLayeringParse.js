/**
 * NEW Scene table parsing for Olivia editor layering (mirrors storygroove-fe/.../oliviaLayeringParse.js).
 * Used server-side to build post-insert confirmation "Ready for next…" text.
 */

export const parseAllNewScenes = (text) => {
  if (!text) return [];

  const clean = text.replace(/\*+/g, "").replace(/[_~`#]+/g, "");
  const lines = clean.split("\n");
  const results = new Map();
  let currentAct = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      const hm = trimmed.match(/\bAct\s*([1-3])\b/i);
      if (hm) currentAct = parseInt(hm[1], 10);
    }

    if (!/NEW/i.test(line) || !/(?:Scene|Chapter)/i.test(line)) continue;

    const sceneMatch = line.match(/NEW\s+(?:Scene|Chapter)\s+(\d+(?:\.\d+)?)/i);
    if (!sceneMatch) continue;

    const sceneRef = `NEW Scene ${sceneMatch[1]}`;
    const isTableRow = trimmed.startsWith("|");
    let actNum = currentAct;
    let title = "";
    let pov = "";
    let summary = "";

    if (isTableRow) {
      const lineActMatch = line.match(/\bAct\s*([1-3])\b/i);
      if (lineActMatch) actNum = parseInt(lineActMatch[1], 10);

      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      if (!lineActMatch && cells.length > 1 && /^[1-3]$/.test(cells[1])) {
        actNum = parseInt(cells[1], 10);
      }

      const sceneIdx = cells.findIndex((c) => /NEW\s+(?:Scene|Chapter)/i.test(c));
      const actIdx = cells.findIndex(
        (c) => /\bAct\s*[1-3]\b/i.test(c) || /^[1-3]$/.test(c.trim())
      );
      const dataStart = Math.max(sceneIdx, actIdx >= 0 ? actIdx : sceneIdx) + 1;
      const dataCells = cells.slice(dataStart);
      title = dataCells[0] || "";
      pov = dataCells[1] || "";
      // 6-column table: | Scene # | Act | Title | POV | Scene Purpose | Summary |
      // 5-column table (legacy): | Scene # | Act | Title | POV | Summary |
      if (dataCells.length >= 4) {
        summary = dataCells[3] || "";
      } else {
        summary = dataCells[2] || "";
      }
    } else {
      const after = line.slice(
        sceneMatch.index + sceneMatch[0].length,
        sceneMatch.index + sceneMatch[0].length + 120
      );
      const tm = after.match(/^[\s:–\-—]+([^\n,;]{3,80})/);
      if (tm) title = tm[1].trim();
      const freeActMatch = line.match(/\bAct\s*([1-3])\b/i);
      if (freeActMatch) actNum = parseInt(freeActMatch[1], 10);
    }

    const key = sceneRef.toLowerCase() + `-act${actNum}`;
    if (results.has(key)) continue;

    const displayRef = `${sceneRef} - Act ${actNum}`;

    results.set(key, {
      id: `${sceneRef}-act${actNum}-${title}`,
      stableKey: key,
      rawSceneRef: sceneRef,
      sceneRef: displayRef,
      act: `Act ${actNum}`,
      actNumber: actNum,
      title,
      pov,
      summary,
    });
  }

  return Array.from(results.values());
};

export const hasDetectedNewScenes = (text) =>
  text ? parseAllNewScenes(text).length > 0 : false;

/**
 * Stricter than hasDetectedNewScenes: requires at least one markdown TABLE row
 * (a line starting with `|`) whose Scene # cell contains `NEW Scene X.Y`.
 * Prose messages that merely mention "NEW Scene 1.5" inline (serial cues,
 * post-insert confirmations) do NOT qualify as a layering table.
 */
export const hasDetectedNewScenesTableRow = (text) => {
  if (!text) return false;
  const clean = text.replace(/\*+/g, "").replace(/[_~`#]+/g, "");
  const lines = clean.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/NEW\s+(?:Scene|Chapter)\s+\d+(?:\.\d+)?/i.test(line)) return true;
  }
  return false;
};

const sceneRefSortParts = (rawSceneRef) => {
  const m = (rawSceneRef || "").match(/NEW\s+(?:Scene|Chapter)\s+(\d+)(?:\.(\d+))?/i);
  if (!m) return [9999, 9999];
  return [parseInt(m[1], 10), m[2] != null ? parseInt(m[2], 10) : 0];
};

export const sortNewScenesForExpansionOrder = (scenes) =>
  [...scenes].sort((a, b) => {
    if (a.actNumber !== b.actNumber) return a.actNumber - b.actNumber;
    const [am, an] = sceneRefSortParts(a.rawSceneRef);
    const [bm, bn] = sceneRefSortParts(b.rawSceneRef);
    if (am !== bm) return am - bm;
    return an - bn;
  });

const getDoneLayeringStableKeys = (oliviaLayeredInserts, userContents) => {
  const inserts = oliviaLayeredInserts || [];
  const contents = userContents || [];
  const promptPresent = new Set(contents.map((c) => c.promptKey).filter(Boolean));
  const done = new Set();
  for (const row of inserts) {
    const sk = (row.stableKey || "").trim().toLowerCase();
    if (sk && row.promptKey && promptPresent.has(row.promptKey)) done.add(sk);
  }
  return done;
};

export const findLatestLayeringTableTextFromMessages = (messages) => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === "assistant" &&
      m.content &&
      hasDetectedNewScenesTableRow(m.content)
    ) {
      return m.content;
    }
  }
  return null;
};

const getAfterSceneIndexFromRef = (sceneRef) => {
  const m = (sceneRef || "").match(/(\d+)(?:\.\d+)?/);
  if (!m) return 0;
  return parseInt(m[1], 10);
};

const sceneIndicesByAct = (userContents) => {
  const grouped = { 1: [], 2: [], 3: [] };
  (userContents || []).forEach((scene) => {
    const act = Number(scene.actNumber);
    if ([1, 2, 3].includes(act)) grouped[act].push(Number(scene.sceneIndex));
  });
  for (const k of [1, 2, 3]) {
    grouped[k] = Array.from(new Set(grouped[k])).sort((a, b) => a - b);
  }
  return grouped;
};

const clampAfterToValidAct = (actNumber, inferredAfter, byAct) => {
  const opts = [0, ...(byAct[actNumber] || [])].sort((a, b) => a - b);
  if (opts.includes(inferredAfter)) return inferredAfter;
  return opts[opts.length - 1] ?? 0;
};

/**
 * Compute the authoritative layering state that the frontend Insert button
 * uses to resolve the target for a rich scene. Output shape:
 *   {
 *     layeringRows: [
 *       { actNumber, afterSceneIndex, layeringStableKey, rawSceneRef, title, inserted }, ...
 *     ],
 *     nextLayeringTarget: { actNumber, afterSceneIndex, layeringStableKey, rawSceneRef, title } | null,
 *     allDone: boolean,
 *   }
 *
 * `afterSceneIndex` is clamped against the current outline (from userContents)
 * so it is always a valid insert position for its act.
 */
const emptyLayeringState = (tableText = null) => ({
  layeringRows: [],
  nextLayeringTarget: null,
  allDone: false,
  tableText,
});

export const computeLayeringState = ({ tableText, oliviaLayeredInserts, userContents } = {}) => {
  if (!tableText) {
    return emptyLayeringState(null);
  }

  const scenes = sortNewScenesForExpansionOrder(parseAllNewScenes(tableText));
  if (!scenes.length) {
    return emptyLayeringState(null);
  }

  const done = getDoneLayeringStableKeys(oliviaLayeredInserts, userContents);
  const byAct = sceneIndicesByAct(userContents);

  const layeringRows = scenes.map((s) => {
    const stableKey = (s.stableKey || "").trim().toLowerCase();
    const inferredAfter = getAfterSceneIndexFromRef(s.rawSceneRef);
    const afterSceneIndex = clampAfterToValidAct(s.actNumber, inferredAfter, byAct);
    return {
      actNumber: s.actNumber,
      afterSceneIndex,
      layeringStableKey: stableKey,
      rawSceneRef: s.rawSceneRef,
      title: s.title || "",
      inserted: Boolean(stableKey && done.has(stableKey)),
    };
  });

  const next = layeringRows.find((r) => !r.inserted) || null;
  const nextLayeringTarget = next
    ? {
        actNumber: next.actNumber,
        afterSceneIndex: next.afterSceneIndex,
        layeringStableKey: next.layeringStableKey,
        rawSceneRef: next.rawSceneRef,
        title: next.title,
      }
    : null;

  return {
    layeringRows,
    nextLayeringTarget,
    allDone: layeringRows.length > 0 && layeringRows.every((r) => r.inserted),
    tableText,
  };
};

const GENERIC_NEXT =
  "Tell me when you're ready for the next NEW chapter from your finalized table, or ask to revisit the layering table.";

/**
 * @param {string|null} tableText
 * @param {object[]} oliviaLayeredInserts
 * @param {{ promptKey?: string }[]} userContents
 */
export const buildLayeringInsertNextCueSuffix = (tableText, oliviaLayeredInserts, userContents) => {
  if (!tableText) return GENERIC_NEXT;

  const scenes = sortNewScenesForExpansionOrder(parseAllNewScenes(tableText));
  if (!scenes.length) return GENERIC_NEXT;

  const done = getDoneLayeringStableKeys(oliviaLayeredInserts, userContents);

  const next = scenes.find((s) => {
    const sk = (s.stableKey || "").trim().toLowerCase();
    return sk && !done.has(sk);
  });

  if (!next) {
    return "All NEW chapters from your latest layering table are in your outline. Say if you'd like to adjust the plan or add more layers.";
  }

  const displayRef = formatNewRowRefForWriter(next.rawSceneRef);
  const label = next.title
    ? `**${displayRef} — ${next.title}**`
    : `**${displayRef}**`;
  return `According to your finalized table, the next chapter is ${label}.\n\nAre you ready for me to deliver that next chapter, or do you want to make any adjustments here first?`;
};

/** Writer-facing NEW row label. Internal rawSceneRef stays `NEW Scene X.Y`. */
const formatNewRowRefForWriter = (rawSceneRef) =>
  String(rawSceneRef || "NEW Scene").replace(/\bScene\b/gi, "Chapter");

const formatLayeringRowLabel = (row) => {
  const ref = formatNewRowRefForWriter(row?.rawSceneRef);
  return row?.title ? `${ref} — ${row.title}` : ref;
};

const LAYERING_PHASE1_START_BLOCK = [
  "LAYERING PHASE (MANDATORY — no NEW-row table in this thread yet):",
  "The 15-scene spine recap is reference only. It is NOT a locked layering table and is NOT a cue to re-deliver Chapter 15 or any other core spine scene.",
  "Do NOT output a STEP-2 rich scene block.",
  'If the writer is ready, brings ideas, asks for suggestions, says yes/ok/"both", or similar: produce a Phase 1 six-column layering table (Chapter #, Act, Title, POV, Chapter Purpose, Summary) with the existing spine PLUS NEW Chapter decimal rows (e.g. NEW Chapter 2.5) spread across Acts 1–3, then the mandatory reminder block.',
].join("\n");

/**
 * Compact always-on editor supplement so chain-hot turns still know
 * which NEW row is next after Insert (the injected chat cue is not in
 * previous_response_id). With no NEW-row table yet, this is the Phase 1
 * start guard so the spine recap does not get re-delivered as Scene 15.
 *
 * @param {{ layeringRows?: object[], nextLayeringTarget?: object|null, allDone?: boolean }|null} layeringState
 */
export const buildLayeringQueueBlock = (layeringState) => {
  const rows = layeringState?.layeringRows;
  if (!Array.isArray(rows) || rows.length === 0) return LAYERING_PHASE1_START_BLOCK;

  const remaining = rows.filter((r) => !r.inserted);
  const inserted = rows.filter((r) => r.inserted);
  const next = layeringState.nextLayeringTarget;
  const nextLine = next
    ? formatLayeringRowLabel(next)
    : "none — all NEW rows are in the outline";
  const remainingLines = remaining.length
    ? remaining.map((r) => `- ${formatLayeringRowLabel(r)}`).join("\n")
    : "- (none)";
  const doneLines = inserted.length
    ? inserted.map((r) => `- ${formatLayeringRowLabel(r)}`).join("\n")
    : "- (none)";

  return [
    "LAYERING DELIVERY QUEUE (authoritative — supersedes earlier chat tables, serial cues, and the last rich-scene delivery):",
    `- Next to deliver: ${nextLine}`,
    "- Remaining (expansion order):",
    remainingLines,
    "- Already in outline (do NOT re-deliver unless the writer names that row for revision):",
    doneLines,
    "If the writer says ready, yes, next, or equivalent, deliver ONLY the Next row as one STEP-2 rich block. Do not regenerate the layering table. Do not re-deliver an Already-in-outline row.",
  ].join("\n");
};
