import test from "node:test";
import assert from "node:assert/strict";

import {
  OLIVIA_METADATA_KIND_OUTLINE_CONFIRM,
  OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED,
  OLIVIA_CORE_SPINE_LOCKED_TEXT,
  OLIVIA_CORE_NEXT_SCENE_CONFIRM_TEXT,
  OLIVIA_CORE_SCENE_SAVED_CONFIRM_TEXT,
  resolveOliviaCoreSaveConfirm,
} from "../constants/oliviaUiMessages.js";

test("resolveOliviaCoreSaveConfirm uses next-scene copy while core slots remain", () => {
  const confirm = resolveOliviaCoreSaveConfirm({
    nextEmptySlot: { actNumber: 1, sceneIndex: 2 },
    hadEmptyCoreSlot: true,
    alreadyPostedSpineLock: false,
  });
  assert.equal(confirm.kind, OLIVIA_METADATA_KIND_OUTLINE_CONFIRM);
  assert.equal(confirm.content, OLIVIA_CORE_NEXT_SCENE_CONFIRM_TEXT);
  assert.doesNotMatch(confirm.content, /All 15 core (?:scenes|chapters) are now locked/);
});

test("resolveOliviaCoreSaveConfirm posts lock script only when filling the last core slot", () => {
  const confirm = resolveOliviaCoreSaveConfirm({
    nextEmptySlot: null,
    hadEmptyCoreSlot: true,
    alreadyPostedSpineLock: false,
  });
  assert.equal(confirm.kind, OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED);
  assert.equal(confirm.content, OLIVIA_CORE_SPINE_LOCKED_TEXT);
  assert.match(confirm.content, /All 15 core chapters are now locked/);
});

test("resolveOliviaCoreSaveConfirm does not repeat lock after it was already posted", () => {
  const confirm = resolveOliviaCoreSaveConfirm({
    nextEmptySlot: null,
    hadEmptyCoreSlot: true,
    alreadyPostedSpineLock: true,
  });
  assert.equal(confirm.kind, OLIVIA_METADATA_KIND_OUTLINE_CONFIRM);
  assert.equal(confirm.content, OLIVIA_CORE_SCENE_SAVED_CONFIRM_TEXT);
  assert.doesNotMatch(confirm.content, /All 15 core (?:scenes|chapters) are now locked/);
  assert.doesNotMatch(confirm.content, /Ready to see your table/);
});

test("resolveOliviaCoreSaveConfirm does not use lock script on later saves after 15 are filled", () => {
  const confirm = resolveOliviaCoreSaveConfirm({
    nextEmptySlot: null,
    hadEmptyCoreSlot: false,
    alreadyPostedSpineLock: false,
  });
  assert.equal(confirm.kind, OLIVIA_METADATA_KIND_OUTLINE_CONFIRM);
  assert.equal(confirm.content, OLIVIA_CORE_SCENE_SAVED_CONFIRM_TEXT);
  assert.doesNotMatch(confirm.content, /All 15 core (?:scenes|chapters) are now locked/);
});
