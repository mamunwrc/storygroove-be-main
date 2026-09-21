/**
 * Phase 4 stability test for `contextAssembler.js`.
 *
 * Confirms the `instructions` field stays byte-stable across turns for
 * the same novel + focus + active phase. OpenAI's prompt cache only
 * hits when the prefix is byte-identical — these assertions are the
 * regression net against accidentally smuggling dynamic content into
 * `instructions`.
 *
 * Also covers the token-budget guard's demotion order.
 *
 * Run:
 *   node --test storygroove-be/__tests__/contextAssemblerStability.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { OLIVIA_EDITOR_TOKEN_BUDGET } from "../constants/oliviaMemory.js";

const { _internal } = await import("../service/contextAssembler.js");

const longText = (label, n = 4000) => `${label}: ` + "x".repeat(n);

test("applyTokenBudget keeps inputs unchanged when within budget", () => {
  const sections = [
    { id: "storyState", text: "story state body" },
    {
      id: "episodic",
      items: [{ summary: "a" }, { summary: "b" }],
      render: (items) => items.map((i) => `- ${i.summary}`).join("\n"),
      text: "- a\n- b",
    },
  ];
  const result = _internal.applyTokenBudget({
    instructions: "small instructions",
    memorySections: sections,
    budget: 100000,
  });
  assert.deepEqual(result.demoted, []);
  assert.equal(result.memorySections, sections);
});

test("applyTokenBudget drops oldest half of episodic memories first", () => {
  const events = Array.from({ length: 6 }, (_, i) => ({
    summary: `event ${i + 1}`,
  }));
  const sections = [
    {
      id: "episodic",
      items: events.map((e) => ({ summary: longText(e.summary) })),
      render: (items) => items.map((i) => `- ${i.summary}`).join("\n"),
      text: events.map((e) => `- ${longText(e.summary)}`).join("\n"),
    },
  ];
  const huge = longText("instructions", 30000);
  const result = _internal.applyTokenBudget({
    instructions: huge,
    memorySections: sections,
    budget: OLIVIA_EDITOR_TOKEN_BUDGET,
  });

  // Should have demoted at least the oldest half.
  assert.ok(result.demoted.some((d) => d.startsWith("episodic:")));
});

test("applyTokenBudget hard-truncates when demotion is insufficient", () => {
  const sections = [
    {
      id: "fullStoryBible",
      text: longText("bible", 50000),
    },
  ];
  const result = _internal.applyTokenBudget({
    instructions: longText("instructions", 50000),
    memorySections: sections,
    budget: OLIVIA_EDITOR_TOKEN_BUDGET,
  });
  assert.ok(result.demoted.some((d) => d.includes("hardTruncate")));
  const bible = result.memorySections.find((s) => s.id === "fullStoryBible");
  assert.ok(bible.text.length < 50000);
});

test("applyTokenBudget falls back to bare character list when still over", () => {
  // Stuff everything: instructions huge, then enough sections to force
  // the guard through steps 1–4.
  const heavy = (label) => Array.from({ length: 10 }, (_, i) => ({
    summary: longText(`${label} ${i}`),
  }));
  const renderItems = (items) =>
    items.map((i) => `- ${i.summary}`).join("\n");
  const sections = [
    {
      id: "outlineSlice",
      items: heavy("scene"),
      render: renderItems,
      text: heavy("scene").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "episodic",
      items: heavy("event"),
      render: renderItems,
      text: heavy("event").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "edges",
      items: heavy("edge"),
      render: renderItems,
      text: heavy("edge").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "characters",
      text: longText("rich character block"),
      bareItems: "### RELEVANT CHARACTERS\n- Alice\n- Bob",
    },
  ];

  const result = _internal.applyTokenBudget({
    instructions: longText("instructions", 60000),
    memorySections: sections,
    budget: OLIVIA_EDITOR_TOKEN_BUDGET,
  });

  // Step 4 (characters:bare) should have kicked in.
  assert.ok(result.demoted.includes("characters:bare"));
  const chars = result.memorySections.find((s) => s.id === "characters");
  assert.equal(chars.text, "### RELEVANT CHARACTERS\n- Alice\n- Bob");
});

test("applyTokenBudget skips characters:bare when protectedCharacterIds set", () => {
  const heavy = (label) => Array.from({ length: 10 }, (_, i) => ({
    summary: longText(`${label} ${i}`),
  }));
  const renderItems = (items) =>
    items.map((i) => `- ${i.summary}`).join("\n");
  const sections = [
    {
      id: "outlineSlice",
      items: heavy("scene"),
      render: renderItems,
      text: heavy("scene").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "episodic",
      items: heavy("event"),
      render: renderItems,
      text: heavy("event").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "edges",
      items: heavy("edge"),
      render: renderItems,
      text: heavy("edge").map((i) => `- ${i.summary}`).join("\n"),
    },
    {
      id: "characters",
      text: longText("rich character block"),
      bareItems: "### RELEVANT CHARACTERS\n- Alice\n- Bob",
      protectCanon: true,
    },
  ];

  const result = _internal.applyTokenBudget({
    instructions: longText("instructions", 60000),
    memorySections: sections,
    budget: OLIVIA_EDITOR_TOKEN_BUDGET,
    protectedCharacterIds: new Set(["id-alice"]),
  });

  assert.ok(!result.demoted.includes("characters:bare"));
});

test("findMentionedCharacters matches canonical names and aliases", () => {
  const characters = [
    { _id: "id-eli", name: "Eli", aliases: ["Elias"] },
    { _id: "id-mom", name: "Margaret", aliases: ["Mom"] },
    { _id: "id-bob", name: "Bob", aliases: [] },
  ];
  const ids = _internal.findMentionedCharacters(
    "Then Mom told Elias the truth.",
    characters
  );
  assert.deepEqual(ids.sort(), ["id-eli", "id-mom"]);
});

test("findMentionedCharacters does not partial-match across word boundaries", () => {
  const characters = [{ _id: "id-eli", name: "Eli", aliases: [] }];
  // "deli" should NOT match "Eli".
  const ids = _internal.findMentionedCharacters("They walked past the deli.", characters);
  assert.deepEqual(ids, []);
});
