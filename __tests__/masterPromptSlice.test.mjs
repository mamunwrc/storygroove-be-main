/**
 * Run: node --test storygroove-be/__tests__/masterPromptSlice.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildMasterPromptSlice, MAX_MASTER_PROMPT_SLICE_CHARS } = await import(
  "../service/masterPromptSlice.js"
);

const SAMPLE_BIBLE = `
**1. Genre**
Fantasy adventure

**13. Structure**
Rotating third-person POV across three leads.

**14. Tone**
Warm but tense

**👤 Alice: 17-Point Dossier**
1. Archetype
The brave one
`.trim();

test("outlining phase includes premise and structure not full dossiers", () => {
  const slice = buildMasterPromptSlice(SAMPLE_BIBLE, {
    layeringPhase: "outlining",
    novel: { genre: "Fantasy", protagonist: "Alice" },
  });
  assert.match(slice, /STORY BIBLE SLICE/);
  assert.match(slice, /Rotating third-person/);
  assert.match(slice, /Genre/);
  assert.doesNotMatch(slice, /17-Point Dossier/);
});

test("drafting phase omits dossier bodies and caps length", () => {
  const huge = `${SAMPLE_BIBLE}\n${"x".repeat(5000)}`;
  const slice = buildMasterPromptSlice(huge, {
    layeringPhase: "drafting",
    focusScene: { actNumber: 1, sceneIndex: 2 },
  });
  assert.match(slice, /Structure \/ POV overlay/);
  assert.doesNotMatch(slice, /1\. Archetype/);
  assert.ok(slice.length <= MAX_MASTER_PROMPT_SLICE_CHARS);
});
