/**
 * Story Bible display slicing — mirrors storygroove-fe/src/Pages/BookEditor/utils.js
 * so exports match the Story Bible tab in OutlineSidebar.
 */

function tailLooksLikeStoryBibleBridge(tailText) {
  if (!tailText || typeof tailText !== "string") return false;
  const t = tailText;
  if (!/\bThis is the heartbeat of your novel\b/i.test(t)) return false;
  return (
    /\bWriting Studio\b/i.test(t) ||
    /\b17[\s-]*point\s+character\s+dossiers\b/i.test(t) ||
    /\b17[\s-]*Point\s+Dossiers\b/i.test(t) ||
    /\bReady for those\??\b/i.test(t) ||
    /\bReady for the character\b/i.test(t) ||
    /\bcharacter dossiers\b/i.test(t) ||
    /\bBig moment\b/i.test(t)
  );
}

export function stripStoryBibleBridgingFooter(text) {
  let lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (!lines.length) return "";

  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/\bThis is the heartbeat of your novel\b/i.test(lines[i])) continue;
    const tail = lines.slice(i).join("\n");
    if (tailLooksLikeStoryBibleBridge(tail)) {
      cutAt = i;
      break;
    }
  }

  if (cutAt >= 0) {
    lines = lines.slice(0, cutAt);
  } else {
    const last = lines[lines.length - 1];
    const isBridging =
      /\bThis is the heartbeat of your novel\b/i.test(last) &&
      (/\bcharacter dossiers\b/i.test(last) ||
        /\bReady for the character\b/i.test(last));
    if (isBridging) {
      lines.pop();
    }
  }

  while (lines.length && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length && /^\s*---\s*$/.test(lines[lines.length - 1])) {
    lines.pop();
    while (lines.length && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
  }
  return lines.join("\n").trimEnd();
}

/**
 * Show only the 📘 Story Bible document body — skip Olivia chat above the title line,
 * and exclude "CHARACTER DOSSIERS — 17-Point Dossiers" onward.
 */
export function sliceStoryBibleForDisplay(text) {
  const full = String(text || "").replace(/\r\n/g, "\n");
  if (!full.trim()) return "";

  const lines = full.split("\n");
  const titleLine = (line) =>
    /📘\s*Story\s+Bible/i.test(line) ||
    /📘\s*StoryGroove\.ai(?:™|TM|\u2122)?\s*Master\s+Prompt\s+for\s+Novel\s+Architecture/i.test(
      line
    );
  const dossiersHeadingLine = (line) =>
    /CHARACTER\s+DOSSIERS/i.test(line) &&
    /17[\s-]*Point\s*Dossiers/i.test(line);

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (titleLine(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return full.trim();

  let endLine = lines.length;
  for (let i = startLine; i < lines.length; i++) {
    if (dossiersHeadingLine(lines[i])) {
      endLine = i;
      break;
    }
  }

  const sliced = lines.slice(startLine, endLine).join("\n").trim();
  return stripStoryBibleBridgingFooter(sliced);
}
