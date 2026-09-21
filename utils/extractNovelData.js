import { stripMarkdown } from "./stripMarkdown.js";

/**
 * Strip Olivia's closing bridge/CTA text that appears after the last character dossier.
 * e.g. "🎭 Here are your full 17-point character dossiers…" and "📘 Keep a copy for yourself…"
 */
export const stripDossierTrailingBridge = (text) => {
  if (!text || typeof text !== "string") return text;
  return (
    text
      .replace(/\n*🎭\s*Here are your full[\s\S]*/i, "")
      .replace(/\n*📘\s*Keep a copy for yourself[\s\S]*/i, "")
      // Trailing horizontal-rule separator (---, ___, ***) belongs to the NEXT dossier in
      // the masterPrompt, not this one — the slicer just happens to include it because it
      // sits before the next **👤 Name:** header. Strip it and any surrounding whitespace.
      // Repeat to catch cases like `\n---\n***` or multiple stacked rules.
      .replace(/(?:\s*\n\s*(?:-{3,}|_{3,}|\*{3,})\s*)+\s*$/g, "")
      .trimEnd()
  );
};

/**
 * Olivia occasionally re-emits the same dossier twice in one message — once properly
 * formatted, then again as plain text without the **👤 Name: 17-Point Dossier** header.
 * The second copy lacks the header so the regex can't detect it as a separate dossier;
 * it gets absorbed into the first dossier's slice.
 *
 * Duplicate signatures (any of these appearing 2+ times inside a slice means the dossier
 * was emitted twice). Very permissive about bullet/bold/emoji formatting in between:
 *   - Section-1 heading:  "1. Archetype"  (with optional emoji 🧬, bullets, bold)
 *   - Summary heading:    "📖 Summary Note"
 *   - Internal heading with emoji: "👤 Physical Description" (section 3)
 */
const SECTION_ONE_MARKER_RE = /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?(?:\*\*)?[ \t]*1\.[^\n]{0,12}Archetype/gi;
const SUMMARY_NOTE_MARKER_RE = /(?:^|\n)[ \t]*(?:\*\*)?[ \t]*📖\s*(?:\*\*)?\s*Summary\s+Note/gi;

const collectAllMatches = (text, regex) => {
  const re = new RegExp(regex.source, regex.flags);
  const positions = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    positions.push(m.index);
    // Guard against zero-width matches that would loop forever.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return positions;
};

/**
 * If the text contains a duplicated dossier, return the text truncated to just the first copy.
 * The cut point is the SECOND Section-1 heading (start of dossier #2). Summary-Note is NOT
 * used for cutting — its second occurrence is mid-dossier-#2, so cutting there would keep
 * most of the duplicate. Summary-Note is still useful for detection.
 */
export const trimDuplicatedDossierSections = (text) => {
  if (!text || typeof text !== "string") return text;
  const sectionOnePositions = collectAllMatches(text, SECTION_ONE_MARKER_RE);
  if (sectionOnePositions.length >= 2) {
    return text.slice(0, sectionOnePositions[1]).trimEnd();
  }
  return text;
};

/**
 * Full dossier-text cleanup pipeline — idempotent:
 *   1. Strip Olivia's trailing bridge / CTA text and any trailing horizontal-rule separators.
 *   2. If the text still contains a duplicated dossier, cut at the second Section-1 heading.
 *   3. Strip trailing separators one more time in case step 2's truncation revealed more.
 * Returns the input unchanged if nothing needs fixing, so repeated calls are safe.
 */
export const normalizeDossierText = (text) => {
  if (!text || typeof text !== "string") return text;
  let out = stripDossierTrailingBridge(text);
  out = trimDuplicatedDossierSections(out);
  out = stripDossierTrailingBridge(out);
  return out;
};

/** True if the passed text contains a duplicated dossier copy. */
export const hasDuplicateDossierContent = (text) => {
  if (!text || typeof text !== "string") return false;
  for (const pat of [SECTION_ONE_MARKER_RE, SUMMARY_NOTE_MARKER_RE]) {
    if (collectAllMatches(text, pat).length >= 2) return true;
  }
  return false;
};

