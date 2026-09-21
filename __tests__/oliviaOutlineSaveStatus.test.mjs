import test from "node:test";
import assert from "node:assert/strict";

import { computeActOffsets } from "../utils/globalSceneNumber.js";
import {
  buildOliviaOutlineSaveStatusBlock,
  collectFilledOliviaCoreSlotKeys,
  findNextEmptyOliviaCoreSlot,
} from "../utils/oliviaOutlineSaveStatus.js";

const spineContents = (filledCount) => {
  const rows = [];
  for (let i = 0; i < filledCount; i++) {
    const actNumber = Math.floor(i / 5) + 1;
    const sceneIndex = (i % 5) + 1;
    rows.push({
      actNumber,
      sceneIndex,
      promptKey: `scene${i}`,
    });
  }
  return rows;
};

test("collectFilledOliviaCoreSlotKeys uses StoryResponse text", () => {
  const contents = [{ actNumber: 1, sceneIndex: 1, promptKey: "scene0" }];
  const responses = [{ promptKey: "scene0", responseText: "Scene Title: Hello" }];
  const filled = collectFilledOliviaCoreSlotKeys(contents, responses);
  assert.equal(filled.has("1-1"), true);
  assert.equal(findNextEmptyOliviaCoreSlot(filled).sceneIndex, 2);
});

test("findNextEmptyOliviaCoreSlot after 10 fills is Act 3 Chapter 11", () => {
  const contents = spineContents(10);
  const responses = contents.map((uc) => ({
    promptKey: uc.promptKey,
    responseText: "x",
  }));
  const filled = collectFilledOliviaCoreSlotKeys(contents, responses);
  assert.deepEqual(findNextEmptyOliviaCoreSlot(filled), {
    actNumber: 3,
    sceneIndex: 1,
  });
});

test("save status after Chapter 11 is saved does not allow unsaved nag", () => {
  const contents = spineContents(11);
  const responses = contents.map((uc) => ({
    promptKey: uc.promptKey,
    responseText: "x",
  }));
  const filled = collectFilledOliviaCoreSlotKeys(contents, responses);
  const actOffsets = computeActOffsets(contents);
  const nextEmptySlot = findNextEmptyOliviaCoreSlot(filled);
  const block = buildOliviaOutlineSaveStatusBlock({
    targetScene: nextEmptySlot,
    nextEmptySlot,
    filledSlotKeys: filled,
    actOffsets,
  });
  assert.match(block, /already saved/);
  assert.match(block, /Next unsaved core slot: Act 3, Chapter 12/);
  assert.match(block, /Do not flag a saved chapter as unsaved/);
  assert.doesNotMatch(block, /CURRENT TARGET Act 3, Chapter 11 is not in the outline/);
});

test("save status when FE still targets the just-saved chapter", () => {
  const contents = spineContents(11);
  const responses = contents.map((uc) => ({
    promptKey: uc.promptKey,
    responseText: "x",
  }));
  const filled = collectFilledOliviaCoreSlotKeys(contents, responses);
  const actOffsets = computeActOffsets(contents);
  const block = buildOliviaOutlineSaveStatusBlock({
    targetScene: { actNumber: 3, sceneIndex: 1 },
    nextEmptySlot: findNextEmptyOliviaCoreSlot(filled),
    filledSlotKeys: filled,
    actOffsets,
  });
  assert.match(
    block,
    /CURRENT TARGET Act 3, Chapter 11 is already saved\. Do not ask to lock it in/
  );
  assert.match(block, /Next unsaved core slot: Act 3, Chapter 12/);
});

test("save status flags only when the current target is actually empty", () => {
  const contents = spineContents(10);
  const responses = contents.map((uc) => ({
    promptKey: uc.promptKey,
    responseText: "x",
  }));
  const filled = collectFilledOliviaCoreSlotKeys(contents, responses);
  const actOffsets = computeActOffsets(contents);
  const nextEmptySlot = findNextEmptyOliviaCoreSlot(filled);
  const block = buildOliviaOutlineSaveStatusBlock({
    targetScene: nextEmptySlot,
    nextEmptySlot,
    filledSlotKeys: filled,
    actOffsets,
  });
  assert.match(block, /CURRENT TARGET Act 3, Chapter 11 is not in the outline yet/);
  assert.match(block, /Next unsaved core slot: Act 3, Chapter 11/);
});
