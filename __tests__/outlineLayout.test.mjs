import test from "node:test";
import assert from "node:assert/strict";

// FE outline layout helpers (shared module path via relative import from BE tests)
import {
  buildOutlineLayout,
  computeLayoutPositionHash,
  resolveTargetSceneFromLayout,
  enrichTargetSceneFromUserContents,
  buildFullActGridFromUserContents,
} from "../../storygroove-fe/src/Pages/BookEditor/outlineLayout.js";

// outlineLayout imports sceneNumbering.js (no JSX) so these tests run under node --test.

test("buildFullActGridFromUserContents includes placeholders for empty slots", () => {
  const grid = buildFullActGridFromUserContents(
    {
      1: [{ _id: "a1", actNumber: 1, sceneIndex: 1, sceneTitle: "Open" }],
    },
    "novel-1"
  );
  assert.equal(grid.length, 3);
  assert.equal(grid[0].actScenes.length, 5);
  assert.equal(grid[0].actScenes[0].outlinePlaceholder, false);
  assert.equal(grid[0].actScenes[1].outlinePlaceholder, true);
});

test("buildOutlineLayout prefers userContent sceneTitle over storyResponse extraction", () => {
  const richText = "Scene Title: Original From Design\nPOV: Someone";
  const layout = buildOutlineLayout({
    userContents: [
      {
        _id: "s1",
        actNumber: 1,
        sceneIndex: 1,
        sceneTitle: "Renamed In Sidebar",
        promptKey: "scene1",
      },
    ],
    storyResponseMap: { scene1: richText },
    novelId: "n1",
    getSceneTitleText: (text) =>
      text.includes("Original From Design") ? "Original From Design" : "",
  });
  assert.equal(layout.length, 1);
  assert.equal(layout[0].title, "Renamed In Sidebar");
});

test("buildOutlineLayout extracts title from storyResponse when sceneTitle empty", () => {
  const richText = "Scene Title: From Design Only\nPOV: Someone";
  const layout = buildOutlineLayout({
    userContents: [
      {
        _id: "s1",
        actNumber: 1,
        sceneIndex: 1,
        promptKey: "scene1",
      },
    ],
    storyResponseMap: { scene1: richText },
    novelId: "n1",
    getSceneTitleText: (text) =>
      text.includes("From Design Only") ? "From Design Only" : "",
  });
  assert.equal(layout[0].title, "From Design Only");
});

test("buildOutlineLayout lists non-placeholder scenes with global numbers", () => {
  const layout = buildOutlineLayout({
    userContents: [
      { _id: "s1", actNumber: 1, sceneIndex: 1, sceneTitle: "Birthday" },
      { _id: "s2", actNumber: 1, sceneIndex: 2, sceneTitle: "Fallout" },
    ],
    storyResponseMap: {},
    novelId: "n1",
    getSceneTitleText: () => "",
  });
  assert.equal(layout.length, 2);
  assert.equal(layout[0].globalSceneNumber, 1);
  assert.equal(layout[1].globalSceneNumber, 2);
  assert.equal(layout[0].title, "Birthday");
});

test("buildOutlineLayout omits archived scenes", () => {
  const layout = buildOutlineLayout({
    userContents: [
      { _id: "s1", actNumber: 1, sceneIndex: 1, sceneTitle: "Opening" },
      {
        _id: "s2",
        actNumber: 1,
        sceneIndex: 2,
        sceneTitle: "Parked",
        archivedAt: new Date("2026-09-07"),
        archivedFromActNumber: 1,
        archivedFromSceneIndex: 2,
      },
      { _id: "s3", actNumber: 1, sceneIndex: 2, sceneTitle: "Aftermath" },
    ],
    storyResponseMap: {},
    novelId: "n1",
    getSceneTitleText: () => "",
  });
  assert.equal(layout.length, 2);
  assert.equal(layout[0].title, "Opening");
  assert.equal(layout[1].title, "Aftermath");
  assert.equal(layout[1].sceneIndex, 2);
  assert.equal(layout[1].globalSceneNumber, 2);
});

test("computeLayoutPositionHash changes when scene moves slot", () => {
  const before = buildOutlineLayout({
    userContents: [{ _id: "s1", actNumber: 1, sceneIndex: 1 }],
    storyResponseMap: {},
    novelId: "n1",
  });
  const after = buildOutlineLayout({
    userContents: [{ _id: "s1", actNumber: 1, sceneIndex: 3 }],
    storyResponseMap: {},
    novelId: "n1",
  });
  assert.notEqual(
    computeLayoutPositionHash(before),
    computeLayoutPositionHash(after)
  );
});

test("resolveTargetSceneFromLayout updates act/scene after reorder", () => {
  const layout = buildOutlineLayout({
    userContents: [{ _id: "s1", actNumber: 2, sceneIndex: 1, promptKey: "scene6" }],
    storyResponseMap: {},
    novelId: "n1",
  });
  const resolved = resolveTargetSceneFromLayout(
    { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
    layout
  );
  assert.equal(resolved.actNumber, 2);
  assert.equal(resolved.sceneIndex, 1);
  assert.equal(resolved.promptKey, "scene6");
});

test("enrichTargetSceneFromUserContents adds sceneId from userContents", () => {
  const enriched = enrichTargetSceneFromUserContents(
    { actNumber: 1, sceneIndex: 2 },
    [{ _id: "abc", actNumber: 1, sceneIndex: 2, promptKey: "scene2" }]
  );
  assert.equal(enriched.sceneId, "abc");
  assert.equal(enriched.promptKey, "scene2");
});