/**
 * True only when Olivia re-emitted a full dossier twice (both section-1 and
 * Summary Note appear 2+ times). A writer-pasted bio that happens to mention
 * "1. Archetype" again must not match — that was truncating imported cast notes.
 */
export const isOliviaDuplicatedDossier = (text) => {
  if (!text || typeof text !== "string") return false;
  return (
    collectAllMatches(text, SECTION_ONE_MARKER_RE).length >= 2 &&
    collectAllMatches(text, SUMMARY_NOTE_MARKER_RE).length >= 2
  );
};

/**
 * Plain "Title & Word Count" block (often not **bold**). Supports Unicode ampersand ＆,
 * optional ### / **, and --- / next-section boundaries.
 */
const extractPlainTitleWordCountBlock = (fullText) => {
  if (!fullText || typeof fullText !== "string") return "";
  const amp = "(?:&|and|＆)";
  const re = new RegExp(
    `(?:^|[\\r\\n])\\s*(?:#{1,3}\\s*)?(?:\\*\\*)?\\s*Title\\s*${amp}\\s*Word\\s*Count\\s*(?:\\*\\*)?\\s*(?:\\r?\\n|$)`,
    "i"
  );
  const m = re.exec(fullText);
  if (!m) return "";
  const rest = fullText.slice(m.index + m[0].length);
  const stops = [
    rest.search(/\r?\n-{3,}\s*\r?\n/),
    rest.search(/\r?\n_{3,}\s*\r?\n/),
    rest.search(/\r?\n\*{3,}\s*\r?\n/),
    rest.search(/\r?\n(?=[\u{1F4DA}]\\s|##\\s|\\*\\*[\u{1F4DA}])/u),
  ].filter((i) => i >= 0);
  const end = stops.length ? Math.min(...stops) : rest.length;
  return rest.slice(0, end).trim();
};

/** Last-resort: find Title/Word block without relying on --- (some models omit separators). */
const extractTitleWordCountLoose = (fullText) => {
  if (!fullText || typeof fullText !== "string") return "";
  const amp = "(?:&|and|＆)";
  const re = new RegExp(
    `Title\\s*${amp}\\s*Word\\s*Count\\s*\\r?\\n([\\s\\S]{0,8000}?)` +
      `(?=\\r?\\n\\s*(?:-{3,}|_{3,}|\\*{3,})\\s*\\r?\\n|\\r?\\n\\s*#{1,3}\\s|📚\\s|Story\\s+Context|Market\\s+Positioning|\\*\\*📚|$)`,
    "i"
  );
  const m = fullText.match(re);
  return m ? m[1].trim() : "";
};

/**
 * "Author: …" / "Author：…" inside a Title & Word Count block (line or inline).
 */
function extractStoryBibleAuthorFromBlock(titleSection) {
  if (!titleSection || typeof titleSection !== "string") return "";
  for (const line of titleSection.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\*\*)?\s*author\s*[:：]\s*(.+)$/i);
    if (m) return stripMarkdown(m[1].trim());
  }
  const loose = titleSection.match(/\bauthor\s*[:：]\s*([^\r\n]+)/i);
  if (loose) return stripMarkdown(loose[1].trim());
  return "";
}

/**
 * Bold **Title & Word Count** often ends at the next ** heading before Author is emitted.
 * Plain "Title & Word Count" under 📘 Story Bible usually has the full block — try those first,
 * then scan every Title & Word Count region in the document.
 */
function collectStoryBibleAuthorFromText(text, sections) {
  const plain = extractPlainTitleWordCountBlock(text);
  const loose = extractTitleWordCountLoose(text);
  const sectionBlock = sections["title & word count"] || "";
  const candidates = [plain, loose, sectionBlock].filter(
    (b) => b && String(b).trim()
  );
  const seen = new Set();
  for (const raw of candidates) {
    const t = String(raw).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const a = extractStoryBibleAuthorFromBlock(t);
    if (a) return a;
  }
  return extractStoryBibleAuthorByScanningTitleRegions(text);
}

/**
 * For each "Title & Word Count" heading in the full document, take the following lines until a
 * known section boundary and look for Author (handles duplicate blocks from Outline + Story Bible).
 */
