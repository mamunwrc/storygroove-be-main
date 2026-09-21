// Olivia memory pipeline — Phase 2 + Phase 1.5B context assembler.
//
// Single orchestrator that:
//   1. Loads canonical context (novel, characters, outline slice).
//   2. Loads layered memory (StoryState, ActiveSceneState, CharacterState,
//      EpisodicEvent, RelationshipEdge, SceneMemory).
//   3. Calls `methodologyService.getMethodologyBlock` for craft rules,
//      scene template, and genre overlays (Phase 1.5B).
//   4. Splits the output into `instructions` (cache-friendly, stable
//      prefix → enables OpenAI prompt-cache) and `memoryBlockMessage`
//      (per-turn dynamic state — goes into `input`).
//   5. Enforces a token budget with a documented demotion order.
//   6. Returns `focusCharacterIds` so the caller can pass it into the
//      retrieval service / vector store filters.
//
// Phase 4 work folded in:
//   - In-memory TTL cache keyed by (novelId, lastMutationTs).
//   - Token-budget guard with graceful demotion.
//
// Falls back gracefully when DB collections are empty: an unseeded
// novel still gets a coherent (legacy-shaped) prompt.

import Novel from "../models/novelModel.js";
import Character from "../models/characterModel.js";
import StoryResponse from "../models/storyResponseModel.js";
import UserContent from "../models/userContentModel.js";
import StoryState from "../models/storyStateModel.js";
import ActiveSceneState from "../models/activeSceneStateModel.js";
import CharacterState from "../models/characterStateModel.js";
import EpisodicEvent from "../models/episodicEventModel.js";
import RelationshipEdge from "../models/relationshipEdgeModel.js";
import SceneMemory from "../models/sceneMemoryModel.js";
import AgentPrompt from "../models/agentPromptModel.js";
import {
  getMethodologyBlock,
} from "./methodologyService.js";
import { retrieveRelevant } from "./retrievalService.js";
import {
  buildFullStoryBibleBlock,
  buildNovelFoundationBlock,
  buildStoryBibleCanonExcerpt,
  buildStoryBibleLightExcerpt,
  classifyOliviaCanonIntent,
  findMentionedCharacterIds,
  isSparseCanon,
  MENTIONED_CHARACTER_DOSSIER_CHARS,
  renderCharacterRosterBlock,
  renderRelevantCharactersBlock,
  buildChainHotMemoryBlock,
  resolveCharactersForOlivia,
  selectCharactersForContext,
  shouldUseFullCanonContext,
  truncateText,
} from "./characterCanonContext.js";
import { resolveSpineSceneIndex, computeActOffsets, getGlobalSceneNumber, formatActChapterRef } from "../utils/globalSceneNumber.js";
import { archivedSceneRefKeySet } from "../utils/archivedScenes.js";
import { resolveOliviaTokenBudget, OLIVIA_EDITOR_TOKEN_BUDGET } from "../constants/oliviaMemory.js";
import { OLIVIA_CANON_INTEGRITY_RULE } from "../constants/oliviaUiMessages.js";

// ---------------------------------------------------------------------------
// Token budget (Phase 4 task `phase4-token-guard`)
// ---------------------------------------------------------------------------

const charsToTokens = (s) =>
  Math.ceil((typeof s === "string" ? s.length : 0) / 4);

/** Truncate section text to fit remaining char budget (keeps header line). */
const truncateSectionText = (text, maxChars) => {
  const s = String(text || "").trim();
  if (!s || s.length <= maxChars) return s;
  const lines = s.split("\n");
  const header = lines[0] || "";
  const body = lines.slice(1).join("\n");
  const bodyBudget = Math.max(0, maxChars - header.length - 4);
  if (bodyBudget <= 0) return truncateText(s, maxChars);
  return `${header}\n${truncateText(body, bodyBudget)}`;
};

// ---------------------------------------------------------------------------
// In-process TTL cache (Phase 4 task `phase4-assembler-cache`)
// ---------------------------------------------------------------------------

const ASSEMBLER_TTL_MS = 5 * 60 * 1000;
const ASSEMBLER_CACHE_MAX = 100;
const assemblerCache = new Map();

