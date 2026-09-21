import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutlineLayoutBlock,
  buildOutlineStructureChangeNotice,
  buildSceneExtrasBlock,
  buildOliviaSupplementBlock,
} from "../service/oliviaDynamicContext.js";

test("buildOutlineLayoutBlock renders act/slot lines", () => {
  const block = buildOutlineLayoutBlock(
    [
      {
        actNumber: 1,
        sceneIndex: 1,
        globalSceneNumber: 1,
        title: "Rooftop party",
        hasContent: true,
        sceneId: "507f1f77bcf86cd799439011",
      },
    ],
    2
  );
  assert.match(block, /OUTLINE LAYOUT/);
  assert.match(block, /sidebar titles and positions/);
  assert.match(block, /Act 1 Chapter 1/);
  assert.match(block, /Rooftop party/);
  assert.match(block, /revision: 2/);
});

test("buildSceneExtrasBlock includes reorder notice", () => {
  const block = buildSceneExtrasBlock({
    sceneContext: "CURRENT TARGET: Act 1, Scene 1.",
    outlineChange: { type: "reorder" },
    outlineLayout: [
      {
        actNumber: 1,
        sceneIndex: 1,
        globalSceneNumber: 1,
        title: "A",
        hasContent: false,
      },
    ],
    outlineRevision: 1,
  });
  assert.match(block, /OUTLINE STRUCTURE CHANGE/);
  assert.match(block, /reordered scenes/);
  assert.match(block, /CURRENT TARGET/);
  assert.match(block, /OUTLINE LAYOUT/);
  assert.match(block, /OUTLINE TABLE AUTHORITY/);
});

test("buildOutlineStructureChangeNotice covers add, delete, rename, archive, restore", () => {
  assert.match(
    buildOutlineStructureChangeNotice({ type: "add", sceneId: "abc123" }),
    /added a scene/
  );
  assert.match(
    buildOutlineStructureChangeNotice({ type: "delete", sceneId: "abc123" }),
    /deleted a scene/
  );
  assert.match(
    buildOutlineStructureChangeNotice({ type: "archive", sceneId: "abc123" }),
    /archived a scene/
  );
  assert.match(
    buildOutlineStructureChangeNotice({ type: "restore", sceneId: "abc123" }),
    /restored an archived scene/
  );
  assert.match(
    buildOutlineStructureChangeNotice({
      type: "rename",
      sceneId: "abc123",
      sceneTitle: "New Title",
    }),
    /renamed a scene/
  );
  assert.match(
    buildOutlineStructureChangeNotice({
      type: "rename",
      sceneId: "abc123",
      sceneTitle: "New Title",
    }),
    /New Title/
  );
});

test("buildSceneExtrasBlock includes add/delete/rename notices", () => {
  const layout = [
    {
      actNumber: 1,
      sceneIndex: 1,
      globalSceneNumber: 1,
      title: "A",
      hasContent: false,
    },
  ];

  for (const outlineChange of [
    { type: "add", sceneId: "507f1f77bcf86cd799439011" },
    { type: "delete", sceneId: "507f1f77bcf86cd799439011" },
    {
      type: "rename",
      sceneId: "507f1f77bcf86cd799439011",
      sceneTitle: "Renamed",
    },
  ]) {
    const block = buildSceneExtrasBlock({
      outlineChange,
      outlineLayout: layout,
      outlineRevision: 3,
    });
    assert.match(block, /OUTLINE STRUCTURE CHANGE/);
    assert.match(block, /OUTLINE LAYOUT/);
  }
});

