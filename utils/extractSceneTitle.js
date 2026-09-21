/**
 * Short outline label from rich scene body (UserContent.sceneTitle, outline sidebar).
 * Mirrors frontend BookEditor/utils getSceneTitleTextStrict: Scene Title line, then bare line
 * between Target Word Count and Scene to Write — not Scene to Write content as title.
 */

const MAX_TITLE_LEN = 120;

/**
 * Strip lightweight markdown / quotes from a single-line title.
 */
export const normalizeSceneTitleLine = (line) => {
  if (!line) return "";
  let s = String(line).trim().replace(/\*/g, "");
  while (/^_+/.test(s)) s = s.replace(/^_+/, "").trim();
  while (/_+$/.test(s)) s = s.replace(/_+$/, "").trim();
  s = s.replace(/^["'""'']+|["'""'']+$/g, "").trim();
  return s.trim();
};

/**
 * Bare title between Target Word Count and Scene to Write (same idea as FE extractBareSceneTitle).
 */
export const extractBareSceneTitle = (text) => {
  if (!text) return "";
  const twcIdx = text.search(/📏\s*Target Word Count/i);
  const stwIdx = text.search(/📝\s*Scene to Write/i);
  if (twcIdx === -1 || stwIdx === -1 || twcIdx >= stwIdx) return "";

  const window = text.slice(twcIdx, stwIdx);
  for (const raw of window.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/📏|Target Word Count|\d+\s*words/i.test(line)) continue;
    if (/^[*#\-_>|]/.test(line)) continue;
    if (/[*_`#]/.test(line)) continue;
    const words = line.split(/\s+/).filter(Boolean).length;
    if (words >= 1 && words <= 12 && !line.includes(":")) {
      return normalizeSceneTitleLine(line);
    }
  }
  return "";
};

const STOP_WORDS = /^(the|this|a|an|that|each|every|we|they|it|one|some|both|all|her|his|its|our|your|their)$/i;

/**
 * Strip bold / italic markdown so regex word-boundaries work on names like **David**.
 */
const stripMd = (s) => s.replace(/\*{1,2}/g, "").replace(/_{1,2}/g, "");

/**
 * Validate a candidate POV name: non-empty, not a stop word, at least 2 chars.
 */
const validName = (raw) => {
  if (!raw) return "";
  const name = stripMd(raw).trim();
  if (!name || name.length < 2 || STOP_WORDS.test(name)) return "";
  return name.slice(0, 60);
};

/**
 * Try a list of regexes against a block of text; return the first valid name.
 */
const tryPatterns = (block, patterns) => {
  for (const re of patterns) {
    const m = block.match(re);
    if (m?.[1]) {
      const name = validName(m[1]);
      if (name) return name;
    }
  }
  return "";
};

/**
 * Extract a character name from the leading subject of a bullet line.
 * Handles bold-wrapped names and a broad set of interiority verbs.
 */
const extractBulletSubject = (bulletText) => {
  if (!bulletText) return "";
  const plain = stripMd(bulletText).trim();
  const m = plain.match(
    /^(\w[\w'-]*(?:\s+\w[\w'-]*)?)\s+(?:feels?|realizes?|struggles?|grapples?|confronts?|senses?|notices?|experiences?|wrestles?|faces?|begins?|tries?|wants?|needs?|decides?|discovers?|learns?|sees?|knows?|understands?|watches?|thinks?|wonders?|fears?|hopes?|believes?|recognizes?|accepts?|fights?|resists?|pushes?|pulls?|holds?|keeps?|hides?|masks?|suppresses?|absorbs?|processes?|weighs?|considers?|questions?|doubts?|regrets?|grieves?|mourns?|aches?|longs?|yearns?|craves?|recoils?|freezes?|stiffens?|softens?|steadies?|braces?|steels?|wavers?|hesitates?|retreats?|advances?|commits?|chooses?|refuses?|relents?|surrenders?|deflects?|projects?|internalizes?|compartmentalizes?|rationalizes?|clings?|releases?|lets?|grasps?|reaches?|withdraws?|opens?|closes?|shuts?|locks?|unlocks?|guards?|drops?|carries?|shoulders?|bears?|endures?|survives?|thrives?|spirals?|unravels?|fractures?|breaks?|cracks?|shatters?|rebuilds?|mends?|heals?|hardens?|numbs?|awakens?|stirs?|shifts?|turns?|moves?|steps?|stands?|sits?|remains?|stays?|lingers?|pauses?|stops?|starts?|continues?|returns?|arrives?|enters?|exits?|leaves?|crosses?|walks?|runs?|drives?|rides?|flies?|falls?|rises?|climbs?|descends?|emerges?|surfaces?|sinks?|drifts?|floats?|swims?|dives?|plunges?|leaps?|jumps?|lands?|crashes?|collides?|stumbles?|trips?|slips?|slides?|tumbles?|rolls?|spins?|whirls?|twists?|is\s)/i
  );
  return m?.[1] ? validName(m[1]) : "";
};

/**
 * Heuristic: extract the POV character name from a rich scene responseText.
 * Checks (in priority order):
 *   1. Explicit "POV:" line
 *   2. Book Coaching natural-language POV references
 *   3. Character Arc Movement leading subject
 *   4. Emotional Reactions first-bullet leading subject
 *   5. Significant Actions first-bullet leading subject (weakest signal)
 * Returns the character name string or "" if not found.
 */
export const extractScenePov = (text) => {
  if (!text || typeof text !== "string") return "";
  const t = text.replace(/\r\n/g, "\n");

  // 1. Explicit POV line (highest confidence)
  const explicitPov = t.match(/(?:^|\n)\s*\*{0,2}\s*POV\s*\*{0,2}\s*:\s*([^\n]+)/i);
  if (explicitPov?.[1]) {
    const name = validName(explicitPov[1]);
    if (name) return name;
  }

  // 1b. Inline chapter-header POV ("Chapter One – POV: Myla", "1.5 — POV: Myla")
  const inlineHeaderPov = t.match(
    /[–—-]\s*\*{0,2}\s*POV\s*\*{0,2}\s*:\s*([^\n]+)/i
  );
  if (inlineHeaderPov?.[1]) {
    const name = validName(inlineHeaderPov[1]);
    if (name) return name;
  }

  // 2. Book Coaching section — broad pattern set
  const coachingMatch = t.match(/📘\s*Book Coaching for Scene\s*:\s*([\s\S]*?)(?=\n\s*(?:🎭|🧩|📏|📝|🏰|⚡|💔|🔗|📈)|$)/i);
  if (coachingMatch?.[1]) {
    const block = stripMd(coachingMatch[1]);
    const found = tryPatterns(block, [
      /(?:told|written|delivered|experienced|filtered|narrated|rendered|played)\s+(?:through|from|via|in)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'s\s+(?:POV|perspective|point of view|lens|eyes|voice|head|interiority|interior)/i,
      /(\w[\w'-]*(?:\s+\w[\w'-]*)?)'s\s+(?:POV|perspective|point of view|lens|eyes|voice|interior(?:ity)?|head|vantage|viewpoint|camera)/i,
      /(?:POV|perspective|point of view|lens|viewpoint|camera)\s+(?:is|belongs to|stays with|follows|remains with|shifts to|moves to|rests with|centers on|lands on)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)/i,
      /(?:camera|reader|we|audience)\s+(?:stays?|remain|follow|are|live|sit)\s+(?:with|inside|in)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)/i,
      /(?:scene|chapter|beat)\s+(?:is|belongs)\s+(?:told from|filtered through|anchored in|grounded in|rooted in|seen through|viewed through)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'?s?/i,
      /(?:anchored|grounded|rooted|centered|filtered|situated|embedded|locked)\s+(?:in|within|inside|through)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'s\s+(?:POV|perspective|point of view|lens|eyes|experience|interior(?:ity)?|head|consciousness|psyche|subjectivity|world)/i,
      /(?:through|from|via|in)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'s\s+(?:eyes|lens|perspective|POV|point of view|interior(?:ity)?|experience|vantage|viewpoint|head)/i,
      /(?:this is|this scene is|this belongs to|this centers on|scene belongs to|scene centers on)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'?s?\s+(?:scene|POV|moment|beat|territory)/i,
      /(\w[\w'-]*(?:\s+\w[\w'-]*)?)\s+(?:is the|serves as the|acts as the|becomes the)\s+(?:POV|viewpoint|focal|lens|perspective)\s+(?:character|figure)/i,
      /(?:stay|remain|keep|keep us|ground us|anchor us|hold us|sit)\s+(?:in|inside|within|close to)\s+(\w[\w'-]*(?:\s+\w[\w'-]*)?)'s\s+(?:head|POV|perspective|interior(?:ity)?|experience|world|consciousness)/i,
    ]);
    if (found) return found;
  }

  // 3. Character Arc Movement — leading subject
  const arcMatch = t.match(/📈\s*Character Arc Movement\s*:?\s*\n?([\s\S]*?)(?=\n\s*(?:---|👉|\.[ \t]*$)|$)/i);
  if (arcMatch?.[1]) {
    const plain = stripMd(arcMatch[1]).trim();
    const nameAtStart = plain.match(/^(\w[\w'-]*(?:\s+\w[\w'-]*)?)\s+(?:moves?|shifts?|begins?|starts?|transitions?|goes|evolves?|grows?|confronts?|realizes?|faces?|learns?|discovers?|accepts?|rejects?|chooses?|commits?|opens?|closes?|retreats?|advances?|wrestles?|struggles?|grapples?|pushes?|pulls?|crosses?|takes?|makes?|reaches?|enters?|steps?|turns?|breaks?|cracks?|softens?|hardens?|recognizes?|understands?|sees?|is\s)/i);
    if (nameAtStart?.[1]) {
      const name = validName(nameAtStart[1]);
      if (name) return name;
    }
  }

  // 4. Emotional Reactions — first bullet leading subject
  const emotionalMatch = t.match(/💔\s*Emotional Reactions[^\n]*:\s*\n([\s\S]*?)(?=\n\s*(?:🔗|📈)|$)/i);
  if (emotionalMatch?.[1]) {
    const firstBullet = emotionalMatch[1].match(/^\s*[-•]\s*(.+)/m);
    if (firstBullet?.[1]) {
      const name = extractBulletSubject(firstBullet[1]);
      if (name) return name;
    }
  }

  // 5. Significant Actions — first bullet leading subject (weakest)
  const actionsMatch = t.match(/⚡\s*Significant Actions[^\n]*:\s*\n([\s\S]*?)(?=\n\s*(?:💔|🔗|📈)|$)/i);
  if (actionsMatch?.[1]) {
    const firstBullet = actionsMatch[1].match(/^\s*[-•]\s*(.+)/m);
    if (firstBullet?.[1]) {
      const name = extractBulletSubject(firstBullet[1]);
      if (name) return name;
    }
  }

  return "";
};

/**
 * Returns a concise title string, or "" if none could be inferred (callers may default by act/scene).
 */
export const extractSceneTitle = (text) => {
  if (!text || typeof text !== "string") return "";

  const t = text.replace(/\r\n/g, "\n");

  const labeled = t.match(
    /(?:^|\n)[ \t]*(?:\*{0,2})?[ \t]*Scene Title[ \t]*(?:\*{0,2})?[ \t]*:[ \t]*([^\n]+)/i
  );
  if (labeled?.[1]) {
    const line = normalizeSceneTitleLine(labeled[1]);
    if (line) return line.slice(0, MAX_TITLE_LEN);
  }

  const bare = extractBareSceneTitle(t);
  if (bare) return bare.slice(0, MAX_TITLE_LEN);

  return "";
};
