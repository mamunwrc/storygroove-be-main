import test from "node:test";
import assert from "node:assert/strict";

import { buildOutlineSceneRows, formatOutlineInventoryTable } from "../utils/buildOutlineSceneRows.js";
import { resolveOutlineSceneTitle } from "../utils/resolveOutlineSceneTitle.js";

const responseWithTitle = [
  "Scene Title: Morning After the Clip",
  "POV: Alex",
  "📝 Scene to Write: Party aftermath",
].join("\n");

test("buildOutlineSceneRows uses renamed sceneTitle over StoryResponse extraction", () => {
  const userContents = [
    {
      actNumber: 1,
      sceneIndex: 1,
      promptKey: "pk1",
      sceneTitle: "New Sidebar Title",
    },
  ];
  const sceneDocs = [{ promptKey: "pk1", responseText: responseWithTitle }];

  const rows = buildOutlineSceneRows(sceneDocs, userContents);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "New Sidebar Title");
});

test("resolveOutlineSceneTitle matches buildOutlineContextFromData title resolution", () => {
  const uc = {
    actNumber: 1,
    sceneIndex: 1,
    promptKey: "pk1",
    sceneTitle: "New Sidebar Title",
  };
  const title = resolveOutlineSceneTitle(uc, responseWithTitle, 1);
  assert.equal(title, "New Sidebar Title");

  const rows = buildOutlineSceneRows(
    [{ promptKey: "pk1", responseText: responseWithTitle }],
    [uc]
  );
  assert.equal(rows[0].title, title);
});

test("formatOutlineInventoryTable uses renamed titles from buildOutlineSceneRows", () => {
  const uc = {
    actNumber: 1,
    sceneIndex: 1,
    promptKey: "pk1",
    sceneTitle: "New Sidebar Title",
  };
  const rows = buildOutlineSceneRows(
    [{ promptKey: "pk1", responseText: responseWithTitle }],
    [uc]
  );
  const table = formatOutlineInventoryTable(rows);
  assert.match(table, /New Sidebar Title/);
  assert.match(table, /Alex/);
  assert.match(table, /Party aftermath/);
});

test("buildOutlineSceneRows omits archived scenes (post-renumber contiguous indices)", () => {
  const userContents = [
    { actNumber: 1, sceneIndex: 1, promptKey: "pk1", sceneTitle: "Opening" },
    {
      actNumber: 1,
      sceneIndex: 2,
      promptKey: "pk2",
      sceneTitle: "Parked for later",
      archivedAt: new Date("2026-08-24"),
      archivedFromActNumber: 1,
      archivedFromSceneIndex: 2,
    },
    // After archive renumber, former scene 3 is now scene 2
    { actNumber: 1, sceneIndex: 2, promptKey: "pk3", sceneTitle: "Aftermath" },
  ];
  const rows = buildOutlineSceneRows([], userContents);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Opening");
  assert.equal(rows[0].sceneIndex, 1);
  assert.equal(rows[1].title, "Aftermath");
  assert.equal(rows[1].sceneIndex, 2);
  assert.equal(rows[1].globalNum, 2);
});