const cacheKey = ({ novelId, userId, mode, focusKey, lastMutationTs }) =>
  [novelId, userId, mode, focusKey, lastMutationTs?.getTime?.() || 0].join("|");

const getCached = (key) => {
  const entry = assemblerCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    assemblerCache.delete(key);
    return null;
  }
  assemblerCache.delete(key);
  assemblerCache.set(key, entry);
  return entry.value;
};

const setCached = (key, value) => {
  assemblerCache.set(key, { value, expiresAt: Date.now() + ASSEMBLER_TTL_MS });
  if (assemblerCache.size > ASSEMBLER_CACHE_MAX) {
    const k = assemblerCache.keys().next().value;
    if (k !== undefined) assemblerCache.delete(k);
  }
};

export const invalidateAssemblerCache = (predicate) => {
  if (!predicate) {
    assemblerCache.clear();
    return;
  }
  for (const k of [...assemblerCache.keys()]) {
    if (predicate(k)) assemblerCache.delete(k);
  }
};

// ---------------------------------------------------------------------------
// Helpers — character matching, outline slicing
// ---------------------------------------------------------------------------

/**
 * Build a `name (lowercase) -> _id` lookup map across both canonical
 * names and aliases. Used by callers (memory worker) to map model
 * output back to character IDs.
 */
export const buildCharacterLookup = (characters) => {
  const map = {};
  for (const c of characters || []) {
    if (c?.name) map[c.name.toLowerCase().trim()] = String(c._id);
    for (const a of c?.aliases || []) {
      if (a) map[a.toLowerCase().trim()] = String(c._id);
    }
  }
  return map;
};

const findMentionedCharacters = (text, characters) =>
  findMentionedCharacterIds(text, characters);

const focusKey = (focus) =>
  focus?.actNumber && focus?.sceneIndex
    ? `${focus.actNumber}.${focus.sceneIndex}`
    : "none";

// ---------------------------------------------------------------------------
// Memory block builders (each section short enough to demote individually)
// ---------------------------------------------------------------------------

