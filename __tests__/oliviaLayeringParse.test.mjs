import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLayeringState,
  buildLayeringQueueBlock,
  buildLayeringInsertNextCueSuffix,
} from "../utils/oliviaLayeringParse.js";

const TABLE = [
  "| Scene # | Act | Title | POV | Scene Purpose | Summary |",
  "|---------|-----|-------|-----|---------------|----------|",
  "| Scene 8 | 2 | Threshold | Allie Walker | Setup | Text-thread beat |",
  "| NEW Scene 7.5 | 2 | A Little Too Easy | Allie Walker | Ease | Normalize contact |",
  "| NEW Scene 8.6 | 2 | Josh Arrives Properly | Allie Walker | Arrival | Josh lands |",
].join("\n");

test("buildLayeringQueueBlock starts Phase 1 when there is no NEW-row table", () => {
  const block = buildLayeringQueueBlock(null);
  assert.match(block, /LAYERING PHASE \(MANDATORY/);
  assert.match(block, /Do NOT output a STEP-2 rich scene block/);
  assert.match(block, /NEW Chapter decimal rows/);
  assert.equal(buildLayeringQueueBlock({ layeringRows: [] }), block);
  assert.equal(
    buildLayeringQueueBlock(
      computeLayeringState({ tableText: "no table here" })
    ),
    block
  );
});

test("buildLayeringQueueBlock names next as first uninserted row", () => {
  const state = computeLayeringState({
    tableText: TABLE,
    oliviaLayeredInserts: [
      { stableKey: "new scene 7.5-act2", promptKey: "layered_a2_easy" },
    ],
    userContents: [{ promptKey: "layered_a2_easy" }],
  });
  assert.equal(state.tableText, TABLE);
  const block = buildLayeringQueueBlock(state);
  assert.match(block, /LAYERING DELIVERY QUEUE/);
  assert.match(block, /Next to deliver: NEW Chapter 8\.6 — Josh Arrives Properly/);
  assert.match(block, /NEW Chapter 8\.6 — Josh Arrives Properly/);
  assert.match(block, /Already in outline[\s\S]*A Little Too Easy/);
  assert.doesNotMatch(
    block.split("Remaining (expansion order):")[1].split("Already in outline")[0],
    /A Little Too Easy/
  );
});

test("buildLayeringQueueBlock lists all remaining when nothing is inserted", () => {
  const state = computeLayeringState({ tableText: TABLE });
  const block = buildLayeringQueueBlock(state);
  assert.match(block, /Next to deliver: NEW Chapter 7\.5 — A Little Too Easy/);
  assert.match(block, /Remaining \(expansion order\):[\s\S]*A Little Too Easy/);
  assert.match(block, /Remaining \(expansion order\):[\s\S]*Josh Arrives Properly/);
  assert.match(block, /Already in outline[\s\S]*- \(none\)/);
});

test("buildLayeringQueueBlock allDone has no next and lists inserted rows", () => {
  const state = computeLayeringState({
    tableText: TABLE,
    oliviaLayeredInserts: [
      { stableKey: "new scene 7.5-act2", promptKey: "layered_a2_easy" },
      { stableKey: "new scene 8.6-act2", promptKey: "layered_a2_josh" },
    ],
    userContents: [
      { promptKey: "layered_a2_easy" },
      { promptKey: "layered_a2_josh" },
    ],
  });
  assert.equal(state.allDone, true);
  const block = buildLayeringQueueBlock(state);
  assert.match(block, /Next to deliver: none — all NEW rows are in the outline/);
  assert.match(block, /Remaining \(expansion order\):[\s\S]*- \(none\)/);
  assert.match(block, /Already in outline[\s\S]*A Little Too Easy/);
  assert.match(block, /Already in outline[\s\S]*Josh Arrives Properly/);
});

test("computeLayeringState accepts NEW Chapter table rows", () => {
  const table = [
    "| Chapter # | Act | Title | POV | Chapter Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| NEW Chapter 2.5 | 1 | Spark | Eli | Tension | New beat |",
  ].join("\n");
  const state = computeLayeringState({ tableText: table });
  assert.equal(state.layeringRows.length, 1);
  assert.equal(state.layeringRows[0].rawSceneRef, "NEW Scene 2.5");
  assert.equal(state.nextLayeringTarget.actNumber, 1);
});

test("insert next cue shows NEW Chapter not NEW Scene", () => {
  const table = [
    "| Chapter # | Act | Title | POV | Chapter Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| NEW Chapter 2.5 | 1 | The Drive Before Noon | Eli | Setup | Beat |",
  ].join("\n");
  const cue = buildLayeringInsertNextCueSuffix(table, [], []);
  assert.match(cue, /NEW Chapter 2\.5 — The Drive Before Noon/);
  assert.doesNotMatch(cue, /NEW Scene 2\.5/);
});