test("buildSceneExtrasBlock uses inventory table on outline list queries", () => {
  const inventoryTable = [
    "| Scene # | Act | Title | POV | Summary |",
    "|---------|-----|-------|-----|----------|",
    "| Scene 2 | 1 | 2 | Renamed Title | Alex | Party aftermath |",
  ].join("\n");

  const block = buildSceneExtrasBlock({
    outlineLayout: [
      {
        actNumber: 1,
        sceneIndex: 2,
        globalSceneNumber: 2,
        title: "Renamed Title",
        hasContent: true,
      },
    ],
    outlineInventoryQuery: true,
    outlineInventoryTable: inventoryTable,
  });

  assert.match(block, /OUTLINE LISTING \(MANDATORY\)/);
  assert.match(block, /five-column GFM markdown table: Chapter #, Act, Title, POV, Summary/);
  assert.match(block, /CURRENT OUTLINE INVENTORY/);
  assert.match(block, /Renamed Title/);
  assert.match(block, /Do not add a Status column/);
  assert.doesNotMatch(block, /OUTLINE LAYOUT/);
  assert.doesNotMatch(block, /\[filled\]/);
});

test("buildSceneExtrasBlock falls back to layout when inventory query has no table", () => {
  const layout = [
    {
      actNumber: 1,
      sceneIndex: 2,
      globalSceneNumber: 2,
      title: "Renamed Title",
      hasContent: true,
    },
  ];
  const block = buildSceneExtrasBlock({
    outlineLayout: layout,
    outlineInventoryQuery: true,
    outlineInventoryTable: "",
  });
  assert.match(block, /OUTLINE LISTING \(MANDATORY\)/);
  assert.match(block, /OUTLINE LAYOUT/);
  assert.match(block, /Renamed Title/);
  assert.match(block, /POV and Summary are not available/);
  assert.doesNotMatch(block, /CURRENT OUTLINE INVENTORY/);
});

test("buildSceneExtrasBlock omits listing rule when outlineInventoryQuery false", () => {
  const block = buildSceneExtrasBlock({
    outlineLayout: [
      {
        actNumber: 1,
        sceneIndex: 1,
        globalSceneNumber: 1,
        title: "A",
        hasContent: false,
      },
    ],
    outlineInventoryQuery: false,
  });
  assert.doesNotMatch(block, /OUTLINE LISTING \(MANDATORY\)/);
  assert.match(block, /OUTLINE TABLE AUTHORITY/);
  assert.match(block, /OUTLINE LAYOUT/);
});

test("buildSceneExtrasBlock inventory turn with table omits standing authority rule", () => {
  const inventoryTable = [
    "| Scene # | Act | Title | POV | Summary |",
    "|---------|-----|-------|-----|----------|",
    "| Scene 1 | 1 | Title | POV | Summary |",
  ].join("\n");

  const block = buildSceneExtrasBlock({
    outlineLayout: [
      {
        actNumber: 1,
        sceneIndex: 1,
        globalSceneNumber: 1,
        title: "Title",
        hasContent: true,
      },
    ],
    outlineInventoryQuery: true,
    outlineInventoryTable: inventoryTable,
  });

  assert.match(block, /OUTLINE LISTING \(MANDATORY\)/);
  assert.match(block, /CURRENT OUTLINE INVENTORY/);
  assert.doesNotMatch(block, /OUTLINE TABLE AUTHORITY/);
});

test("buildSceneExtrasBlock omits authority rules when outlineLayout empty", () => {
  const block = buildSceneExtrasBlock({
    outlineLayout: [],
    outlineInventoryQuery: false,
  });
  assert.doesNotMatch(block, /OUTLINE TABLE AUTHORITY/);
  assert.doesNotMatch(block, /OUTLINE LISTING \(MANDATORY\)/);
  assert.doesNotMatch(block, /OUTLINE LAYOUT/);
});

test("buildSceneExtrasBlock includes outline save status when provided", () => {
  const block = buildSceneExtrasBlock({
    sceneContext: "CURRENT TARGET: Act 3, Chapter 12.",
    outlineSaveStatus:
      "OUTLINE SAVE STATUS (MANDATORY): Every chapter listed in CURRENT OUTLINE is already saved.",
  });
  assert.match(block, /CURRENT TARGET: Act 3, Chapter 12/);
  assert.match(block, /OUTLINE SAVE STATUS \(MANDATORY\)/);
});

test("buildOliviaSupplementBlock puts layeringQueue first", () => {
  const queue =
    "LAYERING DELIVERY QUEUE (authoritative — supersedes earlier chat tables, serial cues, and the last rich-scene delivery):\n- Next to deliver: NEW Scene 8.6 — Josh Arrives Properly";
  const block = buildOliviaSupplementBlock({
    layeringQueue: queue,
    bibleSlice: "### STORY BIBLE\nGenre: romance",
    outlineContext: "CURRENT OUTLINE:\nScene 1",
  });
  assert.ok(block);
  assert.equal(block.role, "system");
  const idxQueue = block.content.indexOf("LAYERING DELIVERY QUEUE");
  const idxBible = block.content.indexOf("### STORY BIBLE");
  const idxOutline = block.content.indexOf("CURRENT OUTLINE:");
  assert.ok(idxQueue === 0);
  assert.ok(idxBible > idxQueue);
  assert.ok(idxOutline > idxBible);
});
