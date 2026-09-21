import test from "node:test";
import assert from "node:assert/strict";

import { ellisChapterReviewMetadata, isEllisThreadMessageForModel } from "../constants/ellisUiMessages.js";

test("ellisChapterReviewMetadata excludes reviews from model replay", () => {
  const meta = ellisChapterReviewMetadata({
    chapterNumber: 6,
    chapterId: "abc123",
  });
  assert.equal(meta.excludeFromModelInput, true);
  assert.equal(meta.kind, "ellis_chapter_review");
  assert.equal(meta.chapterNumber, 6);
  assert.equal(meta.chapterId, "abc123");
});

test("ellis insert-confirms stay in model history even if flagged UI-only", () => {
  assert.equal(
    isEllisThreadMessageForModel({
      metadata: {
        kind: "ellis_insert_confirm",
        excludeFromModelInput: true,
      },
    }),
    true
  );
  assert.equal(
    isEllisThreadMessageForModel({
      metadata: {
        kind: "ellis_chapter_review",
        excludeFromModelInput: true,
      },
    }),
    false
  );
});
