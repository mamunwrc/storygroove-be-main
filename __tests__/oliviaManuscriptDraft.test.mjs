import test from "node:test";
import assert from "node:assert/strict";

import {
  MANUSCRIPT_DRAFT_MAX_CHARS,
  buildManuscriptDraftBlock,
  buildManuscriptDraftPackBlock,
  buildDraftIndexBlock,
  buildSceneExtrasBlock,
  truncateManuscriptDraftForContext,
} from "../service/oliviaDynamicContext.js";

test("buildManuscriptDraftBlock returns empty for blank draft", () => {
  assert.equal(buildManuscriptDraftBlock(""), "");
  assert.equal(buildManuscriptDraftBlock("   "), "");
});

test("buildManuscriptDraftBlock includes header, scene label, and draft", () => {
  const block = buildManuscriptDraftBlock("She opened the door slowly.", {
    actNumber: 2,
    sceneIndex: 3,
    globalSceneNumber: 8,
    sceneTitle: "The Rooftop",
  });
  assert.match(block, /WRITER'S MANUSCRIPT DRAFT/);
  assert.match(block, /Act 2, Chapter 8/);
  assert.match(block, /The Rooftop/);
  assert.match(block, /She opened the door slowly/);
});

test("buildManuscriptDraftBlock truncates very long drafts", () => {
  const longDraft = "x".repeat(MANUSCRIPT_DRAFT_MAX_CHARS + 500);
  const block = buildManuscriptDraftBlock(longDraft, { actNumber: 1, sceneIndex: 1 });
  assert.match(block, /truncated/i);
  assert.ok(block.length < longDraft.length);
});

test("truncateManuscriptDraftForContext cuts at word boundary when possible", () => {
  const prefix = "a".repeat(MANUSCRIPT_DRAFT_MAX_CHARS - 20);
  const longDraft = `${prefix} friendship continues here and more words after`;
  const { text, truncated } = truncateManuscriptDraftForContext(longDraft);
  assert.equal(truncated, true);
  assert.ok(text.length <= MANUSCRIPT_DRAFT_MAX_CHARS);
  assert.doesNotMatch(text, /friendshi$/);
  assert.match(text, /friendship$/);
});

test("buildSceneExtrasBlock includes manuscript draft section", () => {
  const block = buildSceneExtrasBlock({
    manuscriptDraft: "Draft paragraph one.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 2, sceneTitle: "Opening" },
  });
  assert.match(block, /WRITER'S MANUSCRIPT DRAFT/);
  assert.match(block, /Draft paragraph one/);
});

test("buildDraftIndexBlock lists empty and filled scenes", () => {
  const block = buildDraftIndexBlock([
    {
      globalSceneNumber: 1,
      actNumber: 1,
      sceneIndex: 1,
      sceneTitle: "Arrival",
      hasProse: true,
      wordCount: 12,
    },
    {
      globalSceneNumber: 2,
      actNumber: 1,
      sceneIndex: 2,
      sceneTitle: "The Letter",
      hasProse: false,
      wordCount: 0,
    },
  ]);
  assert.match(block, /DRAFT INDEX/);
  assert.match(block, /Act 1 Chapter 1/);
  assert.match(block, /12 words/);
  assert.match(block, /empty/);
});

test("buildManuscriptDraftPackBlock returns empty when there is nothing to pack", () => {
  assert.equal(buildManuscriptDraftPackBlock([]), "");
});

test("buildManuscriptDraftPackBlock strips HTML and labels act/slot and global", () => {
  const block = buildManuscriptDraftPackBlock([
    {
      meta: {
        globalSceneNumber: 1,
        actNumber: 1,
        sceneIndex: 1,
        sceneTitle: "Arrival",
      },
      text: "<p>Chapter one prose.</p>",
    },
    {
      meta: {
        globalSceneNumber: 6,
        actNumber: 2,
        sceneIndex: 1,
        sceneTitle: "The Locked Room",
      },
      text: "<p>Chapter six prose.</p>",
    },
  ]);
  assert.match(block, /WRITER'S MANUSCRIPT DRAFT PACK/);
  assert.match(block, /Act 1 Chapter 1/);
  assert.match(block, /Act 2 Chapter 6/);
  assert.match(block, /Chapter one prose/);
  assert.match(block, /Chapter six prose/);
  assert.doesNotMatch(block, /<p>/);
});

test("buildManuscriptDraftPackBlock notes missing requested globals", () => {
  const block = buildManuscriptDraftPackBlock(
    [
      {
        meta: { globalSceneNumber: 1, actNumber: 1, sceneIndex: 1 },
        text: "<p>Only one</p>",
      },
    ],
    { missingGlobals: [2, 3, 4, 5, 6] }
  );
  assert.match(block, /Requested scenes not in the outline: 2-6/);
});

test("buildManuscriptDraftPackBlock redistributes leftover budget to later scenes", () => {
  const block = buildManuscriptDraftPackBlock(
    [
      {
        meta: { globalSceneNumber: 1, actNumber: 1, sceneIndex: 1 },
        text: "short",
      },
      {
        meta: { globalSceneNumber: 2, actNumber: 1, sceneIndex: 2 },
        text: "b".repeat(400),
      },
    ],
    { maxChars: 1200 }
  );
  const second = block.split("---").pop();
  assert.ok(second.includes("b".repeat(200)));
});