function extractStoryBibleAuthorByScanningTitleRegions(fullText) {
  if (!fullText || typeof fullText !== "string") return "";
  const normalized = fullText.replace(/\r\n/g, "\n");
  const headerRe =
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*Title\s*(?:&|and|＆)\s*Word\s*Count(?:\*\*)?\s*(?:\n|$)/gi;
  let m;
  while ((m = headerRe.exec(normalized)) !== null) {
    const start = m.index + m[0].length;
    const rest = normalized.slice(start);
    const stopRe =
      /\n(?=\s*(?:📚|🧱|##\s|###\s|\*\*📚|CHARACTER\s+DOSSIERS|Market\s+Positioning|Story\s+Context\b|📘\s*Story\s+Bible\b))/i;
    const sm = stopRe.exec(rest);
    const slice = sm ? rest.slice(0, sm.index) : rest.slice(0, 4000);
    const a = extractStoryBibleAuthorFromBlock(slice);
    if (a) return a;
  }
  return "";
}

/**
 * Extracts novel data from Olivia's response text.
 * Handles both JSON responses and the markdown Story Bible / Master Prompt format
 * with headings like **Title**, **Word Count**, **Genre & Modifiers**, **Protagonists**, etc.
 */
export const extractNovelDataFromResponse = (oliviaResponse) => {
  const text = typeof oliviaResponse === "string" ? oliviaResponse : String(oliviaResponse || "");
  // Only treat the *entire* payload as JSON. A greedy `{...}` match inside Story Bible / master prompt
  // text could parse a tiny embedded JSON snippet and skip markdown extraction (empty name).
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const jsonAuthor = stripMarkdown(
          String(parsed.storyBibleAuthor ?? parsed.author ?? "").trim()
        );
        return {
          setting: stripMarkdown(String(parsed.setting || "")),
          narrativeStyle: stripMarkdown(String(parsed.narrativeStyle || "")),
          genre: stripMarkdown(String(parsed.genre || "")),
          wordCount: parsed.wordCount || 0,
          protagonist: stripMarkdown(String(parsed.protagonist || "")),
          protagonistDescription: stripMarkdown(
            String(parsed.protagonistDescription || "")
          ),
          antagonist: stripMarkdown(String(parsed.antagonist || "")),
          antagonistMotivation: stripMarkdown(
            String(parsed.antagonistMotivation || "")
          ),
          theme: stripMarkdown(String(parsed.theme || "")),
          themeExploration: stripMarkdown(String(parsed.themeExploration || "")),
          supportingCharacters: parsed.supportingCharacters || [],
          subplot: stripMarkdown(String(parsed.subplot || "")),
          summary: stripMarkdown(String(parsed.summary || "")),
          compTitles: parsed.compTitles || [],
          name: stripMarkdown(String(parsed.name || "")),
          bookIdea: stripMarkdown(String(parsed.bookIdea || "")),
          worldBuilding: stripMarkdown(String(parsed.worldBuilding || "")),
          specialElements: stripMarkdown(String(parsed.specialElements || "")),
          storyBibleAuthor: jsonAuthor,
        };
      }
    }
  } catch {
    // Not whole-document JSON, continue with markdown parsing
  }

  // Parse sections from the markdown MASTER PROMPT.
  // Splits on **Heading:** patterns, capturing multi-line content per section.
  // Normalizes keys: strips leading "1. " numbering and leading emoji characters
  // so numbered headings like "**1. Genre**" resolve the same as "**Genre**".
  const normalizeKey = (raw) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/^\d+\.\s*/, "")
      .replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\s]+/gu, "")
      .trim();

  const sections = {};
  /**
   * Only treat **Title** as a section boundary when it starts a line (after optional whitespace),
   * or follows a markdown heading (### …) on the same line. Inline emphasis like
   * `Invented/speculative technology: **HuBots** (...)` must NOT split the section.
   */
  const isStructuralBoldSectionStart = (fullText, startIdx) => {
    const lineStart = startIdx <= 0 ? 0 : fullText.lastIndexOf("\n", startIdx - 1) + 1;
    const linePrefix = fullText.slice(lineStart, startIdx);
    if (/^\s*$/.test(linePrefix)) return true;
    if (/^\s*#{1,6}\s*$/.test(linePrefix)) return true;
    return false;
  };

  const sectionRegex = /\*\*([^*]+)\*\*[:\s]*/g;
  const sectionStarts = [];
  let m;
  while ((m = sectionRegex.exec(text)) !== null) {
    if (!isStructuralBoldSectionStart(text, m.index)) continue;
    const rawKey = m[1].trim().toLowerCase();
    const normalizedKey = normalizeKey(rawKey);
    sectionStarts.push({ key: normalizedKey, rawKey, index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < sectionStarts.length; i++) {
    const nextStart = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : text.length;
    const content = text.slice(sectionStarts[i].end, nextStart).trim();
    sections[sectionStarts[i].key] = content;
    if (sectionStarts[i].rawKey !== sectionStarts[i].key) {
      sections[sectionStarts[i].rawKey] = content;
    }
  }

  const get = (...keys) => {
    for (const k of keys) {
      for (const [sectionKey, val] of Object.entries(sections)) {
        if (sectionKey === k || sectionKey.startsWith(k) || k.startsWith(sectionKey)) {
          const stripped = stripMarkdown(val);
          if (stripped) return stripped;
        }
      }
    }
    return "";
  };

  const getFirstLine = (...keys) => {
    const val = get(...keys);
    if (!val) return "";
    // Strip leading bullet characters (•, -, *) produced by the Cast section format
    const firstLine = val.split("\n")[0].replace(/^[•\-\*]\s*/, "");
    // Trim after first em-dash or long dash to get just the name
    const dashIdx = firstLine.search(/[—–-]{1,2}\d|[—–]\s/);
    return dashIdx > 0 ? firstLine.slice(0, dashIdx).trim() : firstLine.replace(/,.*/, "").trim();
  };

  /** First non-empty line (skips blank lines after ** headings). */
  const firstNonEmptyLine = (raw) => {
    if (!raw) return "";
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t) return t;
    }
    return "";
  };

  /**
   * Pull word count from the "Title & Word Count" block without mis-reading a title
   * line like "90/10" as a number (second-line heuristic used to capture "90" only).
   */
  const extractWordCountFromTitleSection = (titleSection) => {
    if (!titleSection) return null;
    // Prefer explicit Approx / approximately anywhere in the section
    const approxMatch = titleSection.match(
      /(?:approx\.?|approximately|~)\s*[:\s]*(\d[\d,]+)/i
    );
    if (approxMatch) {
      const n = parseInt(approxMatch[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    // e.g. "95,000 words" without "Approx."
    const wordsLineMatch = titleSection.match(/(\d[\d,]+)\s*words?\b/i);
    if (wordsLineMatch) {
      const n = parseInt(wordsLineMatch[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  };

  // Extract a word count number from anywhere in the text
  const extractWordCount = () => {
    const wcSection = get("word count", "wordcount", "target word count");
    if (wcSection) {
      const num = wcSection.match(/(\d[\d,]*)/);
      if (num) {
        const n = parseInt(num[1].replace(/,/g, ""), 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      }
    }
    // Bold **Title & Word Count** sections, or plain-text block (official template example)
    const titleSection =
      sections["title & word count"] ||
      extractPlainTitleWordCountBlock(text) ||
      extractTitleWordCountLoose(text) ||
      get("title & word count");
    const fromTitle = extractWordCountFromTitleSection(titleSection);
    if (fromTitle !== null) return fromTitle;

    const globalMatch = text.match(/(?:word count|approximately|approx\.?|~)\s*[:\s]*(\d[\d,]*)/i);
    if (globalMatch) {
      const n = parseInt(globalMatch[1].replace(/,/g, ""), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return 0;
  };

  const extractCompTitles = () => {
    const raw = get("comparable titles", "comp titles", "comparables");
    if (!raw) return [];
    return raw
      .split("\n")
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("[not"));
  };

  // Parse every 17-Point Character Dossier block from the Olivia output.
  // Uses the shared canonical parser so creation and lazy-heal see the exact same set.
  const characterDossiers = parseCharacterDossiersFromText(text);

  // Derive protagonist/antagonist names for Novel model fields.
  // Prefer Cast section (used by story generation prompts), fall back to dossier.
  const protagonistFromDossier = characterDossiers.find((c) => c.characterType === "protagonist");
  const antagonistFromDossier = characterDossiers.find((c) => c.characterType === "antagonist");
  const protagonistName =
    getFirstLine("protagonists", "protagonist") || (protagonistFromDossier?.name ?? "");
  const antagonistName =
    getFirstLine("antagonist characters", "antagonists", "antagonist", "antagonists & antagonistic forces", "opposing force") ||
    (antagonistFromDossier?.name ?? "");

  // Derive supportingCharacters for the Novel model from dossier entries
  const supportingCharacters = characterDossiers
    .filter((c) => c.characterType === "supporting character")
    .map((c) => ({ name: c.name, role: c.roleInStory, significance: c.roleInStory }));

  const rawTitleBlock =
    sections["title & word count"] ||
    extractPlainTitleWordCountBlock(text) ||
    extractTitleWordCountLoose(text) ||
    "";
  const titleBlockForName = stripMarkdown(rawTitleBlock);
  const shortTitle = sections["title"] ? stripMarkdown(sections["title"]) : "";
  const name = firstNonEmptyLine(titleBlockForName || shortTitle);

  const storyBibleAuthorFromTitleBlock = collectStoryBibleAuthorFromText(
    text,
    sections
  );
  const authorFromBoldSection = stripMarkdown(
    sections["author"] || sections["author name"] || ""
  );
  const storyBibleAuthor =
    storyBibleAuthorFromTitleBlock || authorFromBoldSection;

  return {
    name,
    bookIdea: get("story summary", "story summary (brain dump)", "core premise", "premise", "summary of the novel"),
    setting: get("setting", "setting / world", "setting / world / time period"),
    narrativeStyle: get("narrative pov (lens)", "narrative pov", "narrative pov & character lenses", "narrative style", "narrativestyle", "tone"),
    genre: get("genre", "genre & modifiers", "genre & tone", "genre and tone"),
    wordCount: extractWordCount(),
    protagonist: protagonistName,
    protagonistDescription: get("protagonists", "protagonist"),
    antagonist: antagonistName,
    antagonistMotivation: get("antagonist motivation", "antagonist characters", "antagonists", "antagonist", "antagonists & antagonistic forces"),
    theme: get("theme"),
    themeExploration: get("theme exploration", "theme"),
    supportingCharacters,
    subplot: get("subplot threads", "subplot", "subplots", "subplot signals"),
    summary: get("story summary", "story summary (brain dump)", "summary", "summary of the novel", "core premise", "core conflict"),
    compTitles: extractCompTitles(),
    characterDossiers,
    worldBuilding: get("world building", "world-building", "worldbuilding"),
    specialElements: get("special elements", "special-elements"),
    storyBibleAuthor,
  };
};

/**
 * Canonical parser for Olivia's 17-point character dossier blocks.
 *
 * Matches the format described in olivia.txt (bold-only per-character header) and tolerates
 * common drift (optional ## heading, `-`/`–`/`—` instead of `:`, `17 Point` spacing).
 * Examples matched:
 *   **👤 Name: 17-Point Dossier**
 *   ## **👤 Name: 17-Point Dossier**
 *   **👤 Name — 17-Point Dossier**
 *   **👤 Name: 17 Point Dossier**
 *
 * Classification rules (forward-only; does not rewrite existing Character docs):
 *   - roleInStory matches /^\s*protagonist\b/i  → "protagonist"
 *   - roleInStory matches /^\s*antagonist\b/i   → "antagonist"
 *   - everything else → "supporting character"
 * Multiple protagonists and antagonists in one document are allowed.
 *
 * @returns {Array<{ name: string, roleInStory: string, characterType: string, dossierText: string }>}
 */
export const parseCharacterDossiersFromText = (text) => {
  if (!text || typeof text !== "string") return [];

  const re = /(?:^|\n)(?:#{1,3}\s*)?\*\*\s*👤\s*([^*\n]+?)\s*[:\-–—]\s*17[\s-]*Point\s+Dossier\s*\*\*/gi;
  const rawMatches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = (m[1] || "").trim();
    // Skip the section title line **👤 CHARACTER DOSSIERS — 17-Point Dossiers**
    if (!name || /CHARACTER\s+DOSSIERS/i.test(name)) continue;
    rawMatches.push({ name, index: m.index });
  }
  if (rawMatches.length === 0) return [];

  // Dedupe by normalized name (keep first occurrence). Handles the case where Olivia
  // re-emits the same character twice with proper headers. IMPORTANT: slicing boundaries
  // must use the rawMatches index so a duplicate header acts as the end-of-slice for the
  // kept copy — otherwise the duplicate content gets absorbed into the previous slice.
  const seenNames = new Set();
  const keepMask = rawMatches.map((entry) => {
    const key = entry.name.toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  const results = [];
  for (let i = 0; i < rawMatches.length; i++) {
    if (!keepMask[i]) continue;
    const entry = rawMatches[i];
    const start = entry.index;
    // Use the NEXT rawMatch index (kept or not) as the hard boundary.
    const end = i + 1 < rawMatches.length ? rawMatches[i + 1].index : text.length;
    const dossierText = trimDuplicatedDossierSections(
      stripDossierTrailingBridge(text.slice(start, end).trim())
    );

    // Extract "Role in the Story:" from the dossier block.
    // The line looks like: - **Role in the Story:** **Protagonist and sole narrator** — description
    const roleMatch = dossierText.match(
      /\*\*Role in the Story[:\s]*\*\*[:\s]*\*{0,2}([^\n*]+)/i
    );
    const rawRole = roleMatch ? roleMatch[1].replace(/\*{1,3}/g, "").trim() : "";
    const dashIdx = rawRole.search(/\s*[—–]\s*/);
    const afterDash = dashIdx > 0 ? rawRole.slice(0, dashIdx).trim() : rawRole;
    const roleInStory = afterDash.split(/\b(?:whose|who|that|which|and|with)\b/i)[0].replace(/[,\s]+$/, "").trim() || afterDash;

    // Strict start-of-role classification avoids false matches like "ally to the protagonist".
    let characterType = "supporting character";
    if (/^\s*protagonist\b/i.test(roleInStory)) {
      characterType = "protagonist";
    } else if (/^\s*antagonist\b/i.test(roleInStory)) {
      characterType = "antagonist";
    }

    results.push({ name: entry.name, roleInStory, characterType, dossierText });
  }
  return results;
};

/**
 * Backwards-compatible alias. Same behavior as parseCharacterDossiersFromText.
 * Kept so existing imports (e.g. novelController.js) do not have to change.
 */
export const extractCharacterDossierBlocksFromMasterPrompt = parseCharacterDossiersFromText;

const DOSSIER_HEADER_NAME_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?\*{0,2}\s*👤\s*([^*\n]+?)\s*[:\-–—]\s*17[\s-]*Point\s+Dossier\s*\*{0,2}/i;

const DOSSIER_BULLET_NAME_RE =
  /(?:^|\n)[ \t]*(?:[-•*][ \t]+)?\*{0,2}Name\*{0,2}[ \t]*:[ \t]*([^\n]+)/i;

/** Heading + Basic Information live at the top — do not scan a pasted novel. */
export const DOSSIER_NAME_SCAN_CHARS = 8000;

const cleanExtractedDossierName = (raw) => {
  const name = String(raw || "")
    .replace(/\*{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || /^\[.*\]$/.test(name)) return "";
  if (/CHARACTER\s+DOSSIERS/i.test(name)) return "";
  return name.slice(0, 120);
};

/**
 * Read the character's canonical name from a single 17-point dossier body.
 * Prefers the `👤 Name: 17-Point Dossier` title, then the `Name:` bullet.
 * Tolerates markdown and plain innerText (bold markers stripped).
 */
export const extractCharacterNameFromDossier = (text) => {
  if (!text || typeof text !== "string") return "";
  const scan = text.length > DOSSIER_NAME_SCAN_CHARS
    ? text.slice(0, DOSSIER_NAME_SCAN_CHARS)
    : text;
  const header = scan.match(DOSSIER_HEADER_NAME_RE);
  const fromHeader = cleanExtractedDossierName(header?.[1]);
  if (fromHeader) return fromHeader;
  const bullet = scan.match(DOSSIER_BULLET_NAME_RE);
  return cleanExtractedDossierName(bullet?.[1]);
};


