/**
 * Run: node --test storygroove-be/__tests__/fullCanonContext.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  shouldUseFullCanonContext,
  buildFullStoryBibleBlock,
  masterPromptIncludesDossiers,
  selectCharactersForContext,
  resolveCharactersForOlivia,
} = await import("../service/characterCanonContext.js");

const { resolveOliviaTokenBudget, OLIVIA_FULL_CANON_TOKEN_BUDGET } =
  await import("../constants/oliviaMemory.js");

const SAMPLE_MP = `
**1. Genre**
Fantasy

**👤 David Mercer: 17-Point Dossier**
1. Archetype
The weary investigator
`.trim();

// `shouldUseFullCanonContext` switches on a 400-char threshold against
// `storyBible` (the dossier-free field). Anything substantive enough to be
// a real Story Bible will exceed it; use a representative block here.
const SUBSTANTIAL_STORY_BIBLE = `
**📘 Story Bible**

**1. Genre**
Fantasy

**2. Setting**
A coastal city at the edge of a slowly dying empire, governed by a
brittle alliance between merchant houses and a faded priesthood.

**3. Theme**
The cost of refusing to surrender power, and the people who pay it
on your behalf.

**4. Structure**
Three acts. Rotating third-person POV across the three protagonists,
returning to David in every act-closing chapter.
`.trim();

test("shouldUseFullCanonContext returns true with a substantial storyBible (flag on)", () => {
  assert.equal(
    shouldUseFullCanonContext({ storyBible: SUBSTANTIAL_STORY_BIBLE }, []),
    true
  );
});

test("shouldUseFullCanonContext returns false when storyBible is empty even if masterPrompt is set", () => {
  assert.equal(
    shouldUseFullCanonContext({ masterPrompt: SAMPLE_MP, storyBible: "" }, []),
    false
  );
});

test("buildFullStoryBibleBlock wraps input verbatim (no internal stripping)", () => {
  const block = buildFullStoryBibleBlock(SAMPLE_MP);
  assert.match(block, /STORY BIBLE \(full/);
  assert.match(block, /David Mercer/);
  assert.match(block, /weary investigator/);
});

test("buildFullStoryBibleBlock no longer accepts the stripDossierBlocks option", () => {
  // Signature change: the strip happens once at lazy-populate time on
  // Novel.storyBible. This block is now a pure wrapper.
  assert.equal(buildFullStoryBibleBlock.length, 1);
});

test("full canon always includes full dossier bodies not roster-only", () => {
  const chars = [
    {
      _id: "1",
      name: "David Mercer",
      character: "protagonist",
      responseText: "1. Archetype\nThe weary investigator",
    },
  ];
  const sel = selectCharactersForContext(chars, [], "continue", {
    fullCanon: true,
    dossiersInMasterPrompt: masterPromptIncludesDossiers(SAMPLE_MP),
  });
  assert.equal(sel.rosterOnly, false);
  assert.equal(sel.dossierMaxChars, 0);
  assert.equal(sel.characters.length, 1);
});

test("resolveCharactersForOlivia merges dossiers only in masterPrompt", () => {
  const chars = resolveCharactersForOlivia(
    { masterPrompt: SAMPLE_MP },
    "n1",
    [{ _id: "1", name: "David Mercer", character: "protagonist", responseText: "" }]
  );
  assert.match(chars[0].responseText, /weary investigator/);
});

test("full canon scene mode includes non-active side characters (full roster)", () => {
  // The regression this guards: in plain scene mode, only the focus cast
  // (leads + active + mentioned) is selected, so Olivia never sees an
  // off-screen side character and may invent one. Full canon must override
  // the scene branch and return every character with untruncated dossiers.
  const chars = [
    { _id: "1", name: "Hero", character: "protagonist", responseText: "x".repeat(100) },
    { _id: "2", name: "Active Friend", character: "supporting", responseText: "y".repeat(100) },
    { _id: "3", name: "Off-Screen Aunt", character: "supporting", responseText: "z".repeat(100) },
  ];
  const sel = selectCharactersForContext(chars, [], "deliver scene 1", {
    fullCanon: true,
    mode: "scene",
    activeCharacterIds: ["2"],
  });
  assert.equal(sel.includeAll, true);
  assert.equal(sel.dossierMaxChars, 0);
  const names = sel.characters.map((c) => c.name);
  assert.deepEqual(names.sort(), ["Active Friend", "Hero", "Off-Screen Aunt"]);
});

test("scene mode selects focus cast not full roster", () => {
  const chars = [
    { _id: "1", name: "Hero", character: "protagonist", responseText: "x".repeat(100) },
    { _id: "2", name: "Side", character: "supporting", responseText: "y".repeat(100) },
  ];
  const sel = selectCharactersForContext(chars, ["2"], "deliver scene", {
    mode: "scene",
    activeCharacterIds: [],
  });
  assert.equal(sel.characters.length, 2);
  assert.equal(sel.dossierMaxChars, 2000);
  assert.equal(sel.includeAll, false);
});

test("resolveOliviaTokenBudget returns the full-canon budget when fullCanon", () => {
  assert.equal(
    resolveOliviaTokenBudget({ fullCanon: true }),
    OLIVIA_FULL_CANON_TOKEN_BUDGET
  );
});

test("resolveCharactersForOlivia prefers MongoDB dossier over masterPrompt", () => {
  const chars = resolveCharactersForOlivia(
    { masterPrompt: SAMPLE_MP },
    "n1",
    [
      {
        _id: "1",
        name: "David Mercer",
        character: "protagonist",
        responseText: "1. Archetype\nUpdated in the editor",
      },
    ]
  );
  assert.match(chars[0].responseText, /Updated in the editor/);
  assert.doesNotMatch(chars[0].responseText, /weary investigator/);
});

test("resolveCharactersForOlivia does not resurrect deleted names from masterPrompt once hydrated", () => {
  const masterPrompt = `
**👤 David Mercer: 17-Point Dossier**
1. Archetype
The weary investigator

**👤 Mara Chen: 17-Point Dossier**
1. Archetype
The fixer
`.trim();
  const chars = resolveCharactersForOlivia(
    { masterPrompt, characterDossiersHydrated: true },
    "n1",
    [{ _id: "1", name: "David Mercer", character: "protagonist", responseText: "kept" }]
  );
  assert.equal(chars.length, 1);
  assert.equal(chars[0].name, "David Mercer");
  assert.ok(!chars.some((c) => /Mara/i.test(c.name)));
});

test("resolveCharactersForOlivia does not reconstitute masterPrompt cast after hydrated empty roster", () => {
  const chars = resolveCharactersForOlivia(
    { masterPrompt: SAMPLE_MP, characterDossiersHydrated: true },
    "n1",
    []
  );
  assert.ok(!chars.some((c) => String(c._id).startsWith("mp:")));
});
