import test from "node:test";
import assert from "node:assert/strict";

import { resolveEllisSavedReviewChapterRef, buildEllisReviewProgressMap } from "../service/ellisChapterReviewService.js";

test("resolveEllisSavedReviewChapterNumber prefers review header over metadata", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 7,
        chapterId: "wrong",
      },
      messageContent:
        "Chapter Two – POV: Darien as Adrien\n\nFunction in Story: setup",
      requestedChapterNumber: 7,
    }),
    { chapterNumber: 2, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber prefers kickoff metadata when header missing", () => {
  assert.equal(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 2,
        chapterId: "abc",
      },
      messageContent: "Chapter Two\n\nFunction in Story: …",
      requestedChapterNumber: 1,
    })?.chapterNumber,
    2
  );
});

test("resolveEllisSavedReviewChapterNumber ignores scene-tag suffix in metadata", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 10,
        chapterSuffix: "A",
      },
      requestedChapterNumber: 1,
    }),
    { chapterNumber: 10, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber uses client request when no metadata", () => {
  assert.equal(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: null,
      messageContent: "Short follow-up",
      requestedChapterNumber: 5,
    })?.chapterNumber,
    5
  );
});

test("resolveEllisSavedReviewChapterNumber accepts prologue chapterNumber 0 from metadata", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 0,
      },
      messageContent: "Prologue\n\nFunction in Story: setup",
      requestedChapterNumber: 0,
    }),
    { chapterNumber: 0, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber resolves Prologue header via userContents", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 0,
      },
      messageContent:
        "Prologue – POV: Narrator\n\nFunction in Story: framing device",
      requestedChapterNumber: 0,
      userContents: [
        {
          chapterNumber: 0,
          chapterLabel: "Prologue",
          sceneTitle: "Prologue",
        },
      ],
    }),
    { chapterNumber: 0, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber files Prologue to ch.0 even when body mentions Chapter One", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: { kind: "ellis_chapter_review", chapterNumber: 0 },
      messageContent:
        "Prologue – POV: Narrator\n\nFunction in Story:\nThis prologue sets up the injustice that pays off in Chapter One and Chapter Two.",
      requestedChapterNumber: 0,
      userContents: [
        { chapterNumber: 0, chapterLabel: "Prologue", sceneTitle: "Prologue" },
        { chapterNumber: 1, chapterLabel: "Chapter One" },
        { chapterNumber: 2, chapterLabel: "Chapter Two" },
      ],
    }),
    { chapterNumber: 0, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber files Epilogue header ahead of body chapter mention", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: null,
      messageContent:
        "Epilogue\n\nFunction in Story:\nMirrors the promise made back in Chapter Three.",
      requestedChapterNumber: null,
      userContents: [
        { chapterNumber: 3, chapterLabel: "Chapter Three" },
        { chapterNumber: 99, chapterLabel: "Epilogue", sceneTitle: "Epilogue" },
      ],
    }),
    { chapterNumber: 99, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterNumber uses client request for chapterNumber 0", () => {
  assert.equal(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: null,
      messageContent: "Short follow-up",
      requestedChapterNumber: 0,
      userContents: [{ chapterNumber: 0, chapterLabel: "Prologue" }],
    })?.chapterNumber,
    0
  );
});

test("resolveEllisSavedReviewChapterNumber parses scene-tag header to base chapter", () => {
  assert.deepEqual(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: null,
      messageContent: "Chapter Ten A – POV: Janet\n\nFunction in Story: setup",
      requestedChapterNumber: null,
    }),
    { chapterNumber: 10, chapterSuffix: "" }
  );
});

test("resolveEllisSavedReviewChapterRef maps a 1.5 opener onto the added chapter's integer id", () => {
  const userContents = [
    { _id: "ch1", chapterNumber: 1, chapterLabel: "Chapter One" },
    { _id: "ch15", chapterNumber: 2, chapterLabel: "1.5", sceneTitle: "1.5" },
    { _id: "ch2", chapterNumber: 3, chapterLabel: "Chapter Two" },
  ];
  assert.equal(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: {
        kind: "ellis_chapter_review",
        chapterNumber: 2,
        chapterId: "ch15",
      },
      messageContent: "1.5 – POV: Darien\n\nFunction in Story: setup",
      requestedChapterNumber: 1.5,
      userContents,
    })?.chapterNumber,
    2
  );
  assert.equal(
    resolveEllisSavedReviewChapterRef({
      messageMetadata: { kind: "ellis_chapter_review", chapterNumber: 2 },
      messageContent: "Chapter 1.5 – POV: Darien\n\nFunction in Story: setup",
      requestedChapterNumber: 2,
      userContents,
    })?.chapterNumber,
    2
  );
});

test("buildEllisReviewProgressMap remaps a decimal review key onto the map row", () => {
  const progress = buildEllisReviewProgressMap(
    [{ chapterNumber: 1.5, status: "ready", generatedAt: null }],
    [
      { _id: "ch1", chapterNumber: 1, chapterLabel: "Chapter One" },
      { _id: "ch15", chapterNumber: 2, chapterLabel: "1.5", sceneTitle: "1.5" },
    ]
  );
  assert.equal(progress["2"]?.status, "ready");
  assert.equal(progress["1.5"], undefined);
});

test("buildEllisReviewProgressMap maps a review onto the current row via chapterId", () => {
  const progress = buildEllisReviewProgressMap(
    [
      {
        chapterNumber: 6,
        chapterId: "ch6orig",
        status: "ready",
        generatedAt: null,
      },
    ],
    [
      { _id: "ch6orig", chapterNumber: 8, chapterLabel: "Chapter Six" },
      { _id: "ch8new", chapterNumber: 7, chapterLabel: "Chapter Seven" },
    ]
  );
  assert.equal(progress["8"]?.status, "ready");
  assert.equal(progress["id:ch6orig"]?.status, "ready");
  assert.equal(progress["6"], undefined);
});

test("buildEllisReviewProgressMap keeps lettered suffixes on distinct keys", () => {
  const progress = buildEllisReviewProgressMap(
    [
      {
        chapterNumber: 7,
        chapterSuffix: "A",
        chapterId: "ch7a",
        status: "ready",
        generatedAt: null,
      },
    ],
    [
      { _id: "ch7", chapterNumber: 7, chapterSuffix: "" },
      { _id: "ch7a", chapterNumber: 7, chapterSuffix: "A" },
    ]
  );
  assert.equal(progress["7A"]?.status, "ready");
  assert.equal(progress["id:ch7a"]?.status, "ready");
  assert.equal(progress["7"], undefined);
});
