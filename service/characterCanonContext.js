/**
 * Story-bible and character-dossier context for Olivia V2.
 * Sources (in priority order): masterPrompt dossiers, Character.responseText,
 * Character structured fields, Novel cast fields (protagonistDescription, etc.).
 *
 * When full-canon mode is on and `masterPrompt` exists, we inject the entire bible
 * (legacy `structuralOverlay` parity) instead of thin slices.
 */

import { parseCharacterDossiersFromText } from "../utils/extractNovelData.js";
import { isOliviaFullCanonContextEnabled } from "../constants/oliviaMemory.js";

const DOSSIER_HEADER_RE =
  /(?:^|\n)(?:#{1,3}\s*)?\*\*\s*👤\s*[^*\n]+?\s*[:\-–—]\s*17[\s-]*Point\s+Dossier\s*\*\*/gi;

export const FOCUS_CHARACTER_DOSSIER_CHARS = 1100;
export const CANON_QUERY_DOSSIER_CHARS = 4500;
/** 0 = no truncate — full dossier for explicitly mentioned characters. */
export const MENTIONED_CHARACTER_DOSSIER_CHARS = 0;
/**
 * Per-character dossier cap used on scene-delivery turns when fullCanon
 * is not on. Wider than the focus-only default so the Beat Specificity
 * and Subplot-to-Beat Translation methodology rules have enough Story
 * Bible material to dramatize for every named supporting character.
 */
export const SCENE_DELIVERY_DOSSIER_CHARS = 2000;
export const STORY_BIBLE_CANON_EXCERPT_CHARS = 5500;
export const STORY_BIBLE_LIGHT_EXCERPT_CHARS = 1200;
export const NOVEL_FOUNDATION_MAX_CHARS = 2800;
/** Full Story Bible block cap (chars). Sized so a long dossier-free bible is
 * sent whole in full-canon mode; the global token budget is the real limiter. */
export const FULL_STORY_BIBLE_MAX_CHARS = 30000;
/** Per-character dossier cap in full-canon mode (generous; demotion trims episodic first). */
export const FULL_CHARACTER_DOSSIER_CHARS = 12000;

const DOSSIER_IN_MP_RE = /\*\*👤\s*[^*]+:\s*17-Point Dossier/i;

export const truncateText = (text, maxChars) => {
  const s = String(text || "").trim();
  if (!s || !maxChars || s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 3)}...`;
};

const castNameFromNovelField = (value) => {
  if (!value || typeof value !== "string") return "";
  const line = value.split(/\r?\n/).find((l) => l.trim()) || "";
  return line.replace(/^\*+|\*+$/g, "").trim().slice(0, 300);
};

/**
 * Rich novel metadata when masterPrompt is empty (mirrors getAllCharacters fallback).
 */
export const buildNovelFoundationBlock = (novel = {}) => {
  if (!novel || typeof novel !== "object") return "";
  const lines = ["### NOVEL DETAILS (from project record)"];

  const push = (label, value, max = 1200) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (s) lines.push(`${label}: ${truncateText(s, max)}`);
  };

  push("Title", novel.name, 200);
  push("Book idea", novel.bookIdea, 800);
  push("Genre", novel.genre, 200);
  push("Setting", novel.setting, 400);
  push("Narrative style", novel.narrativeStyle, 300);
  push("Word count target", novel.wordCount ? `${novel.wordCount} words` : "", 80);
  push("Protagonist", novel.protagonist, 300);
  push("Protagonist description", novel.protagonistDescription, 900);
  push("Antagonist", novel.antagonist, 300);
  push("Antagonist motivation", novel.antagonistMotivation, 900);
  push("Theme", novel.theme, 400);
  push("Theme exploration", novel.themeExploration, 600);
  push("Subplot", novel.subplot, 600);
  push("World building", novel.worldBuilding, 800);
  push("Special elements", novel.specialElements, 500);
  push("Summary", novel.summary, 800);

  if (Array.isArray(novel.supportingCharacters) && novel.supportingCharacters.length) {
    lines.push("Supporting characters:");
    for (const sc of novel.supportingCharacters) {
      const name = sc?.name?.trim();
      if (!name) continue;
      const bits = [sc.role, sc.significance].filter(Boolean).join(" — ");
      lines.push(`  - ${name}${bits ? `: ${bits}` : ""}`);
    }
  }

  if (Array.isArray(novel.compTitles) && novel.compTitles.length) {
    lines.push(`Comp titles: ${novel.compTitles.slice(0, 5).join("; ")}`);
  }

  if (lines.length <= 1) return "";
  return truncateText(lines.join("\n"), NOVEL_FOUNDATION_MAX_CHARS);
};

/**
 * Build synthetic cast from Novel when Character collection is empty or thin.
 */
export const buildFallbackCastFromNovel = (novel, novelId) => {
  const out = [];
  const idPrefix = `cast-${String(novelId)}`;

  const pName = castNameFromNovelField(novel.protagonist);
  if (pName) {
    out.push({
      _id: `${idPrefix}-protagonist`,
      name: pName,
      character: "protagonist",
      role: novel.protagonistDescription
        ? truncateText(novel.protagonistDescription, 120)
        : undefined,
      responseText: novel.protagonistDescription?.trim() || novel.protagonist?.trim() || "",
      syntheticFromNovel: true,
    });
  }

  const aName = castNameFromNovelField(novel.antagonist);
  if (aName) {
    const motivation = novel.antagonistMotivation?.trim() || "";
    out.push({
      _id: `${idPrefix}-antagonist`,
      name: aName,
      character: "antagonist",
      role: motivation ? truncateText(motivation, 120) : undefined,
      responseText: motivation || novel.antagonist?.trim() || "",
      syntheticFromNovel: true,
    });
  }

  const supporting = Array.isArray(novel.supportingCharacters) ? novel.supportingCharacters : [];
  supporting.forEach((sc, idx) => {
    const name = (sc?.name && String(sc.name).trim()) || "";
    if (!name) return;
    const bits = [sc.role, sc.significance].filter(Boolean).join(" — ");
    out.push({
      _id: `${idPrefix}-supporting-${idx}`,
      name,
      character: "supporting character",
      role: sc.role || undefined,
      responseText: bits || "",
      syntheticFromNovel: true,
    });
  });

  return out;
};

/**
 * When responseText is empty, use structured Character fields as a mini-dossier.
 */
export const buildDossierFromCharacterFields = (c) => {
  if (!c) return "";
  if (c.responseText?.trim()) return c.responseText.trim();

  const lines = [];
  const add = (label, val) => {
    const s = typeof val === "string" ? val.trim() : "";
    if (s) lines.push(`${label}: ${s}`);
  };

  add("Role in story", c.role);
  add("Archetype", c.archetype);
  add("Age", c.age);
  add("Gender", c.gender);
  add("Occupation", c.occupation);
  add("Ethnicity", c.ethnicity);
  add("Appearance", c.appearance);
  add("Style", c.style);
  add("Traits", c.traits);

  return lines.join("\n");
};

export const characterHasUsableDetail = (c) =>
  Boolean(buildDossierFromCharacterFields(c)?.trim());

/**
 * True when neither the Story Bible nor character dossiers provide canon text.
 * Reads `storyBible` (the dossier-free, lazy-populated field) because every
 * prompt-assembly path now consumes that field instead of `masterPrompt`.
 */
export const isSparseCanon = (novel, characters) => {
  if (novel?.storyBible?.trim()) return false;
  return !(characters || []).some(characterHasUsableDetail);
};

/**
 * Novel has a real Story Bible and/or persisted dossiers — restore full canon
 * in prompt. Reads `storyBible`; the dossier-presence check on `masterPrompt`
 * is no longer needed because dossiers are never in `storyBible`.
 */
export const shouldUseFullCanonContext = (novel, characters) => {
  if (!isOliviaFullCanonContextEnabled()) return false;
  const sb = novel?.storyBible?.trim() || "";
  if (sb.length > 400) return true;
  const withDossier = (characters || []).filter(
    (c) => (buildDossierFromCharacterFields(c)?.length || 0) > 250
  );
  return withDossier.length >= 1 && (characters || []).length <= 20;
};

export const masterPromptIncludesDossiers = (masterPrompt) =>
  DOSSIER_IN_MP_RE.test(masterPrompt || "");

/**
 * Full Story Bible block. The input is `novel.storyBible`, which is already
 * dossier-free (the strip happens once at lazy-populate time). The DB
 * Character rows feed CHARACTER PROFILES separately, so this block stays
 * focused on structure/POV/world material.
 */
export const buildFullStoryBibleBlock = (storyBibleText) => {
  const body = String(storyBibleText || "").trim();
  if (!body) return "";
  const header =
    "### STORY BIBLE (full — character profiles are in CHARACTER PROFILES below)";
  return truncateText(`${header}\n\n${body}`, FULL_STORY_BIBLE_MAX_CHARS);
};

/**
 * True when the character roster contains at least one real Character
 * collection row — i.e. an id that is not synthetic (`cast-...` from
 * Novel-field fallback) and not parsed from masterPrompt (`mp:...`).
 * Used by the assembler to decide whether the Story Bible block should
 * suppress its embedded dossier blobs in favor of the DB-backed
 * CHARACTER PROFILES block.
 */
export const hasDbCharacterRecord = (characters) =>
  Array.isArray(characters) &&
  characters.some((c) => {
    const id = String(c?._id || "");
    return id && !id.startsWith("cast-") && !id.startsWith("mp:");
  });

const escapeForRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * Match character names and aliases mentioned in the user message.
 */
export const findMentionedCharacterIds = (text, characters) => {
  if (!text || !characters?.length) return [];
  const lower = text.toLowerCase();
  const out = [];
  for (const c of characters) {
    const candidates = [c.name, ...(c.aliases || [])]
      .filter(Boolean)
      .map((n) => n.toLowerCase());
    for (const cand of candidates) {
      const re = new RegExp(`\\b${escapeForRegex(cand)}\\b`, "i");
      if (re.test(lower)) {
        out.push(String(c._id));
        break;
      }
    }
  }
  return out;
};

const isDossierQuery = (lower) =>
  /\bcharacter\s+dossiers?\b/.test(lower) ||
  /\b17[\s-]*point\s+dossiers?\b/.test(lower) ||
  /\b(?:17[\s-]*point|character)\s+profiles?\b/.test(lower) ||
  (/\b(?:summarize|summary|what(?:'s| is)\s+in)\b/.test(lower) &&
    /\b(?:dossier|profile)\b/.test(lower));

const isCanonRosterQuery = (lower) =>
  /\bstory\s+bible\b/.test(lower) ||
  /\b(?:master\s+prompt|novel\s+bible)\b/.test(lower) ||
  /\bwhat(?:'s| is)?\s+(?:the\s+)?(?:story\s+)?bible\b/.test(lower) ||
  /\bwhat\s+(?:do\s+you\s+)?know\b/.test(lower) ||
  /\bwhat\s+information\b/.test(lower) ||
  /\b(?:which|what)\s+characters?\b/.test(lower) ||
  /\blist\b.*\bcharacters?\b/.test(lower) ||
  /\bcharacters?\s+(?:do\s+you\s+have|you\s+have|are there)\b/.test(lower) ||
  /\bwho\s+(?:are|is)\s+(?:the\s+)?characters?\b/.test(lower) ||
  /\btell\s+me\s+about\s+(?:the\s+)?(?:story|novel|bible)\b/.test(lower);

const isNamedCharacterQuestion = (lower, mentionedIds) => {
  if (!mentionedIds?.length) return false;
  if (/\btell\s+me\s+about\b/.test(lower)) return true;
  if (/\bwho\s+(?:are|is)\b/.test(lower)) return true;
  if (/\bwhat(?:'s| is)\s+(?:his|her|their|the)\b/.test(lower)) return true;
  if (/\bwhat(?:'s| is)\s+in\b/.test(lower) && /\b(?:dossier|profile)\b/.test(lower)) {
    return true;
  }
  if (/\b(?:summarize|describe|explain|build|develop|flesh\s+out|sharpen)\b/.test(lower)) {
    return true;
  }
  if (/\bwhat\s+(?:do\s+you\s+)?know\s+about\b/.test(lower)) return true;
  if (/\bwhat\s+information\b/.test(lower)) return true;
  if (
    /\b(?:character|dossier|profile|antagonist|protagonist)\b/.test(lower) &&
    /\?/.test(lower)
  ) {
    return true;
  }
  return false;
};

/**
 * Classify whether this turn needs widened Story Bible / dossier context.
 */
export const classifyOliviaCanonIntent = (userMessage, characters = []) => {
  const lower = String(userMessage || "").toLowerCase();
  const mentionedIds = findMentionedCharacterIds(userMessage, characters);
  const canonQuery = Boolean(lower.trim()) && isCanonRosterQuery(lower);
  const dossierQuery = Boolean(lower.trim()) && isDossierQuery(lower);
  const hasNamedCharacterQuestion = isNamedCharacterQuestion(lower, mentionedIds);
  const requiresCanonExpansion =
    canonQuery || dossierQuery || hasNamedCharacterQuestion;

  return {
    canonQuery,
    dossierQuery,
    mentionedIds,
    hasNamedCharacterQuestion,
    requiresCanonExpansion,
  };
};

/**
 * Writer asks what Olivia knows about the bible / roster / dossiers.
 */
export const isCanonInventoryQuery = (userMessage) => {
  const { canonQuery, dossierQuery } = classifyOliviaCanonIntent(userMessage, []);
  return canonQuery || dossierQuery;
};

/**
 * Writer asks for a list of outline scenes / current outline inventory.
 * Do not use `my ... scene` with a greedy `.*` — that false-positives on
 * "review my manuscript of Act 1 Scene 3" and injects a mandatory table.
 */
export const isOutlineInventoryQuery = (userMessage) => {
  const lower = String(userMessage || "").toLowerCase();
  const outlineWord = "(?:outlines?|scenes?(?!\\s+\\d))";
  const filler = "(?:\\s+(?:of|all|my|the|current))*";
  return (
    new RegExp(`\\blist\\b${filler}\\s+${outlineWord}\\b`).test(lower) ||
    new RegExp(`\\b(?:all|current|my)\\b${filler}\\s+${outlineWord}\\b`).test(
      lower
    ) ||
    /\bwhat\s+scenes?\s+(?:do\s+you\s+have|are\s+there|in\s+my\s+outline)\b/.test(
      lower
    )
  );
};

/**
 * Writer asks for a table, layering revision, or other turn likely to render
 * an outline/scene markdown table (broader than inventory list phrasing).
 */
export const isOutlineTableQuery = (userMessage) => {
  if (isOutlineInventoryQuery(userMessage)) return true;
  const lower = String(userMessage || "").toLowerCase();
  if (
    /\b(?:show|see|give|display|view|ready\s+for)\b.*\b(?:the\s+)?(?:layering\s+)?table\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b(?:layering\s+table|layering\s+plan|scene\s+summary\s+table|spine\s+table|outline\s+table)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b15[\s-]*scene\b.*\b(?:table|spine)\b/.test(lower) ||
    /\b(?:table|spine)\b.*\b15[\s-]*scene\b/.test(lower)
  ) {
    return true;
  }
  if (/\bexpand\b.*\b(?:the\s+)?outline\b.*\blayering\b/.test(lower)) {
    return true;
  }
  if (/\blayering\b.*\b(?:outline|plan|structure)\b/.test(lower)) {
    return true;
  }
  if (/\b(revise|expand|reshape)\b.*\b(plan|outline|scenes?)\b/.test(lower)) {
    return true;
  }
  if (/\b(add|insert)\b.*\bnew\s+scenes?\b/.test(lower)) {
    return true;
  }
  return false;
};

/**
 * The Olivia "Build this Novel" flow always emits a single section heading
 * line — `**👤 CHARACTER DOSSIERS — 17-Point Dossiers**` — and then every
 * per-character 17-Point Dossier (and a closing chat footer) follows. The
 * frontend already cuts the Story Bible tab at this same line via
 * `sliceStoryBibleMasterPromptForDisplay` so the writer never sees the
 * dossier prose; we mirror that cut here so Olivia never sees it either.
 *
 * The predicate matches both `Dossier` (singular, on a per-character header
 * line) and `Dossiers` (plural, on the section heading line) — but in
 * practice this regex only triggers on the section heading because we
 * additionally require the literal "CHARACTER DOSSIERS" prefix.
 */
const DOSSIER_SECTION_HEADING_LINE_RE =
  /^[ \t]*(?:#{1,3}\s*)?\*{0,2}\s*👤?\s*CHARACTER\s+DOSSIERS[\s\S]*?17[\s-]*Point\s+Dossiers/im;

export const stripDossierBlocksFromMasterPrompt = (masterPrompt) => {
  if (!masterPrompt) return "";
  const text = String(masterPrompt);

  // Primary: cut at the `**👤 CHARACTER DOSSIERS — 17-Point Dossiers**`
  // line. Everything from that line to end-of-text (per-character dossier
  // blocks plus the closing "🎭 Here are your full ..." chat footer) is
  // removed in a single slice.
  const sectionMatch = DOSSIER_SECTION_HEADING_LINE_RE.exec(text);
  if (sectionMatch) {
    return text.slice(0, sectionMatch.index).trim();
  }

  // Fallback: legacy masterPrompt that has individual `**👤 Name: 17-Point
  // Dossier**` blocks but no preceding section heading. Cut at the first
  // block header — every subsequent block runs to end-of-text in practice,
  // so anything before that header is the Story Bible content we want to
  // preserve.
  const re = new RegExp(DOSSIER_HEADER_RE.source, "gi");
  const firstBlock = re.exec(text);
  if (!firstBlock) return text.trim();
  return text.slice(0, firstBlock.index).trim();
};

