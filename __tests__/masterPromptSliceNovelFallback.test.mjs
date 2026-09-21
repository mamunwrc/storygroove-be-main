/**
 * Run: node --test storygroove-be/__tests__/masterPromptSliceNovelFallback.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildMasterPromptSlice } = await import("../service/masterPromptSlice.js");

test("buildMasterPromptSlice uses novel record when masterPrompt empty", () => {
  const slice = buildMasterPromptSlice("", {
    layeringPhase: "outlining",
    novel: {
      genre: "Literary fiction",
      protagonist: "David Mercer",
      protagonistDescription: "An aging journalist.",
    },
  });
  assert.match(slice, /STORY BIBLE SLICE/);
  assert.match(slice, /David Mercer/);
  assert.match(slice, /journalist/);
});
