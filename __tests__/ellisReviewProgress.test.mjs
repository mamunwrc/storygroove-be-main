import test from "node:test";
import assert from "node:assert/strict";

import {
  collectReadyChapterNumbers,
  isEllisBackfillInsert,
  resolveNextEllisOpenChapter,
} from "../service/ellisManuscriptContext.js";
import { buildEllisInsertConfirmText, isEllisFirstPassWrapUpText } from "../constants/ellisUiMessages.js";
import { shouldPreserveOriginalEllisReview } from "../service/ellisChapterReviewService.js";

const chapterRows = (nums) =>
  nums.map((n) => ({ _id: `ch${n}`, chapterNumber: n, chapterLabel: `Chapter ${n}` }));

test("shouldPreserveOriginalEllisReview is true only for a ready original body", () => {
  assert.equal(
    shouldPreserveOriginalEllisReview({
      status: "ready",
      reviewMarkdown: "Function in Story\n...",
    }),
    true
  );
  assert.equal(
    shouldPreserveOriginalEllisReview({
      status: "ready",
      reviewMarkdown: "   ",
    }),
    false
  );
  assert.equal(
    shouldPreserveOriginalEllisReview({
      status: "generating",
      reviewMarkdown: "Function in Story\n...",
    }),
    false
  );
  assert.equal(shouldPreserveOriginalEllisReview(null), false);
});

test("collectReadyChapterNumbers keeps ready chapter numbers only", () => {
  const ready = collectReadyChapterNumbers([
    { chapterNumber: 5, status: "ready" },
    { chapterNumber: 6, status: "generating" },
    { chapterNumber: 7, status: "ready" },
  ]);
  assert.deepEqual([...ready].sort((a, b) => a - b), [5, 7]);
});

test("collectReadyChapterNumbers maps a review onto the current row number via chapterId", () => {
  const ready = collectReadyChapterNumbers(
    [{ chapterNumber: 6, chapterId: "ch6orig", status: "ready" }],
    [{ _id: "ch6orig", chapterNumber: 8, chapterLabel: "Chapter Six" }]
  );
  assert.deepEqual([...ready], [8]);
});

test("resolveNextEllisOpenChapter returns first chapter without ready review", () => {
  const rows = chapterRows([5, 6, 7, 8, 9, 10, 11]);
  const ready = new Set([6, 7, 8, 9, 10]);
  const next = resolveNextEllisOpenChapter(rows, ready);
  assert.equal(next.chapterNumber, 5);
});

test("resolveNextEllisOpenChapter after backfill insert points past filled range", () => {
  const rows = chapterRows([5, 6, 7, 8, 9, 10, 11]);
  const ready = new Set([5, 6, 7, 8, 9, 10]);
  const next = resolveNextEllisOpenChapter(rows, ready);
  assert.equal(next.chapterNumber, 11);
});

test("resolveNextEllisOpenChapter returns null when all chapters are ready", () => {
  const rows = chapterRows([1, 2, 3]);
  const ready = new Set([1, 2, 3]);
  assert.equal(resolveNextEllisOpenChapter(rows, ready), null);
});

test("isEllisBackfillInsert detects higher ready chapters", () => {
  assert.equal(
    isEllisBackfillInsert({
      insertedChapterNumber: 5,
      readyChapterNumbers: new Set([5, 6, 7, 10]),
    }),
    true
  );
  assert.equal(
    isEllisBackfillInsert({
      insertedChapterNumber: 5,
      readyChapterNumbers: new Set([1, 2, 3, 4, 5]),
    }),
    false
  );
});

test("buildEllisInsertConfirmText names gap chapter on backfill not map successor", () => {
  const text = buildEllisInsertConfirmText({
    chapterLabel: "Chapter Five",
    nextChapterLabel: "Chapter Eleven",
    nextChapterNumber: 11,
    isBackfill: true,
  });
  assert.match(text, /Chapter Five/);
  assert.match(text, /Chapter Eleven/);
  assert.doesNotMatch(text, /Chapter Six/);
  assert.doesNotMatch(text, /Ready for/i);
});

test("resolveNextEllisOpenChapter returns gap when middle chapters missing from plan", () => {
  const rows = chapterRows([1, 2, 3, 4]);
  const ready = new Set([1, 3, 4]);
  const next = resolveNextEllisOpenChapter(rows, ready);
  assert.equal(next.chapterNumber, 2);
});

test("buildEllisInsertConfirmText uses next open chapter wording for linear insert", () => {
  const text = buildEllisInsertConfirmText({
    chapterLabel: "Chapter Five",
    nextChapterLabel: "Chapter Six",
    nextChapterNumber: 6,
    isBackfill: false,
  });
  assert.match(text, /next open chapter is \*\*Chapter Six\*\*/i);
  assert.match(text, /Say when you'd like me to run the next developmental edit pass/i);
});

test("buildEllisInsertConfirmText prompts insert when gap chapter already reviewed in thread", () => {
  const text = buildEllisInsertConfirmText({
    chapterLabel: "Chapter Twenty",
    nextChapterLabel: "Chapter Nineteen",
    nextChapterNumber: 19,
    isBackfill: true,
    nextChapterAlreadyReviewed: true,
  });
  assert.match(text, /Chapter Twenty/);
  assert.match(text, /Chapter Nineteen/);
  assert.match(text, /already has a developmental review in this thread/i);
  assert.match(text, /Insert to Revision Plan/i);
  assert.doesNotMatch(text, /next open chapter is/i);
  assert.doesNotMatch(text, /run the next developmental edit pass/i);
});

test("buildEllisInsertConfirmText wrap-up runs only when the first pass is not already complete", () => {
  const first = buildEllisInsertConfirmText({
    chapterLabel: "Chapter Twenty",
  });
  assert.equal(isEllisFirstPassWrapUpText(first), true);
  assert.match(first, /Congratulations/);

  const again = buildEllisInsertConfirmText({
    chapterLabel: "Chapter Twenty One",
    firstPassAlreadyComplete: true,
  });
  assert.equal(isEllisFirstPassWrapUpText(again), false);
  assert.doesNotMatch(again, /Congratulations/);
  assert.match(again, /inserted into your Revision Plan/);
});