export const buildStoryBibleCanonExcerpt = (storyBibleText, novel = {}, maxChars = STORY_BIBLE_CANON_EXCERPT_CHARS) => {
  const body = String(storyBibleText || "").trim();
  if (body) {
    return truncateText(
      `### STORY BIBLE (setup sections — character profiles are listed separately)\n${body}`,
      maxChars
    );
  }
  const foundation = buildNovelFoundationBlock(novel);
  if (foundation) {
    return truncateText(
      foundation.replace("### NOVEL DETAILS", "### STORY BIBLE (from novel record)"),
      maxChars
    );
  }
  return "";
};

/** Small setup excerpt for normal coaching turns (genre, premise, theme). */
export const buildStoryBibleLightExcerpt = (storyBibleText, novel = {}) =>
  buildStoryBibleCanonExcerpt(storyBibleText, novel, STORY_BIBLE_LIGHT_EXCERPT_CHARS);

/**
 * Resolve characters + dossier text for Olivia (DB → masterPrompt → novel fields).
 *
 * Once `characterDossiersHydrated` is true the Character collection is the
 * roster: merge dossier text onto remaining DB rows, but do not re-add names
 * the writer deleted (those still live in masterPrompt until the next regen).
 */
export const resolveCharactersForOlivia = (novel, novelId, dbCharacters = []) => {
  let characters = [...(dbCharacters || [])];
  const rosterIsDb = novel?.characterDossiersHydrated === true;

  const parsed = parseCharacterDossiersFromText(novel?.masterPrompt || "");
  const byName = new Map(parsed.map((d) => [d.name.toLowerCase().trim(), d]));

  /** MongoDB Character row wins when present — edits must not lose to stale masterPrompt. */
  const mergeDossier = (dbText, mpText) => {
    const db = String(dbText || "").trim();
    if (db) return db;
    return String(mpText || "").trim();
  };

  if (parsed.length) {
    if (characters.length) {
      characters = characters.map((c) => {
        const fromMp = byName.get(String(c.name || "").toLowerCase().trim());
        const merged = mergeDossier(c.responseText, fromMp?.dossierText);
        if (!merged) return c;
        return {
          ...c,
          responseText: merged,
          character: c.character || fromMp?.characterType || c.character,
        };
      });

      if (!rosterIsDb) {
        const existingNames = new Set(
          characters.map((c) => String(c.name || "").toLowerCase().trim()).filter(Boolean)
        );
        for (const d of parsed) {
          const key = d.name.toLowerCase().trim();
          if (existingNames.has(key)) continue;
          characters.push({
            _id: `mp:${d.name}`,
            name: d.name,
            character: d.characterType,
            responseText: d.dossierText,
          });
          existingNames.add(key);
        }
      }
    } else if (!rosterIsDb) {
      characters = parsed.map((d) => ({
        _id: `mp:${d.name}`,
        name: d.name,
        character: d.characterType,
        responseText: d.dossierText,
      }));
    }
  }

  characters = characters.map((c) => {
    const detail = buildDossierFromCharacterFields(c);
    if (detail && !c.responseText?.trim()) {
      return { ...c, responseText: detail };
    }
    return c;
  });

  if (!characters.length || !characters.some(characterHasUsableDetail)) {
    const fallback = buildFallbackCastFromNovel(novel || {}, novelId);
    if (fallback.length) {
      const existingNames = new Set(
        characters.map((c) => String(c.name || "").toLowerCase().trim()).filter(Boolean)
      );
      for (const f of fallback) {
        const key = f.name.toLowerCase().trim();
        if (existingNames.has(key)) {
          const idx = characters.findIndex(
            (c) => String(c.name || "").toLowerCase().trim() === key
          );
          if (idx >= 0 && !characterHasUsableDetail(characters[idx])) {
            characters[idx] = { ...characters[idx], responseText: f.responseText };
          }
        } else if (!rosterIsDb) {
          characters.push(f);
        }
      }
    }
  }

  return characters;
};

