/**
 * Phase 1.5C — methodologyService snapshot tests.
 *
 * Goal: catch accidental ordering / formatting changes to the
 * assembled methodology block that would invalidate OpenAI's prompt
 * cache, even if the underlying content is the same.
 *
 * Strategy: monkey-patch the three Mongoose model classes with
 * synchronous fixture data so the test runs without a live Mongo
 * connection. We only stub the call shapes the service actually uses
 * (`find`, `findOne`, with `.sort().lean()` chaining where applicable).
 *
 * Run:
 *   node --test storygroove-be/__tests__/methodologyServiceSnapshot.test.mjs
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";

const MethodologyRule = (await import("../models/methodologyRuleModel.js")).default;
const PromptTemplate = (await import("../models/promptTemplateModel.js")).default;
const GenreOverlay = (await import("../models/genreOverlayModel.js")).default;
const { getMethodologyBlock, invalidateMethodologyCache, _internal } = await import(
  "../service/methodologyService.js"
);

// --- fixtures ---------------------------------------------------------------

const fixtureRules = [
  {
    key: "rule_universal_high",
    title: "Universal Rule (High Priority)",
    scope: "universal",
    phase: null,
    priority: 95,
    enabled: true,
    summary: "Universal high-priority rule.",
    text: "ALWAYS preserve POV across the scene; never head-hop.",
    source: "fixture#rule_universal_high",
  },
  {
    key: "rule_phase1_table",
    title: "Phase 1 Table Rule",
    scope: "phase",
    phase: ["phase1_table"],
    priority: 80,
    enabled: true,
    summary: "Phase-1 specific.",
    text: "When in phase1_table, deliver the layering table with NEW Scene rows spread across acts.",
    source: "fixture#rule_phase1_table",
  },
  {
    key: "rule_phase2_expansion",
    title: "Phase 2 Expansion Rule",
    scope: "phase",
    phase: ["phase2_expansion"],
    priority: 80,
    enabled: true,
    summary: "Phase-2 specific.",
    text: "In phase2_expansion, expand one NEW scene at a time using the cue script.",
    source: "fixture#rule_phase2_expansion",
  },
];

const fixtureTemplate = {
  key: "scene_9_midpoint",
  sceneIndex: 9,
  actNumber: 2,
  title: "The Midpoint — Truth, Shift, or Major Escalation",
  tentpoleHint: "midpoint",
  enabled: true,
  outputFormatLabels: [
    "Book Coaching for Scene",
    "Scene to Write",
    "Setting",
    "Significant Actions",
    "Emotional Reactions",
    "Subplot Tie-In",
    "Character Arc Movement",
  ],
  template: "Identify a key turning point in your story where [Protagonist] faces a significant event that changes the stakes.",
  coachingPrompt: "The Midpoint — Truth, Shift, or Major Escalation — the story turns.",
  subplotReminder: "Let the subplot hit a turning point too.",
  source: "fixture#prompt_11+blueprint_act2_9",
};

const fixtureOverlayRomance = {
  genreKey: "romance",
  displayName: "Romance",
  category: "romance",
  appliesAs: "base_genre",
  aliases: ["regency romance", "contemporary romance"],
  beats: [
    { sceneIndex: 2, label: "Meet Cute", beat: "Establish romantic spark or tension." },
    { sceneIndex: 9, label: "Midpoint", beat: "Romantic tension shifts." },
  ],
  notes: "",
  applicabilityNote: "",
  enabled: true,
  source: "fixture#romance",
};

// --- stub harness -----------------------------------------------------------

const installStubs = () => {
  // The service queries `.find({...}).sort({...}).lean()` on the
  // rules model. Recreate that chain with our fixture data, filtered
  // by the actual `scope`/`phase`/`enabled` clauses the service uses.
  MethodologyRule.find = function (filter) {
    let rows = [...fixtureRules];
    if (filter?.enabled !== undefined) {
      rows = rows.filter((r) => r.enabled === filter.enabled);
    }
    if (filter?.$or) {
      rows = rows.filter((r) =>
        filter.$or.some((clause) => {
          if (clause.scope === "universal") return r.scope === "universal";
          if (clause.phase !== undefined) {
            return Array.isArray(r.phase) && r.phase.includes(clause.phase);
          }
          return false;
        })
      );
    }
    return {
      sort: () => ({
        lean: async () => rows.slice().sort((a, b) => b.priority - a.priority),
      }),
      lean: async () => rows,
    };
  };

  PromptTemplate.findOne = function (filter) {
    const match =
      filter?.sceneIndex === fixtureTemplate.sceneIndex ? fixtureTemplate : null;
    return { lean: async () => match };
  };

  GenreOverlay.findOne = function (filter) {
    if (
      filter?.genreKey === fixtureOverlayRomance.genreKey ||
      (filter?.aliases?.$in &&
        filter.aliases.$in.some((a) =>
          fixtureOverlayRomance.aliases.includes(a)
        ))
    ) {
      return { lean: async () => fixtureOverlayRomance };
    }
    return { lean: async () => null };
  };

  GenreOverlay.find = function () {
    return { lean: async () => [fixtureOverlayRomance] };
  };
};

before(() => {
  installStubs();
});

// --- tests ------------------------------------------------------------------

test("getMethodologyBlock: produces stable section ordering (cache-friendly)", async () => {
  invalidateMethodologyCache();
  const result = await getMethodologyBlock({
    phase: "phase1_table",
    genre: "romance",
    sceneIndex: 9,
  });
  const block = result.block;
  assert.ok(block.length > 0);

  // The four headers must appear in this order — the assembler relies
  // on it. Any reordering would tank prompt-cache hit rate.
  const idxHeader = block.indexOf("## OLIVIA METHODOLOGY");
  const idxRules = block.indexOf("### Craft Rules");
  const idxTemplate = block.indexOf("### Scene Template");
  const idxOverlay = block.indexOf("### Genre Overlay");

  assert.ok(idxHeader >= 0, "missing main header");
  assert.ok(idxRules > idxHeader, "Craft Rules must follow main header");
  assert.ok(idxTemplate > idxRules, "Scene Template must follow Craft Rules");
  assert.ok(idxOverlay > idxTemplate, "Genre Overlay must follow Scene Template");
});

test("getMethodologyBlock: stable byte output across two calls (cache hit)", async () => {
  invalidateMethodologyCache();
  const a = await getMethodologyBlock({
    phase: "phase1_table",
    genre: "romance",
    sceneIndex: 9,
  });
  const b = await getMethodologyBlock({
    phase: "phase1_table",
    genre: "romance",
    sceneIndex: 9,
  });
  assert.equal(a.block, b.block, "two identical lookups must produce byte-identical blocks");
  assert.equal(a.tokenEstimate, b.tokenEstimate);
});

test("getMethodologyBlock: phase change rotates phase rules", async () => {
  invalidateMethodologyCache();
  const p1 = await getMethodologyBlock({
    phase: "phase1_table",
    genre: "romance",
    sceneIndex: 9,
  });
  invalidateMethodologyCache();
  const p2 = await getMethodologyBlock({
    phase: "phase2_expansion",
    genre: "romance",
    sceneIndex: 9,
  });
  assert.ok(p1.block.includes("phase1_table"));
  assert.ok(p2.block.includes("phase2_expansion"));
  assert.notEqual(p1.block, p2.block);
});

test("getMethodologyBlock: missing scene index drops the Scene Template section", async () => {
  invalidateMethodologyCache();
  const result = await getMethodologyBlock({
    phase: "phase1_table",
    genre: "romance",
    sceneIndex: null,
  });
  assert.ok(!result.block.includes("### Scene Template"));
});

test("getMethodologyBlock: empty methodology yields empty block (fallback path)", async () => {
  // Override the rules stub to return nothing, simulating a fresh DB
  // before seeding.
  const origFind = MethodologyRule.find;
  MethodologyRule.find = function () {
    return {
      sort: () => ({ lean: async () => [] }),
      lean: async () => [],
    };
  };
  const origTemplateFindOne = PromptTemplate.findOne;
  PromptTemplate.findOne = function () {
    return { lean: async () => null };
  };
  const origOverlayFindOne = GenreOverlay.findOne;
  GenreOverlay.findOne = function () {
    return { lean: async () => null };
  };
  try {
    invalidateMethodologyCache();
    const result = await getMethodologyBlock({
      phase: "outlining",
      genre: "unknown",
      sceneIndex: 5,
    });
    assert.equal(result.block, "", "empty methodology must yield empty block (legacy fallback)");
  } finally {
    MethodologyRule.find = origFind;
    PromptTemplate.findOne = origTemplateFindOne;
    GenreOverlay.findOne = origOverlayFindOne;
  }
});

test("_internal.scoreOverlay: rank order matches expectations", () => {
  const { scoreOverlay, normalizeForMatch } = _internal;
  // Real signature: scoreOverlay(row, queryTokens, queryNorm).
  const tokenize = (s) => normalizeForMatch(s).split(/\s+/).filter(Boolean);
  const exact = scoreOverlay(
    { genreKey: "romance", displayName: "Romance", aliases: [] },
    tokenize("romance"),
    normalizeForMatch("romance")
  );
  const alias = scoreOverlay(
    {
      genreKey: "romance",
      displayName: "Romance",
      aliases: ["regency romance"],
    },
    tokenize("regency romance"),
    normalizeForMatch("regency romance")
  );
  const fuzzy = scoreOverlay(
    {
      genreKey: "sci_fi",
      displayName: "Science Fiction",
      aliases: ["space opera"],
    },
    tokenize("space adventure"),
    normalizeForMatch("space adventure")
  );
  assert.ok(exact >= alias, `exact (${exact}) >= alias (${alias})`);
  assert.ok(alias > fuzzy, `alias (${alias}) > fuzzy (${fuzzy})`);
});

test("_internal.estimateTokens: monotonic in string length", () => {
  const { estimateTokens } = _internal;
  const short = estimateTokens("hello world");
  const long = estimateTokens("hello world".repeat(100));
  assert.ok(long > short);
  assert.ok(short > 0);
});
