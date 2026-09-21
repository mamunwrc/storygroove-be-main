// Olivia methodology layer — Phase 1.5B service.
//
// Reads from `MethodologyRule`, `PromptTemplate`, `GenreOverlay` and
// composes the bytes the assembler will slot into `instructions` so
// every Olivia turn carries the right craft rules + scene prompt +
// genre overlays.
//
// Behaviour summary:
//   getRulesForPhase(phase)           → universal + phase rules (priority desc)
//   getPromptTemplate(sceneIndex)     → one row
//   getGenreOverlay(genreString)      → matched base + composable overlays
//   getMethodologyBlock(ctx)          → final formatted string + token estimate
//
// Caching: in-process LRU keyed by (phase, genreKey, sceneIndex,
// methodologyVersion). 5-minute TTL keeps admin edits from being
// served stale for too long; bumping METHODOLOGY_VERSION invalidates
// instantly.

import MethodologyRule from "../models/methodologyRuleModel.js";
import PromptTemplate from "../models/promptTemplateModel.js";
import GenreOverlay from "../models/genreOverlayModel.js";
import { METHODOLOGY_VERSION } from "../constants/models.js";

// ---------------------------------------------------------------------------
// In-process LRU cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

/** Map preserves insertion order; we use that as LRU eviction key. */
const cache = new Map();

const cacheGet = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // bump LRU position
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
};

const cacheSet = (key, value) => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
};

