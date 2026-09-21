/**
 * Run: node --test storygroove-be/__tests__/oliviaDynamicContext.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildOliviaDynamicContext, buildMinimalNovelHeader, buildSceneExtrasBlock } = await import(
  "../service/oliviaDynamicContext.js"
);

test("buildOliviaDynamicContext skips full outline when assembler has outline slice", () => {
  const assembled = {
    memoryBlockMessage: {
      role: "system",
      content: "OLIVIA STATE BLOCK\n\n### OUTLINE SLICE (scene memories near focus)\n- scene",
    },
  };
  const outline = "\nCURRENT OUTLINE (all scenes in narrative order):\nScene 1...\nScene 15...";
  const msg = buildOliviaDynamicContext({
    assembled,
    outlineContext: outline,
    povRotationBlock: "",
    bibleSlice: "BIBLE",
    novel: { name: "Test" },
  });
  assert.ok(msg);
  assert.doesNotMatch(msg.content, /all scenes in narrative order/);
  assert.match(msg.content, /OUTLINE SLICE/);
  assert.match(msg.content, /BIBLE/);
});

test("buildOliviaDynamicContext uses outline when no assembler slice", () => {
  const assembled = {
    memoryBlockMessage: { role: "system", content: "OLIVIA STATE BLOCK only" },
  };
  const outline = "CURRENT OUTLINE (focus-windowed):\nScene 1";
  const msg = buildOliviaDynamicContext({
    assembled,
    outlineContext: outline,
    povRotationBlock: "",
    bibleSlice: "",
    novel: null,
  });
  assert.match(msg.content, /focus-windowed/);
});

test("buildMinimalNovelHeader is compact", () => {
  const h = buildMinimalNovelHeader({ name: "My Novel", genre: "Thriller" });
  assert.match(h, /My Novel/);
  assert.doesNotMatch(h, /Scene 1/);
});

test("avatar draft block is present without Office 3 coaching scope", () => {
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: "Eliza opened the west corridor door.",
    draftSceneMeta: {
      actNumber: 1,
      sceneIndex: 2,
      sceneTitle: "The Locked Room",
    },
  });
  assert.match(extras, /WRITER'S MANUSCRIPT DRAFT \(Book Editor\)/);
  assert.match(extras, /Eliza opened the west corridor door/);
  assert.match(extras, /Act 1, Chapter 2/);
  assert.doesNotMatch(extras, /OFFICE 3 COACHING SCOPE/);
  assert.doesNotMatch(extras, /COACHING TARGET/);
});

test("coaching draft block unchanged when coachSceneMeta is set", () => {
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: "Eliza opened the west corridor door.",
    coachSceneMeta: {
      actNumber: 1,
      sceneIndex: 2,
      sceneTitle: "The Locked Room",
    },
  });
  assert.match(extras, /OFFICE 3 COACHING SCOPE/);
  assert.match(extras, /COACHING TARGET — WRITER'S MANUSCRIPT DRAFT/);
  assert.match(extras, /Eliza opened the west corridor door/);
  assert.doesNotMatch(extras, /Book Editor\)/);
});