const renderStoryStateBlock = (ss) => {
  if (!ss) return "";
  const lines = ["### STORY STATE"];
  if (ss.currentArc) lines.push(`- Current arc: ${ss.currentArc}`);
  if (ss.sceneGoal) lines.push(`- Scene goal: ${ss.sceneGoal}`);
  if (ss.chapterGoal) lines.push(`- Chapter goal: ${ss.chapterGoal}`);
  if (ss.emotionalState) lines.push(`- Emotional state: ${ss.emotionalState}`);
  if (ss.pacing) lines.push(`- Pacing: ${ss.pacing}`);
  if (ss.layeringPhase) lines.push(`- Layering phase: ${ss.layeringPhase}`);
  if (Array.isArray(ss.narrativeDirectives) && ss.narrativeDirectives.length) {
    lines.push("- Narrative directives:");
    for (const d of ss.narrativeDirectives) lines.push(`  • ${d}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

const renderActiveSceneBlock = (as, focusScene) => {
  if (!as && !focusScene) return "";
  const lines = ["### ACTIVE SCENE"];
  const currentScene = as?.currentScene || focusScene;
  if (currentScene?.actNumber && currentScene?.sceneIndex) {
    const chapter =
      Number(currentScene.globalSceneNumber) > 0
        ? Number(currentScene.globalSceneNumber)
        : currentScene.sceneIndex;
    lines.push(
      `- Current scene: ${formatActChapterRef(currentScene.actNumber, chapter)}`
    );
  }
  if (as?.location) lines.push(`- Location: ${as.location}`);
  if (as?.sceneGoal) lines.push(`- Scene goal: ${as.sceneGoal}`);
  if (as?.emotionalTone) lines.push(`- Emotional tone: ${as.emotionalTone}`);
  if (Array.isArray(as?.openThreads) && as.openThreads.length) {
    lines.push("- Open threads:");
    for (const t of as.openThreads) lines.push(`  • ${t}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

const renderEpisodicBlock = (events, characters) => {
  if (!events?.length) return "";
  const nameById = new Map((characters || []).map((c) => [String(c._id), c.name]));
  const lines = ["### RELEVANT MEMORIES"];
  for (const e of events) {
    const ref = `A${e.sceneRef?.actNumber}/S${e.sceneRef?.sceneIndex}`;
    const who = (e.characterIds || [])
      .map((id) => nameById.get(String(id)))
      .filter(Boolean)
      .join(", ");
    const head = `- [${ref}] ${e.eventType}${who ? ` — ${who}` : ""}`;
    lines.push(`${head}\n  ${e.summary}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

const renderRelationshipsBlock = (edges, characters) => {
  if (!edges?.length) return "";
  const nameById = new Map((characters || []).map((c) => [String(c._id), c.name]));
  const lines = ["### RELEVANT RELATIONSHIPS"];
  for (const e of edges) {
    const src = nameById.get(String(e.srcCharacterId)) || "Unknown";
    const dst = nameById.get(String(e.dstCharacterId)) || "Unknown";
    lines.push(
      `- ${src} → ${dst} (${e.type}): sentiment ${e.sentiment}, trust ${e.trust}`
    );
  }
  return lines.join("\n");
};

const COACHING_SCENE_MEMORY_SUMMARY_MAX = 160;

const renderSceneSliceBlock = (sceneMemories, focusScene, mode = "editor") => {
  if (!sceneMemories?.length) return "";
  const isCoaching = mode === "coaching";
  const lines = [
    isCoaching
      ? "### SCENE DESIGN REFERENCE (outline memories — not manuscript prose)"
      : "### OUTLINE SLICE (scene memories near focus)",
  ];
  for (const m of sceneMemories) {
    const ref = `A${m.sceneRef?.actNumber}/S${m.sceneRef?.sceneIndex}`;
    const isFocus =
      focusScene?.actNumber === m.sceneRef?.actNumber &&
      focusScene?.sceneIndex === m.sceneRef?.sceneIndex;
    const focused = isFocus ? " ⟵ COACHED SCENE" : "";
    const status = m.extractionStatus === "ok" ? "" : ` (${m.extractionStatus})`;
    let summaryBody = m.summary || "";
    if (isCoaching && isFocus) {
      summaryBody = `Intent: ${String(summaryBody).slice(0, COACHING_SCENE_MEMORY_SUMMARY_MAX)}`;
    }
    lines.push(
      `- [${ref}] **${m.title || "(untitled)"}**${focused}${status}\n  ${summaryBody}`
    );
  }
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Last-mutation-timestamp helper — drives the cache key
// ---------------------------------------------------------------------------

const getLastMutationTs = async (novelId, userId) => {
  // Use the latest `updatedAt` across the memory collections + outline
  // sources. The assembler cache key incorporates this so any structural
  // edit invalidates the cached prompt for that novel within one turn.
  const rows = await Promise.all([
    Novel.findOne({ _id: novelId }).select("updatedAt").lean(),
    UserContent.findOne({ novelId, user: userId })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean(),
    StoryResponse.findOne({ novel: novelId, user: userId })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean(),
    StoryState.findOne({ novelId }).select("updatedAt").lean(),
    ActiveSceneState.findOne({ novelId }).select("updatedAt").lean(),
    SceneMemory.findOne({ novelId }).sort({ updatedAt: -1 }).select("updatedAt").lean(),
    EpisodicEvent.findOne({ novelId }).sort({ updatedAt: -1 }).select("updatedAt").lean(),
    CharacterState.findOne({ novelId }).sort({ updatedAt: -1 }).select("updatedAt").lean(),
    RelationshipEdge.findOne({ novelId }).sort({ updatedAt: -1 }).select("updatedAt").lean(),
    Character.findOne({ novel: novelId })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean(),
  ]);
  let best = null;
  for (const r of rows) {
    if (r?.updatedAt && (!best || r.updatedAt > best)) best = r.updatedAt;
  }
  return best || new Date(0);
};

// ---------------------------------------------------------------------------
// Demotion order (Phase 4 task `phase4-token-guard`)
// ---------------------------------------------------------------------------

/**
 * Sections are pruned in this order, lowest-priority first, until the
 * total prefix fits inside `TOTAL_TOKEN_BUDGET`. Indices are stable so
 * tests can pin against the order:
 *   1. Oldest half of episodic memories.
 *   2. Outline slice memories furthest from focus.
 *   3. Lower half of relationship edges.
 *   4. Relevant-characters detail fragments (mood/goal/secrets).
 *   5. Methodology block `notes` / `subplotReminder` fields (returned
 *      pre-stripped from `methodologyService` when over budget — handled
 *      via the public boolean below).
 *
 * We trim each section in place rather than constructing a new pipeline
 * because keeping section order stable is what makes OpenAI's prompt
 * cache hit (the `instructions` field stays byte-identical across turns
 * for a stable novel).
 */
const applyTokenBudget = ({
  instructions,
  memorySections,
  methodologyTokens,
  budget = OLIVIA_EDITOR_TOKEN_BUDGET,
  protectedCharacterIds = null,
}) => {
  let total = charsToTokens(instructions);
  for (const s of memorySections) total += charsToTokens(s.text);

  if (total <= budget) return { memorySections, demoted: [] };

  const demoted = [];

  // Step 1: drop the oldest half of episodic memories (last in array
  // order represents the oldest after sort-by-score, so trim from the
  // tail).
  const episodic = memorySections.find((s) => s.id === "episodic");
  if (episodic && episodic.items?.length > 1) {
    const keep = Math.ceil(episodic.items.length / 2);
    const dropped = episodic.items.slice(keep);
    episodic.items = episodic.items.slice(0, keep);
    episodic.text = episodic.render(episodic.items);
    demoted.push(`episodic:-${dropped.length}`);
    total = charsToTokens(instructions);
    for (const s of memorySections) total += charsToTokens(s.text);
    if (total <= budget) return { memorySections, demoted };
  }

  // Step 2: trim outline slice to focus scene only.
  const slice = memorySections.find((s) => s.id === "outlineSlice");
  if (slice && slice.items?.length > 1) {
    slice.items = slice.items.slice(0, 1);
    slice.text = slice.render(slice.items);
    demoted.push("outlineSlice:focus-only");
    total = charsToTokens(instructions);
    for (const s of memorySections) total += charsToTokens(s.text);
    if (total <= budget) return { memorySections, demoted };
  }

  // Step 3: drop lower half of relationship edges.
  const edges = memorySections.find((s) => s.id === "edges");
  if (edges && edges.items?.length > 1) {
    const keep = Math.ceil(edges.items.length / 2);
    edges.items = edges.items.slice(0, keep);
    edges.text = edges.render(edges.items);
    demoted.push("edges:halved");
    total = charsToTokens(instructions);
    for (const s of memorySections) total += charsToTokens(s.text);
    if (total <= budget) return { memorySections, demoted };
  }

  // Step 4: strip character detail fragments (keep names + roles).
  const chars = memorySections.find((s) => s.id === "characters");
  const hasProtectedChars =
    protectedCharacterIds instanceof Set
      ? protectedCharacterIds.size > 0
      : Array.isArray(protectedCharacterIds) && protectedCharacterIds.length > 0;
  if (chars && chars.bareItems && !chars.protectCanon && !hasProtectedChars) {
    chars.text = chars.bareItems;
    demoted.push("characters:bare");
    total = charsToTokens(instructions);
    for (const s of memorySections) total += charsToTokens(s.text);
    if (total <= budget) return { memorySections, demoted };
  }

  // Step 5: hard truncate largest non-critical sections until within budget.
  const hardTruncateOrder = [
    "fullStoryBible",
    "storyBible",
    "novelFoundation",
    "characters",
    "outlineSlice",
    "episodic",
    "edges",
  ];
  for (const id of hardTruncateOrder) {
    total = charsToTokens(instructions);
    for (const s of memorySections) total += charsToTokens(s.text);
    if (total <= budget) break;

    const section = memorySections.find((s) => s.id === id);
    if (!section?.text?.trim()) continue;

    const otherTokens =
      total - charsToTokens(section.text);
    const sectionBudgetChars = Math.max(
      200,
      (budget - otherTokens) * 4
    );
    if (sectionBudgetChars < section.text.length) {
      section.text = truncateSectionText(section.text, sectionBudgetChars);
      demoted.push(`${id}:hardTruncate`);
    }
  }

  total = charsToTokens(instructions);
  for (const s of memorySections) total += charsToTokens(s.text);
  if (total > budget) {
    console.warn(
      JSON.stringify({
        scope: "contextAssembler",
        op: "hardTruncate",
        demoted,
        finalTokens: total,
        budget,
      })
    );
  }

  return { memorySections, demoted, methodologyTokens };
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assemble the full Olivia context for one chat turn.
 *
 * Returns:
 *   {
 *     instructions,       // string — stable prefix for openai.responses.create
 *     memoryBlockMessage, // { role: 'system', content } | null — slot first in `input`
 *     focusCharacterIds,  // string[] — characters relevant to this turn
 *     focusScene,         // { actNumber, sceneIndex } | null
 *     characterLookup,    // { lowercaseName -> id } — used by memoryWorker
 *     methodologyBlockTokens,
 *     demoted,            // string[] — sections trimmed by the budget guard
 *   }
 */
export const assembleOliviaContext = async ({
  novel,
  novelId,
  userId,
  mode = "editor", // "editor" | "scene" | "coaching"
  targetScene = null,
  userMessage = "",
  baseInstructions = "",
  runtimeRules = "",
}) => {
  if (!novel || !novelId || !userId) {
    throw new Error(
      "assembleOliviaContext: novel + novelId + userId are required"
    );
  }

  const lastMutationTs = await getLastMutationTs(novelId, userId);
  const ck = cacheKey({
    novelId: String(novelId),
    userId: String(userId),
    mode,
    focusKey: focusKey(targetScene),
    lastMutationTs,
  });
  const cached = getCached(ck);

  // -----------------------------------------------------------------
  // Load every collection in parallel. Many of these can legitimately
  // be empty (pre-seed novels); rendering is defensive.
  // -----------------------------------------------------------------
  const [storyState, activeScene, characters, characterStates, userContents] =
    await Promise.all([
      StoryState.findOne({ novelId }).lean(),
      ActiveSceneState.findOne({ novelId }).lean(),
      Character.find({ novel: novelId }).lean(),
      CharacterState.find({ novelId }).lean(),
      UserContent.find({ novelId, user: userId })
        .select("actNumber sceneIndex archivedAt")
        .lean(),
    ]);

  const charactersWithDossiers = resolveCharactersForOlivia(
    novel,
    novelId,
    characters
  );
  const sparseCanon = isSparseCanon(novel, charactersWithDossiers);
  const fullCanon = shouldUseFullCanonContext(novel, charactersWithDossiers);
  const characterLookup = buildCharacterLookup(
    charactersWithDossiers.filter((c) => !String(c._id).startsWith("cast-") && !String(c._id).startsWith("mp:"))
  );

  const offsets = computeActOffsets(userContents);
  const focusScene = (() => {
    const raw =
      targetScene && targetScene.actNumber && targetScene.sceneIndex
        ? {
            actNumber: Number(targetScene.actNumber),
            sceneIndex: Number(targetScene.sceneIndex),
            globalSceneNumber: targetScene.globalSceneNumber,
          }
        : activeScene?.currentScene || null;
    if (!raw?.actNumber || raw?.sceneIndex == null) return raw;
    return {
      ...raw,
      globalSceneNumber: getGlobalSceneNumber(
        raw.actNumber,
        raw.sceneIndex,
        offsets
      ),
    };
  })();

  // Resolve focus character IDs from active scene + mention scan.
  const mentioned = findMentionedCharacters(userMessage || "", charactersWithDossiers);
  const focusCharacterIds = Array.from(
    new Set([
      ...(activeScene?.activeCharacterIds || []).map(String),
      ...mentioned,
    ])
  );

  const spineSceneIndex = resolveSpineSceneIndex(focusScene, userContents);
  const archivedKeys = archivedSceneRefKeySet(userContents);

  // Phase 1.5 methodology block — omitted in Office 3 coaching mode (tokens + no STEP-2).
  const methodology =
    mode === "coaching"
      ? { block: "", tokenEstimate: 0, sourcesUsed: [] }
      : await getMethodologyBlock({
          phase: storyState?.layeringPhase || "outlining",
          genre: novel.genre || "",
          sceneIndex: spineSceneIndex,
        });

  // -----------------------------------------------------------------
  // Instructions (stable across turns → prompt-cache friendly)
  //
  // Order:
  //   1. AgentPrompt persona
  //   2. Methodology block (rules → template → genre overlays)
  //   3. Runtime rules (active-phase slice only)
  //
  // Master prompt + outline + state + memories all live in the
  // dynamic `memoryBlockMessage` so changes there don't bust the
  // cache.
  // -----------------------------------------------------------------
  const instructionsParts = [];
  if (baseInstructions?.trim()) instructionsParts.push(baseInstructions.trim());
  if (methodology.block) instructionsParts.push(methodology.block);
  if (runtimeRules?.trim()) instructionsParts.push(runtimeRules.trim());
  instructionsParts.push(OLIVIA_CANON_INTEGRITY_RULE);
  const instructions = instructionsParts.join("\n\n");

  // -----------------------------------------------------------------
  // Memory sections (dynamic — go into `input` as a single
  // system-role message so they DON'T bust the prompt cache).
  // -----------------------------------------------------------------

  const canonIntent = classifyOliviaCanonIntent(userMessage, charactersWithDossiers);
  const {
    canonQuery,
    requiresCanonExpansion,
    mentionedIds: intentMentionedIds,
  } = canonIntent;

  const {
    characters: relevantCharacters,
    dossierMaxChars,
    includeAll: includeAllCharacters,
    rosterOnly,
    fullDossierCharacterIds,
  } = selectCharactersForContext(
    charactersWithDossiers,
    focusCharacterIds,
    userMessage,
    {
      sparseCanon,
      fullCanon,
      mode,
      activeCharacterIds: activeScene?.activeCharacterIds || [],
      requiresCanonExpansion,
      mentionedIds: intentMentionedIds,
    }
  );

  const retrievalFocusIds =
    fullCanon || canonQuery || requiresCanonExpansion
      ? charactersWithDossiers
          .filter((c) => !String(c._id).startsWith("mp:") && !String(c._id).startsWith("cast-"))
          .map((c) => String(c._id))
      : focusCharacterIds;

  const { episodicEvents: rankedEvents, relationshipEdges: relevantEdges, sceneSlice: sliceMemories } =
    await retrieveRelevant({
      novelId,
      userMessage: userMessage || "",
      focusScene,
      focusCharacterIds: retrievalFocusIds,
      storyState,
      excludeSceneRefs: archivedKeys,
    });

  // Read the dossier-free Story Bible field. `Novel.storyBible` is
  // lazy-populated from `masterPrompt` on book load (see getNovelDetails)
  // and the strip happens there, so every prompt path here sees clean
  // text with no inline character-dossier blocks.
  const fullStoryBible =
    fullCanon && novel.storyBible?.trim()
      ? buildFullStoryBibleBlock(novel.storyBible)
      : "";

  const novelFoundation =
    fullStoryBible || !sparseCanon ? "" : buildNovelFoundationBlock(novel);

  const storyBibleCanon =
    !fullStoryBible && requiresCanonExpansion && novel.storyBible?.trim()
      ? buildStoryBibleCanonExcerpt(novel.storyBible, novel)
      : "";

  const storyBibleLight =
    !fullStoryBible &&
    !storyBibleCanon &&
    novel.storyBible?.trim()
      ? buildStoryBibleLightExcerpt(novel.storyBible, novel)
      : "";

  const bareRelevantCharacters =
    relevantCharacters.length > 0
      ? "### RELEVANT CHARACTERS\n" +
        relevantCharacters
          .map((c) => `- ${c.name}${c.character ? ` (${c.character})` : ""}`)
          .join("\n")
      : "";

  // Sections built as objects so the budget guard can mutate `items`.
  const memorySections = [
    {
      id: "fullStoryBible",
      text: fullStoryBible,
      protectCanon: Boolean(fullStoryBible),
    },
    {
      id: "novelFoundation",
      text: novelFoundation,
    },
    {
      id: "storyBible",
      text: storyBibleCanon || storyBibleLight,
    },
    {
      id: "storyState",
      text: renderStoryStateBlock(storyState),
    },
    {
      id: "activeScene",
      text: renderActiveSceneBlock(activeScene, focusScene),
    },
    {
      id: "characters",
      text: renderRelevantCharactersBlock(relevantCharacters, characterStates, {
        dossierMaxChars,
        includeAll: includeAllCharacters,
        rosterOnly,
        fullDossierCharacterIds,
      }),
      bareItems: bareRelevantCharacters,
      protectCanon:
        fullCanon && mode === "scene"
          ? true
          : requiresCanonExpansion || fullDossierCharacterIds.size > 0,
    },
    {
      id: "outlineSlice",
      items: sliceMemories,
      render: (items) => renderSceneSliceBlock(items, focusScene, mode),
      text: renderSceneSliceBlock(sliceMemories, focusScene, mode),
    },
    {
      id: "episodic",
      items: rankedEvents,
      render: (items) => renderEpisodicBlock(items, charactersWithDossiers),
      text: renderEpisodicBlock(rankedEvents, charactersWithDossiers),
    },
    {
      id: "edges",
      items: relevantEdges,
      render: (items) => renderRelationshipsBlock(items, charactersWithDossiers),
      text: renderRelationshipsBlock(relevantEdges, charactersWithDossiers),
    },
  ];

  // Filter empty sections so we don't push blank headers into the prompt.
  const populated = memorySections.filter((s) => s.text && s.text.trim());

  const tokenBudget = resolveOliviaTokenBudget({
    mode,
    canonQuery,
    fullCanon,
    requiresCanonExpansion,
  });

  const protectedCharacterIds =
    fullDossierCharacterIds instanceof Set
      ? fullDossierCharacterIds
      : new Set(fullDossierCharacterIds || []);

  // Token-budget guard.
  const { memorySections: budgeted, demoted } = applyTokenBudget({
    instructions,
    memorySections: populated,
    methodologyTokens: methodology.tokenEstimate,
    budget: tokenBudget,
    protectedCharacterIds,
  });

  const dynamicHeader = focusScene
    ? `OLIVIA STATE BLOCK (per-turn — these update as the writer makes decisions). Focus: ${formatActChapterRef(focusScene.actNumber, focusScene.globalSceneNumber || focusScene.sceneIndex)}.`
    : `OLIVIA STATE BLOCK (per-turn — these update as the writer makes decisions).`;

  const memoryBody = [dynamicHeader, ...budgeted.map((s) => s.text)]
    .filter(Boolean)
    .join("\n\n");

  const memoryBlockMessage =
    memoryBody && memoryBody !== dynamicHeader
      ? { role: "system", content: memoryBody }
      : null;

  const chainHotMemoryBlockMessage = buildChainHotMemoryBlock({
    novel,
    characters: charactersWithDossiers,
    characterStates,
    mentionedIds: intentMentionedIds,
  });

  const result = {
    instructions,
    memoryBlockMessage,
    focusCharacterIds: retrievalFocusIds,
    focusScene,
    spineSceneIndex,
    characterLookup,
    methodologyBlockTokens: methodology.tokenEstimate,
    demoted,
    fullCanonApplied: fullCanon,
    lastMutationTs,
    requiresCanonExpansion,
    mentionedCharacterIds: intentMentionedIds,
    chainHotMemoryBlockMessage,
  };

  // Reuse only stable `instructions` from cache (prompt-cache friendly).
  // Per-turn memoryBlockMessage depends on userMessage (mentions, canon Q&A).
  if (cached?.instructions && cached.instructions === result.instructions) {
    return { ...result, instructions: cached.instructions };
  }
  setCached(ck, { instructions: result.instructions });
  return result;
};

export const _internal = {
  applyTokenBudget,
  charsToTokens,
  findMentionedCharacters,
  truncateSectionText,
};
