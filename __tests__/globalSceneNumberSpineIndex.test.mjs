/**
 * Spine index mapping: per-act sceneIndex → global PromptTemplate key 1–15.
 *
 * Run:
 *   node --test storygroove-be/__tests__/globalSceneNumberSpineIndex.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeActOffsets,
  getGlobalSceneNumber,
  resolveSpineSceneIndex,
  chapterNumberForFocus,
  formatActChapterRef,
} from "../utils/globalSceneNumber.js";

const standardGrid = () => {
  const contents = [];
  for (let act = 1; act <= 3; act++) {
    for (let scene = 1; scene <= 5; scene++) {
      contents.push({ actNumber: act, sceneIndex: scene });
    }
  }
  return contents;
};

test("resolveSpineSceneIndex: Act 1 Scene 1 → spine 1", () => {
  const spine = resolveSpineSceneIndex(
    { actNumber: 1, sceneIndex: 1 },
    standardGrid()
  );
  assert.equal(spine, 1);
});

test("resolveSpineSceneIndex: Act 2 Scene 3 → spine 8 (not per-act 3)", () => {
  const contents = standardGrid();
  const offsets = computeActOffsets(contents);
  assert.equal(getGlobalSceneNumber(2, 3, offsets), 8);
  const spine = resolveSpineSceneIndex({ actNumber: 2, sceneIndex: 3 }, contents);
  assert.equal(spine, 8);
});

test("resolveSpineSceneIndex: null when focus scene missing", () => {
  assert.equal(resolveSpineSceneIndex(null, standardGrid()), null);
});

test("chapterNumberForFocus uses continuous count (Act 2 slot 7 → Chapter 15 when Act 1 has 8)", () => {
  const contents = [];
  for (let scene = 1; scene <= 8; scene++) {
    contents.push({ actNumber: 1, sceneIndex: scene });
  }
  for (let scene = 1; scene <= 7; scene++) {
    contents.push({ actNumber: 2, sceneIndex: scene });
  }
  assert.equal(
    chapterNumberForFocus({ actNumber: 2, sceneIndex: 7 }, contents),
    15
  );
  assert.equal(formatActChapterRef(2, 15), "Act 2, Chapter 15");
});

test("chapterNumberForFocus: Act 3 slot 1 is Chapter 11 on the 15-spine", () => {
  assert.equal(
    chapterNumberForFocus({ actNumber: 3, sceneIndex: 1 }, standardGrid()),
    11
  );
});
