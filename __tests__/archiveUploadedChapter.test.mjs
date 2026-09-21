/**
 * Pure helpers for uploaded-manuscript chapter archive / restore slot math.
 * Mirrors novelController archiveUploadedChapter / unarchiveUploadedChapter.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  getUploadedChapterRows,
  nextParkedChapterNumber,
  planUploadedChapterArchive,
  planUploadedChapterRestore,
  assignCompactChapterNumbers,
  buildCompactChapterRemap,
  PARKED_CHAPTER_NUMBER_BASE,
  isFrontMatterChapterNumber,
} from "../utils/uploadedChapterRows.js";

const ch = (id, chapterNumber, extra = {}) => ({
  _id: id,
  chapterNumber,
  chapterSuffix: null,
  chapterLabel: `Chapter ${chapterNumber}`,
  userContent: `<p>${id}</p>`,
  ...extra,
});

test("getUploadedChapterRows omits archived chapters", () => {
  const rows = getUploadedChapterRows([
    ch("a", 1),
    ch("b", 2, { archivedAt: new Date("2026-09-09") }),
    ch("c", 3),
  ]);
  assert.deepEqual(
    rows.map((r) => r._id),
    ["a", "c"]
  );
});

test("getUploadedChapterRows keeps front-matter negatives and prologue 0", () => {
  const rows = getUploadedChapterRows([
    ch("intro", -1, { chapterLabel: "Introduction" }),
    ch("pro", 0, { chapterLabel: "Prologue" }),
    ch("one", 1),
    ch("archived", 2, { archivedAt: new Date("2026-09-09") }),
  ]);
  assert.deepEqual(
    rows.map((r) => r._id),
    ["intro", "pro", "one"]
  );
});

test("nextParkedChapterNumber stays below front-matter negatives", () => {
  assert.equal(nextParkedChapterNumber([]), PARKED_CHAPTER_NUMBER_BASE - 1);
  assert.equal(
    nextParkedChapterNumber([ch("a", 1), ch("intro", -1), ch("pro", 0)]),
    PARKED_CHAPTER_NUMBER_BASE - 1
  );
  assert.equal(
    nextParkedChapterNumber([{ chapterNumber: PARKED_CHAPTER_NUMBER_BASE - 1 }]),
    PARKED_CHAPTER_NUMBER_BASE - 2
  );
  assert.equal(isFrontMatterChapterNumber(-1), true);
  assert.equal(isFrontMatterChapterNumber(0), true);
  assert.equal(isFrontMatterChapterNumber(PARKED_CHAPTER_NUMBER_BASE - 1), false);
});

test("archive plan stashes 1-based slot and drops the parked row", () => {
  const active = [ch("a", 1), ch("b", 2), ch("c", 3)];
  const plan = planUploadedChapterArchive(active, "b");
  assert.equal(plan.archivedFromSceneIndex, 2);
  assert.deepEqual(
    plan.remaining.map((r) => r._id),
    ["a", "c"]
  );
});

test("assignCompactChapterNumbers keeps prologue 0 and closes narrative gaps", () => {
  const assigned = assignCompactChapterNumbers([
    ch("pro", 0, { chapterLabel: "Prologue" }),
    ch("a", 1),
    ch("c", 3),
  ]);
  assert.deepEqual(
    assigned.map((a) => [a.row._id, a.chapterNumber]),
    [
      ["pro", 0],
      ["a", 1],
      ["c", 2],
    ]
  );
});

test("restore inserts at stashed slot and compact puts prologue back at 0", () => {
  const active = [ch("a", 1), ch("c", 2)];
  const parked = ch("pro", 0, {
    chapterLabel: "Prologue",
    archivedFromSceneIndex: 1,
  });
  const mid = planUploadedChapterRestore(active, parked);
  assert.equal(mid.targetIndex, 1);
  const assigned = assignCompactChapterNumbers(mid.ordered);
  assert.deepEqual(
    assigned.map((a) => [a.row._id, a.chapterNumber]),
    [
      ["pro", 0],
      ["a", 1],
      ["c", 2],
    ]
  );
});

test("restore appends when original slot is past end", () => {
  const active = [ch("a", 1), ch("c", 2)];
  const parked = ch("b", 2, { archivedFromSceneIndex: 9 });
  const pastEnd = planUploadedChapterRestore(active, parked);
  assert.equal(pastEnd.targetIndex, 3);
  assert.deepEqual(
    pastEnd.ordered.map((r) => r._id),
    ["a", "c", "b"]
  );
});

test("buildCompactChapterRemap includes restored id even when numbers match", () => {
  const assigned = assignCompactChapterNumbers([
    ch("pro", 0, { chapterLabel: "Prologue" }),
    ch("a", 1),
  ]);
  const remap = buildCompactChapterRemap(assigned, {
    alwaysIncludeIds: ["pro"],
  });
  assert.equal(remap.length, 1);
  assert.equal(String(remap[0].chapterId), "pro");
  assert.equal(remap[0].newNumber, 0);
});