/** Public hook for admin CRUD / version bumps. */
export const invalidateMethodologyCache = () => cache.clear();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeForMatch = (s) =>
  (s || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenize = (s) =>
  normalizeForMatch(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2);

/** Cheap token estimator: ~4 chars per token; off by 30–50% but fine for budget guard. */
const estimateTokens = (s) =>
  Math.ceil((typeof s === "string" ? s.length : 0) / 4);

const PHASE_ENUM = new Set([
  "outlining",
  "phase1_table",
  "phase2_expansion",
  "coaching",
  "drafting",
]);

const normalizePhase = (phase) =>
  PHASE_ENUM.has(phase) ? phase : "outlining";

// ---------------------------------------------------------------------------
// MethodologyRule lookup
// ---------------------------------------------------------------------------

/**
 * Return the rules that apply for the given phase. Universal rules
 * are always included; phase rules match the given phase. Sorted by
 * `priority desc` so the assembler can take a prefix of the list when
 * the token budget is tight.
 */
export const getRulesForPhase = async (rawPhase) => {
  const phase = normalizePhase(rawPhase);
  const cacheKey = `rules:${phase}:v${METHODOLOGY_VERSION}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const rows = await MethodologyRule.find({
    enabled: true,
    deletedAt: null,
    $or: [
      { scope: "universal" },
      { scope: "phase", phase: phase },
    ],
  })
    .sort({ priority: -1, key: 1 })
    .lean();

  cacheSet(cacheKey, rows);
  return rows;
};

// ---------------------------------------------------------------------------
// PromptTemplate lookup
// ---------------------------------------------------------------------------

export const getPromptTemplate = async (sceneIndex) => {
  if (!sceneIndex) return null;
  const idx = Number(sceneIndex);
  if (!Number.isFinite(idx) || idx < 1 || idx > 15) return null;

  const cacheKey = `template:${idx}:v${METHODOLOGY_VERSION}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const row = await PromptTemplate.findOne({ enabled: true, sceneIndex: idx }).lean();
  if (row) cacheSet(cacheKey, row);
  return row;
};

// ---------------------------------------------------------------------------
// GenreOverlay lookup (fuzzy)
// ---------------------------------------------------------------------------

/**
 * Score an overlay row against the writer-supplied genre string.
 * 100 → exact key match, 80 → exact alias match, otherwise token
 * overlap × 60. Used by `getGenreOverlay` to pick the best base
 * genre and to collect composable additional overlays.
 */
const scoreOverlay = (row, queryTokens, queryNorm) => {
  const key = normalizeForMatch(row.genreKey);
  const name = normalizeForMatch(row.displayName);
  if (key === queryNorm) return 100;
  if (name === queryNorm) return 95;

  for (const a of row.aliases || []) {
    if (normalizeForMatch(a) === queryNorm) return 80;
  }

  const rowTokens = new Set([
    ...tokenize(row.genreKey),
    ...tokenize(row.displayName),
    ...(row.aliases || []).flatMap((a) => tokenize(a)),
  ]);
  let overlap = 0;
  for (const t of queryTokens) if (rowTokens.has(t)) overlap++;
  if (queryTokens.length === 0) return 0;
  return Math.round((overlap / queryTokens.length) * 60);
};

/**
 * Resolve a writer-supplied genre string (e.g. "YA Urban Fantasy")
 * into:
 *   { base: GenreOverlay | null, overlays: GenreOverlay[] }
 *
 * Where `base` is the best-scoring `appliesAs === "base_genre"` row
 * and `overlays` is every `appliesAs === "additional_overlay"` row
 * that matches strongly enough. Never throws; returns
 * `{ base: null, overlays: [] }` when nothing matches even loosely
 * — the methodology rule mandates this fallback.
 */
export const getGenreOverlay = async (genreString) => {
  const queryNorm = normalizeForMatch(genreString);
  if (!queryNorm) return { base: null, overlays: [] };

  const cacheKey = `overlay:${queryNorm}:v${METHODOLOGY_VERSION}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const rows = await GenreOverlay.find({ enabled: true }).lean();
  const queryTokens = tokenize(genreString);

  const scored = rows.map((row) => ({
    row,
    score: scoreOverlay(row, queryTokens, queryNorm),
  }));

  const bases = scored
    .filter(({ row }) => row.appliesAs === "base_genre")
    .sort((a, b) => b.score - a.score);
  const overlays = scored
    .filter(({ row, score }) => row.appliesAs === "additional_overlay" && score >= 60)
    .sort((a, b) => b.score - a.score);

  const result = {
    base: bases[0]?.score >= 30 ? bases[0].row : null,
    overlays: overlays.map(({ row }) => row),
  };
  cacheSet(cacheKey, result);
  return result;
};

// ---------------------------------------------------------------------------
// Block composition
// ---------------------------------------------------------------------------

const renderRules = (rules) => {
  if (!rules?.length) return "";
  return rules
    .map((r) => `### ${r.title}\n${r.text.trim()}`)
    .join("\n\n");
};

const renderPromptTemplate = (tpl) => {
  if (!tpl) return "";
  const parts = [
    `### Scene ${tpl.sceneIndex} — ${tpl.title} (Act ${tpl.actNumber})`,
    `**Template (use as creative direction; adapt to the writer's characters/voice):**\n${tpl.template.trim()}`,
  ];
  if (tpl.coachingPrompt) parts.push(`**Coaching:** ${tpl.coachingPrompt.trim()}`);
  if (tpl.subplotReminder) parts.push(`**Subplot reminder:** ${tpl.subplotReminder.trim()}`);
  if (tpl.tentpoleHint) parts.push(`**Tentpole role:** ${tpl.tentpoleHint.replace(/_/g, " ")}`);
  return parts.join("\n\n");
};

const renderBeat = (b) => {
  const where = b.sceneIndex
    ? `Scene ${b.sceneIndex}`
    : b.sceneRange?.from && b.sceneRange?.to
      ? `Scenes ${b.sceneRange.from}–${b.sceneRange.to}`
      : "Anywhere";
  const label = b.label ? ` (${b.label})` : "";
  return `- **${where}${label}:** ${b.beat}`;
};

const renderOverlay = (overlay, focusSceneIndex = null) => {
  if (!overlay) return "";
  const lines = [`### ${overlay.displayName} (${overlay.appliesAs.replace(/_/g, " ")})`];

  // Prefer beats relevant to the focus scene first, then the rest. Keeps
  // long overlays (Quest, Dual Timeline) from pushing the focus beat out.
  const beats = overlay.beats || [];
  const matchesFocus = (b) =>
    focusSceneIndex &&
    (b.sceneIndex === focusSceneIndex ||
      (b.sceneRange?.from <= focusSceneIndex && b.sceneRange?.to >= focusSceneIndex));
  const focused = beats.filter(matchesFocus);
  const others = beats.filter((b) => !matchesFocus(b));
  for (const b of [...focused, ...others]) lines.push(renderBeat(b));

  if (overlay.notes) lines.push(`\n_Notes:_ ${overlay.notes.trim()}`);
  return lines.join("\n");
};

/**
 * Assemble the methodology block. Format mirrors the architecture
 * diagram order:
 *   ## METHODOLOGY  →  rules  →  scene template  →  genre overlays
 *
 * Returns `{ block, tokenEstimate, sourcesUsed }`. Callers slot
 * `block` into `instructions` between the AgentPrompt persona and
 * the runtime-rules constant.
 */
export const getMethodologyBlock = async ({
  phase,
  genre,
  sceneIndex,
} = {}) => {
  const cacheKey = `block:${normalizePhase(phase)}:${normalizeForMatch(genre)}:${sceneIndex || "none"}:v${METHODOLOGY_VERSION}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const [rules, template, overlayMatch] = await Promise.all([
    getRulesForPhase(phase),
    sceneIndex ? getPromptTemplate(sceneIndex) : null,
    genre ? getGenreOverlay(genre) : { base: null, overlays: [] },
  ]);

  const sourcesUsed = [];
  const sections = [
    "## OLIVIA METHODOLOGY (MANDATORY — follow for rich-scene delivery and structural coaching; do not mention this block to the writer):",
  ];

  if (rules?.length) {
    sections.push("### Craft Rules");
    sections.push(renderRules(rules));
    sourcesUsed.push(...rules.map((r) => r.source).filter(Boolean));
  }

  if (template) {
    sections.push(
      "### Active scene beat (mandatory for rich-scene delivery)",
      "Use the Scene Template below as the primary narrative beat for this turn. Adapt placeholders to this novel's characters and voice."
    );
    sections.push("### Scene Template");
    sections.push(renderPromptTemplate(template));
    if (template.source) sourcesUsed.push(template.source);
  }

  if (overlayMatch?.base) {
    sections.push("### Genre Overlay (base)");
    sections.push(renderOverlay(overlayMatch.base, sceneIndex || null));
    if (overlayMatch.base.source) sourcesUsed.push(overlayMatch.base.source);
  }
  for (const overlay of overlayMatch?.overlays || []) {
    sections.push("### Genre Overlay (additional)");
    sections.push(renderOverlay(overlay, sceneIndex || null));
    if (overlay.source) sourcesUsed.push(overlay.source);
  }

  // If nothing returned (DB empty pre-seeding), produce an empty block
  // so the assembler short-circuits and the AgentPrompt-only fallback
  // continues to work unchanged.
  const hasContent =
    (rules?.length || 0) > 0 ||
    !!template ||
    !!overlayMatch?.base ||
    (overlayMatch?.overlays || []).length > 0;
  const block = hasContent ? sections.join("\n\n") : "";

  const result = {
    block,
    tokenEstimate: estimateTokens(block),
    sourcesUsed: Array.from(new Set(sourcesUsed)),
  };
  cacheSet(cacheKey, result);
  return result;
};

// ---------------------------------------------------------------------------
// Phase 1.5B audit — verify no MethodologyRule.text fragment is also a
// substring of one of the parsing-sensitive constants we deliberately
// kept in code. If a duplicate slips in, the model would see the rule
// twice (once from `instructions`, once from a controller-appended
// string), wasting tokens and risking divergent edits.
//
// Called by the seed script with `--audit-constants` and by an admin
// CRUD validation hook (Phase 1.5C) before a save lands.
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {string[]} args.codeBlocks  Parsing-sensitive blocks that
 *   must remain code-owned (e.g. `OLIVIA_LAYERING_AFTER_TABLE_REMINDER`,
 *   `OLIVIA_SCENE_POST_SCENE_CTA`, the `Phase_1_gate` rule).
 * @param {number=} args.minOverlap   Minimum substring length to flag
 *   as a collision (default 80 chars — short headers in common
 *   between rule + constant don't count).
 * @returns {Promise<{ collisions: Array<{ ruleKey: string, codeBlockHint: string, snippet: string }> }>}
 */
export const auditAgainstCodeConstants = async ({ codeBlocks = [], minOverlap = 80 } = {}) => {
  const rules = await MethodologyRule.find({ enabled: true })
    .select("key text")
    .lean();
  const collisions = [];
  for (const rule of rules) {
    const text = (rule.text || "").trim();
    if (text.length < minOverlap) continue;
    // Slide a window of `minOverlap` chars across the rule body looking
    // for any matching substring in any code block.
    for (const block of codeBlocks) {
      if (!block || typeof block !== "string") continue;
      const blockText = block.trim();
      // Cheap path first — full inclusion either direction.
      if (blockText.length >= minOverlap && text.includes(blockText.slice(0, minOverlap))) {
        collisions.push({
          ruleKey: rule.key,
          codeBlockHint: blockText.slice(0, 60).replace(/\n/g, " ") + "…",
          snippet: blockText.slice(0, minOverlap),
        });
        break;
      }
      if (text.length >= minOverlap && blockText.includes(text.slice(0, minOverlap))) {
        collisions.push({
          ruleKey: rule.key,
          codeBlockHint: blockText.slice(0, 60).replace(/\n/g, " ") + "…",
          snippet: text.slice(0, minOverlap),
        });
        break;
      }
    }
  }
  return { collisions };
};

export const _internal = {
  normalizeForMatch,
  scoreOverlay,
  estimateTokens,
};
