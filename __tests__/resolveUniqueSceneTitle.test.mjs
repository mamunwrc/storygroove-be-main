import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveUniqueSceneTitleFromTaken,
  MAX_SCENE_TITLE_LEN,
} from "../utils/resolveUniqueSceneTitle.js";

test("resolveUniqueSceneTitleFromTaken returns trimmed title when unique", () => {
  const taken = new Set(["other scene"]);
  const { finalTitle, titleWasRenamed } = resolveUniqueSceneTitleFromTaken(
    "  My Scene  ",
    taken
  );
  assert.equal(finalTitle, "My Scene");
  assert.equal(titleWasRenamed, false);
});

test("resolveUniqueSceneTitleFromTaken suffixes on case-insensitive collision", () => {
  const taken = new Set(["birthday party"]);
  const { finalTitle, titleWasRenamed } = resolveUniqueSceneTitleFromTaken(
    "Birthday Party",
    taken
  );
  assert.equal(finalTitle, "Birthday Party (2)");
  assert.equal(titleWasRenamed, true);
});

test("resolveUniqueSceneTitleFromTaken chains suffixes when (2) is taken", () => {
  const taken = new Set(["party", "party (2)"]);
  const { finalTitle, titleWasRenamed } = resolveUniqueSceneTitleFromTaken(
    "Party",
    taken
  );
  assert.equal(finalTitle, "Party (3)");
  assert.equal(titleWasRenamed, true);
});

test("resolveUniqueSceneTitleFromTaken caps at MAX_SCENE_TITLE_LEN", () => {
  const long = "A".repeat(130);
  const { finalTitle } = resolveUniqueSceneTitleFromTaken(long, new Set());
  assert.equal(finalTitle.length, MAX_SCENE_TITLE_LEN);
});

test("resolveUniqueSceneTitleFromTaken returns empty for blank input", () => {
  const { finalTitle, titleWasRenamed } = resolveUniqueSceneTitleFromTaken(
    "   ",
    new Set()
  );
  assert.equal(finalTitle, "");
  assert.equal(titleWasRenamed, false);
});
