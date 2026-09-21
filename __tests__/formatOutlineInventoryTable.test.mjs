import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutlineSceneRows,
  formatOutlineInventoryTable,
} from "../utils/buildOutlineSceneRows.js";

const RICH_SCENE_FIXTURE = `Scene Title: Morning After the Clip
POV: Alex Kim
📝 Scene to Write: Lola wakes to notifications and damage control.`;

test("formatOutlineInventoryTable uses five-column header without Scene Purpose", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [{ promptKey: "scene1", actNumber: 1, sceneIndex: 1 }]
  );
  const table = formatOutlineInventoryTable(rows);
  assert.match(table, /^\| Chapter # \| Act \| Title \| POV \| Summary \|/);
  assert.doesNotMatch(table, /Scene Purpose/);
});

test("formatOutlineInventoryTable includes POV and Summary from responseText", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [{ promptKey: "scene1", actNumber: 1, sceneIndex: 1 }]
  );
  const table = formatOutlineInventoryTable(rows);
  assert.match(table, /Morning After the Clip/);
  assert.match(table, /Alex Kim/);
  assert.match(table, /notifications/);
});

test("formatOutlineInventoryTable prefers renamed sceneTitle", () => {
  const rows = buildOutlineSceneRows(
    [{ promptKey: "scene1", responseText: RICH_SCENE_FIXTURE }],
    [
      {
        promptKey: "scene1",
        actNumber: 1,
        sceneIndex: 1,
        sceneTitle: "Renamed Sidebar Title",
      },
    ]
  );
  const table = formatOutlineInventoryTable(rows);
  assert.match(table, /Renamed Sidebar Title/);
  assert.doesNotMatch(table, /Morning After the Clip/);
});

test("formatOutlineInventoryTable returns empty string for no rows", () => {
  assert.equal(formatOutlineInventoryTable([]), "");
});