/** @deprecated Use resolveCharactersForOlivia */
export const enrichCharactersWithMasterPromptDossiers = (characters, masterPrompt) => {
  const parsed = parseCharacterDossiersFromText(masterPrompt || "");
  if (!parsed.length) return characters || [];
  const byName = new Map(parsed.map((d) => [d.name.toLowerCase().trim(), d]));
  const enriched = (characters || []).map((c) => {
    if (c.responseText?.trim()) return c;
    const fromMp = byName.get(String(c.name || "").toLowerCase().trim());
    if (!fromMp?.dossierText) return c;
    return { ...c, responseText: fromMp.dossierText, character: c.character || fromMp.characterType };
  });
  if (enriched.length > 0) return enriched;
  return parsed.map((d) => ({
    _id: `mp:${d.name}`,
    name: d.name,
    character: d.characterType,
    responseText: d.dossierText,
  }));
};

export const isLeadCharacter = (c) => {
  const role = String(c?.character || "").toLowerCase().trim();
  return role === "protagonist" || role === "antagonist";
};

const AUTHORITATIVE_FACT_FIELDS = [
  ["age", "age"],
  ["gender", "gender"],
  ["occupation", "occupation"],
  ["ethnicity", "ethnicity"],
  ["appearance", "appearance"],
  ["style", "style"],
  ["traits", "traits"],
  ["archetype", "archetype"],
  ["role", "role"],
];

