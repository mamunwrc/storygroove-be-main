/**
 * Phase 1.5C — methodology block token budget check.
 *
 * Asserts that across a curated `(phase, genre, sceneIndex)` matrix,
 * the assembled methodology block from `methodologyService` stays
 * below the per-turn instructions budget. The plan caps `instructions`
 * at ~8 K tokens (Phase 4 token-guard); the methodology block alone
 * should fit within ~4 K so we have headroom for AgentPrompt persona
 * + layering-phase rules.
 *
 * The test uses real-shaped fixtures (denser than the stubbed test in
 * `methodologyServiceSnapshot.test.mjs`) to better approximate the
 * production seed.
 *
 * Demotion: if the block ever exceeds the budget, the test
 * documents which sections were the biggest contributors, so the
 * content team can trim copy or re-order priorities before the seed
 * lands in prod.
 *
 * Run:
 *   node --test storygroove-be/__tests__/methodologyTokenBudget.test.mjs
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";

const MethodologyRule = (await import("../models/methodologyRuleModel.js")).default;
const PromptTemplate = (await import("../models/promptTemplateModel.js")).default;
const GenreOverlay = (await import("../models/genreOverlayModel.js")).default;
const { getMethodologyBlock, invalidateMethodologyCache, _internal } = await import(
  "../service/methodologyService.js"
);

// Room for mandatory delivery header + active-scene-beat lines (Phase 1.5B).
const METHODOLOGY_BUDGET_TOKENS = 4100;

// --- production-shaped fixtures --------------------------------------------

const makeRule = (overrides) => ({
  enabled: true,
  scope: "universal",
  phase: null,
  priority: 70,
  source: "fixture",
  summary: "",
  ...overrides,
});

// Approximates a heavy methodology seed: every rule has ~1 KB body.
// 16 universal + per-phase rules → realistic worst case.
const RULE_BODY = "x".repeat(900);
const fixtureRules = [
  ...Array.from({ length: 12 }, (_, i) =>
    makeRule({
      key: `universal_${i}`,
      title: `Universal ${i}`,
      text: RULE_BODY,
      priority: 90 - i,
    })
  ),
  ...["phase1_table", "phase2_expansion", "coaching"].flatMap((p) =>
    Array.from({ length: 2 }, (_, i) =>
      makeRule({
        scope: "phase",
        phase: [p],
        key: `${p}_${i}`,
        title: `${p} rule ${i}`,
        text: RULE_BODY,
        priority: 80 - i,
      })
    )
  ),
];

const fixtureTemplate = {
  key: "scene_9_midpoint",
  sceneIndex: 9,
  actNumber: 2,
  title: "The Midpoint",
  tentpoleHint: "midpoint",
  enabled: true,
  outputFormatLabels: ["A", "B", "C", "D", "E", "F", "G"],
  template: "y".repeat(800),
  coachingPrompt: "z".repeat(400),
  subplotReminder: "w".repeat(200),
  source: "fixture#tpl",
};

const fixtureOverlay = {
  genreKey: "epic_fantasy",
  displayName: "Epic Fantasy",
  category: "speculative",
  appliesAs: "base_genre",
  aliases: ["high fantasy", "epic fantasy"],
  beats: [
    { sceneIndex: 1, beat: "n".repeat(150) },
    { sceneIndex: 5, beat: "n".repeat(150) },
    { sceneIndex: 9, label: "Midpoint", beat: "n".repeat(200) },
    { sceneIndex: 12, beat: "n".repeat(150) },
    { sceneIndex: 14, beat: "n".repeat(200) },
    { sceneIndex: 15, beat: "n".repeat(150) },
  ],
  notes: "n".repeat(200),
  applicabilityNote: "n".repeat(150),
  enabled: true,
  source: "fixture#fantasy",
};

const installStubs = () => {
  MethodologyRule.find = function (filter) {
    let rows = [...fixtureRules].filter((r) => r.enabled);
    if (filter?.$or) {
      rows = rows.filter((r) =>
        filter.$or.some((clause) => {
          if (clause.scope === "universal") return r.scope === "universal";
          if (clause.phase !== undefined)
            return Array.isArray(r.phase) && r.phase.includes(clause.phase);
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
    return {
      lean: async () =>
        filter?.sceneIndex === fixtureTemplate.sceneIndex ? fixtureTemplate : null,
    };
  };
  GenreOverlay.findOne = function () {
    return { lean: async () => fixtureOverlay };
  };
  GenreOverlay.find = function () {
    return { lean: async () => [fixtureOverlay] };
  };
};

before(() => {
  installStubs();
});

// --- tests ------------------------------------------------------------------

const MATRIX = [
  ["phase1_table", "epic_fantasy", 1],
  ["phase1_table", "epic_fantasy", 9],
  ["phase1_table", "epic_fantasy", 14],
  ["phase2_expansion", "epic_fantasy", 9],
  ["coaching", "epic_fantasy", 9],
  ["outlining", "epic_fantasy", 1],
];

for (const [phase, genre, sceneIndex] of MATRIX) {
  test(`methodology block fits in ${METHODOLOGY_BUDGET_TOKENS} tokens — ${phase}/${genre}/scene${sceneIndex}`, async () => {
    invalidateMethodologyCache();
    const result = await getMethodologyBlock({ phase, genre, sceneIndex });
    assert.ok(
      result.tokenEstimate <= METHODOLOGY_BUDGET_TOKENS,
      `block too large for ${phase}/${genre}/scene${sceneIndex}: ${result.tokenEstimate} > ${METHODOLOGY_BUDGET_TOKENS}. ` +
        `Trim a rule's text field, drop a low-priority rule, or shorten the genre overlay beats. ` +
        `sourcesUsed: ${result.sourcesUsed.join(", ")}`
    );
  });
}

test("methodology tokenEstimate is reasonable for an empty result", async () => {
  // Force the empty-fallback path.
  const origFind = MethodologyRule.find;
  const origTpl = PromptTemplate.findOne;
  const origOverlayOne = GenreOverlay.findOne;
  const origOverlayMany = GenreOverlay.find;
  MethodologyRule.find = () => ({
    sort: () => ({ lean: async () => [] }),
    lean: async () => [],
  });
  PromptTemplate.findOne = () => ({ lean: async () => null });
  GenreOverlay.findOne = () => ({ lean: async () => null });
  GenreOverlay.find = () => ({ lean: async () => [] });
  try {
    invalidateMethodologyCache();
    const result = await getMethodologyBlock({
      phase: "outlining",
      genre: "unknown",
      sceneIndex: 1,
    });
    assert.equal(result.block, "");
    assert.equal(result.tokenEstimate, _internal.estimateTokens(""));
  } finally {
    MethodologyRule.find = origFind;
    PromptTemplate.findOne = origTpl;
    GenreOverlay.findOne = origOverlayOne;
    GenreOverlay.find = origOverlayMany;
  }
});
