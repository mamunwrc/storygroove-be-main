import test from "node:test";
import assert from "node:assert/strict";

import {
  detectChapterScenes,
  buildEllisChapterSceneInventoryBlock,
  buildEllisMultiSceneKickoffReminder,
  resolveSceneReviewLabel,
} from "../utils/ellisChapterSceneDetection.js";

const DAVID_JOHN_OPENING = `POV: David John

David John stood in front of the mirror in his private bathroom at Love Story, fixing his tie for the third time. Another investor dinner loomed - his fourth this week. The Forbes cover on his office wall caught his eye.`;

const DARIEN_A = `Chapter Seven A

Darien stepped through the revolving door at Love Story headquarters, heart hammering beneath the borrowed suit. The guard studied her ID longer than seemed polite.`;

const DARIEN_B = `Chapter Seven B

Benjamin leaned back in his leather chair and smiled like Adrien had just said something brilliant. "Fascinating project," he said, interrupting before she could finish the sentence.`;

test("detectChapterScenes labels sequentially from A including untagged opening", () => {
  const text = `${DAVID_JOHN_OPENING}\n\n${DARIEN_A}\n\n${DARIEN_B}`;
  const result = detectChapterScenes(text, 7, "Chapter Seven");

  assert.equal(result.sceneCount, 3);
  assert.deepEqual(
    result.scenes.map((s) => s.reviewLabel),
    ["Chapter Seven A", "Chapter Seven B", "Chapter Seven C"]
  );
  assert.match(result.scenes[0].pov || "", /David John/i);
});

test("detectChapterScenes renumbers manuscript Seven A/B when untagged precedes", () => {
  const text = `Chapter Seven

POV: David John

${DAVID_JOHN_OPENING.split("\n").slice(2).join("\n")}

${DARIEN_A}

${DARIEN_B}`;
  const result = detectChapterScenes(text, 7, "Chapter Seven");

  assert.deepEqual(
    result.scenes.map((s) => s.reviewLabel),
    ["Chapter Seven A", "Chapter Seven B", "Chapter Seven C"]
  );
});

test("detectChapterScenes uses A and B when only lettered sub-headers exist", () => {
  const text = `${DARIEN_A}\n\n${DARIEN_B}`;
  const result = detectChapterScenes(text, 7, "Chapter Seven");

  assert.equal(result.sceneCount, 2);
  assert.deepEqual(
    result.scenes.map((s) => s.reviewLabel),
    ["Chapter Seven A", "Chapter Seven B"]
  );
});

test("detectChapterScenes returns single scene without letter", () => {
  const text = `Chapter Two – POV: Darien as Adrien

Darien smoothed the jacket Betty had chosen and tried not to look like a woman wearing a costume. The bar at Cotogna was already filling with people who looked like they belonged there.`;
  const result = detectChapterScenes(text, 2, "Chapter Two");

  assert.equal(result.sceneCount, 1);
  assert.equal(result.scenes[0].reviewLabel, "Chapter Two");
});

test("resolveSceneReviewLabel uses manuscript suffix for single lettered scene", () => {
  assert.equal(
    resolveSceneReviewLabel(
      { manuscriptSuffix: "A", reviewLetter: "" },
      "Chapter Seven",
      1
    ),
    "Chapter Seven A"
  );
});

test("buildEllisChapterSceneInventoryBlock lists sequential A B C labels", () => {
  const detection = detectChapterScenes(
    `${DAVID_JOHN_OPENING}\n\n${DARIEN_A}\n\n${DARIEN_B}`,
    7,
    "Chapter Seven"
  );
  const block = buildEllisChapterSceneInventoryBlock(detection);

  assert.match(block, /3 distinct scenes/);
  assert.match(block, /Chapter Seven A, Chapter Seven B, Chapter Seven C/);
  assert.match(block, /untagged openings.*scene A/i);
});

test("detectChapterScenes ignores chapter headers from other chapter numbers", () => {
  const text = `Chapter Eight

Some other chapter prose that should not split chapter seven review.`;
  const result = detectChapterScenes(text, 7, "Chapter Seven");
  assert.equal(result.sceneCount, 1);
});

test("buildEllisMultiSceneKickoffReminder uses original repeat-template depth rule", () => {
  const detection = detectChapterScenes(
    `${DAVID_JOHN_OPENING}\n\n${DARIEN_A}\n\n${DARIEN_B}`,
    7,
    "Chapter Seven"
  );
  const reminder = buildEllisMultiSceneKickoffReminder(detection);

  assert.match(reminder, /If multiple weaknesses exist in a scene, repeat the Creative Suggestions weakness template/i);
  assert.match(reminder, /do not pad across scenes/i);
  assert.doesNotMatch(reminder, /one package per distinct issue/i);
});
