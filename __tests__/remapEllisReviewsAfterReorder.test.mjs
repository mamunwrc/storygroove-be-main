import assert from "node:assert/strict";
import test from "node:test";
import { remapEllisReviewsAfterChapterReorder } from "../service/remapEllisReviewsAfterReorder.js";

test("remapEllisReviewsAfterChapterReorder swaps review numbers without collision", async () => {
  const writes = [];
  const EllisChapterReview = {
    bulkWrite: async (ops) => {
      writes.push(ops);
      return { ok: 1 };
    },
  };

  // Move Ch 6 to position 3 (indices 0-based: after reorder list is 1,2,6,3,4,5…)
  // Simulate orderedChapters with OLD numbers in NEW order:
  const orderedChapters = [
    { chapterNumber: 1, chapterSuffix: null },
    { chapterNumber: 2, chapterSuffix: null },
    { chapterNumber: 6, chapterSuffix: null }, // moved here
    { chapterNumber: 3, chapterSuffix: null },
    { chapterNumber: 4, chapterSuffix: null },
    { chapterNumber: 5, chapterSuffix: null },
  ];

  const result = await remapEllisReviewsAfterChapterReorder({
    EllisChapterReview,
    novelId: "novel1",
    userId: "user1",
    orderedChapters,
  });

  assert.equal(result.remapped, 4); // 6→3, 3→4, 4→5, 5→6
  assert.equal(writes.length, 2);
  // Phase 1 uses negative temps
  assert.ok(writes[0].every((op) => op.updateOne.update.$set.chapterNumber < 0));
  // Phase 2 lands on final numbers
  const finals = writes[1].map((op) => op.updateOne.update.$set.chapterNumber);
  assert.deepEqual(finals.sort((a, b) => a - b), [3, 4, 5, 6]);
});

test("remap after deleting chapter 2 shifts later chapters down", async () => {
  const writes = [];
  const EllisChapterReview = {
    bulkWrite: async (ops) => {
      writes.push(ops);
      return { ok: 1 };
    },
  };
  const remaining = [
    { chapterNumber: 1, chapterSuffix: null },
    { chapterNumber: 3, chapterSuffix: null },
    { chapterNumber: 4, chapterSuffix: null },
  ];
  const result = await remapEllisReviewsAfterChapterReorder({
    EllisChapterReview,
    novelId: "novel1",
    userId: "user1",
    orderedChapters: remaining,
  });
  assert.equal(result.remapped, 2);
  const finals = writes[1].map((op) => op.updateOne.update.$set.chapterNumber);
  assert.deepEqual(finals.sort((a, b) => a - b), [2, 3]);
});

test("remapEllisReviewsAfterChapterReorder no-ops when order unchanged", async () => {
  let called = false;
  const EllisChapterReview = {
    bulkWrite: async () => {
      called = true;
    },
  };
  const result = await remapEllisReviewsAfterChapterReorder({
    EllisChapterReview,
    novelId: "n",
    userId: "u",
    orderedChapters: [
      { chapterNumber: 1 },
      { chapterNumber: 2 },
    ],
  });
  assert.equal(result.remapped, 0);
  assert.equal(called, false);
});

test("remapEllisReviewNumbers shifts 6→7 without touching the new empty chapter number", async () => {
  const writes = [];
  const EllisChapterReview = {
    bulkWrite: async (ops) => {
      writes.push(ops);
      return { ok: 1 };
    },
  };
  const { remapEllisReviewNumbers, buildEllisAddChapterRemap } = await import(
    "../service/remapEllisReviewsAfterReorder.js"
  );
  // Contiguous slice to the right of insertAt=1 (new empty chapter becomes 2).
  const shifted = [
    { _id: "ch2", chapterNumber: 2, chapterSuffix: null },
    { _id: "ch3", chapterNumber: 3, chapterSuffix: null },
    { _id: "ch4", chapterNumber: 4, chapterSuffix: null },
    { _id: "ch5", chapterNumber: 5, chapterSuffix: null },
    { _id: "ch6", chapterNumber: 6, chapterSuffix: null },
  ];
  const remap = buildEllisAddChapterRemap(shifted, 1);
  assert.deepEqual(
    remap.map((m) => [m.oldNumber, m.newNumber]),
    [
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
    ]
  );
  assert.equal(
    remap.some((m) => m.newNumber === 2),
    false
  );

  const result = await remapEllisReviewNumbers({
    EllisChapterReview,
    novelId: "n",
    userId: "u",
    remap,
  });
  assert.equal(result.remapped, 5);
  const finals = writes[1].map((op) => op.updateOne.update.$set.chapterNumber);
  assert.deepEqual(finals.sort((a, b) => a - b), [3, 4, 5, 6, 7]);
});

test("remapEllisReviewMessageChapterNumbers updates by stable chapterId", async () => {
  const calls = [];
  const Message = {
    updateMany: async (filter, update) => {
      calls.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
  const { remapEllisReviewMessageChapterNumbers } = await import(
    "../service/remapEllisReviewsAfterReorder.js"
  );
  await remapEllisReviewMessageChapterNumbers({
    Message,
    remap: [
      { oldNumber: 6, newNumber: 8, chapterId: "ch6orig" },
      { oldNumber: 2, newNumber: 3 },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter["metadata.chapterId"], "ch6orig");
  assert.equal(calls[0].update.$set["metadata.chapterNumber"], 8);
});