const renderAuthoritativeFactsLines = (c) => {
  const facts = [];
  for (const [field, label] of AUTHORITATIVE_FACT_FIELDS) {
    const v = typeof c?.[field] === "string" ? c[field].trim() : "";
    if (v) facts.push(`    ${label}: ${v}`);
  }
  if (!facts.length) return [];
  return [
    "  AUTHORITATIVE CHARACTER FACTS (latest writer edits — supersede any conflicting line in the Story Bible or in the dossier text below):",
    ...facts,
  ];
};

/**
 * Render character profiles block (exported for chain-hot + tests).
 */
export const renderRelevantCharactersBlock = (
  characters,
  characterStates,
  {
    dossierMaxChars = FOCUS_CHARACTER_DOSSIER_CHARS,
    includeAll = false,
    rosterOnly = false,
    fullDossierCharacterIds = null,
  } = {}
) => {
  if (!characters?.length) return "";
  if (rosterOnly) return renderCharacterRosterBlock(characters);

  const fullSet =
    fullDossierCharacterIds instanceof Set
      ? fullDossierCharacterIds
      : new Set(fullDossierCharacterIds || []);

  const stateById = new Map(
    (characterStates || []).map((s) => [String(s.characterId), s])
  );
  const header = includeAll
    ? "### CHARACTER PROFILES (full roster)"
    : "### RELEVANT CHARACTERS";
  const lines = [header];
  for (const c of characters) {
    const s = stateById.get(String(c._id));
    const role = c.character ? ` (${c.character})` : "";
    const fragments = [];
    if (s?.mood) fragments.push(`mood: ${s.mood}`);
    if (s?.goal) fragments.push(`goal: ${s.goal}`);
    if (s?.currentLocationHint) fragments.push(`location: ${s.currentLocationHint}`);
    if (Array.isArray(s?.secrets) && s.secrets.length) {
      fragments.push(`secrets: ${s.secrets.join("; ")}`);
    }
    lines.push(
      `- **${c.name}**${role}` +
        (fragments.length ? ` — ${fragments.join(" · ")}` : "")
    );

    for (const fl of renderAuthoritativeFactsLines(c)) lines.push(fl);

    const dossier =
      c.responseText?.trim() ||
      buildDossierFromCharacterFields(c);
    if (dossier) {
      const perCharCap = fullSet.has(String(c._id))
        ? MENTIONED_CHARACTER_DOSSIER_CHARS
        : dossierMaxChars;
      const excerpt =
        perCharCap > 0 ? truncateText(dossier, perCharCap) : dossier;
      for (const dl of excerpt.split("\n")) {
        lines.push(`  ${dl}`);
      }
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

/**
 * Compact memory block for chain-hot turns. Always carries the COMPLETE cast
 * roster (names + roles for every character) so Olivia never invents a name on
 * a turn where the full memory block is skipped; full dossiers are included
 * only for leads + mentioned characters to keep the block small.
 */
export const buildChainHotMemoryBlock = ({
  novel,
  characters = [],
  characterStates = [],
  mentionedIds = [],
}) => {
  const roster = Array.isArray(characters) ? characters : [];
  if (!roster.length && !novel?.storyBible?.trim()) return null;

  const mentionedSet = new Set((mentionedIds || []).map(String));
  const pick = new Map();
  for (const c of roster) {
    if (isLeadCharacter(c) || mentionedSet.has(String(c._id))) {
      pick.set(String(c._id), c);
    }
  }
  const selected = [...pick.values()];

  const lightBible = novel?.storyBible?.trim()
    ? buildStoryBibleLightExcerpt(novel.storyBible, novel)
    : "";

  // Complete cast list (names + roles) — present on every chain-hot turn so
  // the model always knows the authoritative, exhaustive roster.
  const rosterBlock = roster.length ? renderCharacterRosterBlock(roster) : "";

  const fullIds = new Set(selected.map((c) => String(c._id)));
  const charBlock =
    selected.length > 0
      ? renderRelevantCharactersBlock(selected, characterStates, {
          dossierMaxChars: FOCUS_CHARACTER_DOSSIER_CHARS,
          includeAll: false,
          fullDossierCharacterIds: fullIds,
        })
      : "";

  const body = [lightBible, rosterBlock, charBlock].filter(Boolean).join("\n\n");
  if (!body.trim()) return null;

  return {
    role: "system",
    content: `OLIVIA CANON ANCHOR (complete cast — these are the ONLY characters; do not invent new names). Full dossiers for lead/active characters below.\n\n${body}`,
  };
};

export const selectCharactersForContext = (
  characters,
  focusCharacterIds,
  userMessage,
  {
    sparseCanon = false,
    fullCanon = false,
    dossiersInMasterPrompt = false,
    mode = "editor",
    activeCharacterIds = [],
    requiresCanonExpansion = false,
    mentionedIds = [],
  } = {}
) => {
  if (!characters?.length) {
    return {
      characters: [],
      dossierMaxChars: FOCUS_CHARACTER_DOSSIER_CHARS,
      includeAll: false,
      fullDossierCharacterIds: new Set(),
    };
  }

  const leadIds = characters
    .filter(isLeadCharacter)
    .map((c) => String(c._id));

  const buildFullDossierIds = (baseIds = []) => {
    const ids = new Set(baseIds.map(String));
    for (const id of mentionedIds || []) ids.add(String(id));
    return ids;
  };

  if (fullCanon) {
    return {
      characters,
      dossierMaxChars: 0,
      includeAll: true,
      rosterOnly: false,
      fullDossierCharacterIds: new Set(characters.map((c) => String(c._id))),
    };
  }

  // Scene delivery: focus scene cast + leads + mentions — not the full roster.
  if (mode === "scene") {
    const focusSet = new Set([...(focusCharacterIds || []).map(String)]);
    for (const id of activeCharacterIds || []) focusSet.add(String(id));
    for (const id of leadIds) focusSet.add(id);

    const selected = characters.filter((c) => focusSet.has(String(c._id)));
    const fullDossierCharacterIds = buildFullDossierIds([...focusSet]);
    return {
      characters: selected.length > 0 ? selected : characters.slice(0, 12),
      dossierMaxChars: SCENE_DELIVERY_DOSSIER_CHARS,
      includeAll: false,
      rosterOnly: false,
      fullDossierCharacterIds,
    };
  }

  const intent = requiresCanonExpansion
    ? { requiresCanonExpansion: true, mentionedIds }
    : classifyOliviaCanonIntent(userMessage, characters);
  const canonTurn =
    requiresCanonExpansion ||
    intent.requiresCanonExpansion ||
    isCanonInventoryQuery(userMessage) ||
    sparseCanon;

  if (canonTurn) {
    const fullDossierCharacterIds = buildFullDossierIds(leadIds);
    return {
      characters,
      dossierMaxChars: CANON_QUERY_DOSSIER_CHARS,
      includeAll: true,
      rosterOnly: false,
      fullDossierCharacterIds,
    };
  }

  const focusSet = new Set([...(focusCharacterIds || []).map(String)]);
  for (const id of leadIds) focusSet.add(id);

  const selected = characters.filter((c) => focusSet.has(String(c._id)));
  const fullDossierCharacterIds = buildFullDossierIds([...focusSet]);
  return {
    characters: selected.length > 0 ? selected : characters.slice(0, 12),
    dossierMaxChars: FOCUS_CHARACTER_DOSSIER_CHARS,
    includeAll: false,
    rosterOnly: false,
    fullDossierCharacterIds,
  };
};

/** @deprecated Full-canon mode always sends dossier bodies; kept for tests. */
export const renderCharacterRosterBlock = (characters) => {
  if (!characters?.length) return "";
  const lines = [
    "### CHARACTER ROSTER (names only — full profiles below)",
    ...characters.map(
      (c) => `- **${c.name}**${c.character ? ` (${c.character})` : ""}`
    ),
  ];
  return lines.join("\n");
};
