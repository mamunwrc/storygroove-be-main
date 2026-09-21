import test from "node:test";
import assert from "node:assert/strict";

import { matchChapterHeader } from "../utils/manuscriptParser.js";
import { getUploadedChapterRows } from "../utils/uploadedChapterRows.js";
import {
  shouldExportSceneTitleSubtitle,
  sanitizeUploadedChapterHtmlForExport,
  planUploadedManuscriptExport,
  getUploadedManuscriptExportRows,
  buildUploadedChapterSectionChildren,
} from "../service/uploadedManuscriptExportService.js";

const CHAPTER_ONE = {
  chapterNumber: 1,
  chapterLabel: "Chapter One",
  pov: "Lucas",
  timeline: "1932",
  sceneTitle: "The Morning Train",
  userContent:
    "<p>Lucas boarded the train before dawn.</p><p>Steam curled along the platform.</p>",
};

const CHAPTER_TWO = {
  chapterNumber: 2,
  chapterLabel: "Chapter Two",
  pov: "Mara",
  timeline: null,
  sceneTitle: null,
  userContent: "<p>Mara waited in the rain.</p>",
};

test("getUploadedChapterRows sorts by chapterNumber and dedupes by score", () => {
  const sparse = {
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "",
  };
  const rich = {
    ...CHAPTER_ONE,
    chapterSummary: "Opening hook",
    actNumber: 2,
    userContent: "<p>Full draft</p>",
  };

  const rows = getUploadedChapterRows([sparse, CHAPTER_TWO, rich, CHAPTER_ONE]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].chapterNumber, 1);
  assert.equal(rows[0].userContent, "<p>Full draft</p>");
  assert.equal(rows[1].chapterNumber, 2);
});

test("getUploadedChapterRows does not collapse lettered chapter parts", () => {
  const seven = {
    chapterNumber: 7,
    chapterSuffix: null,
    chapterLabel: "Chapter Seven",
    userContent: "<p>Seven</p>",
  };
  const sevenA = {
    chapterNumber: 7,
    chapterSuffix: "A",
    chapterLabel: "Chapter Seven A",
    userContent: "<p>Seven A</p>",
  };
  const sevenB = {
    chapterNumber: 7,
    chapterSuffix: "B",
    chapterLabel: "Chapter Seven B",
    userContent: "<p>Seven B</p>",
  };
  const eight = {
    chapterNumber: 8,
    chapterLabel: "Chapter Eight",
    userContent: "<p>Eight</p>",
  };

  const rows = getUploadedChapterRows([eight, sevenB, seven, sevenA]);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => [r.chapterNumber, r.chapterSuffix || null]),
    [
      [7, null],
      [7, "A"],
      [7, "B"],
      [8, null],
    ]
  );
});

test("getUploadedChapterRows omits archived chapters", () => {
  const archivedTwo = {
    ...CHAPTER_TWO,
    archivedAt: new Date("2026-09-09"),
  };
  const rows = getUploadedChapterRows([CHAPTER_ONE, archivedTwo]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chapterNumber, 1);
});

test("shouldExportSceneTitleSubtitle is false when sceneTitle matches chapterLabel", () => {
  assert.equal(
    shouldExportSceneTitleSubtitle({
      chapterLabel: "Chapter One",
      sceneTitle: "Chapter One",
    }),
    false
  );
  assert.equal(
    shouldExportSceneTitleSubtitle({
      chapterLabel: "Chapter One",
      sceneTitle: "The Morning Train",
    }),
    true
  );
});

test("sanitizeUploadedChapterHtmlForExport removes peeled scene title from body", () => {
  const html =
    "<p>The Morning Train</p><p>Lucas boarded the train.</p>";
  const sanitized = sanitizeUploadedChapterHtmlForExport({
    sceneTitle: "The Morning Train",
    userContent: html,
  });
  assert.ok(!sanitized.includes("The Morning Train"));
  assert.ok(sanitized.includes("Lucas boarded"));
});

test("planUploadedManuscriptExport uses flat chapter order and Ellis header lines", () => {
  const plan = planUploadedManuscriptExport([
    { ...CHAPTER_TWO, actNumber: 3 },
    CHAPTER_ONE,
  ]);

  assert.equal(plan.chapters.length, 2);
  assert.equal(
    plan.chapters[0].headerLine,
    "Chapter One, POV Lucas, Timeline 1932"
  );
  assert.equal(plan.chapters[1].headerLine, "Chapter Two, POV Mara");
  assert.equal(plan.chapters[0].subtitle, "The Morning Train");
  assert.equal(plan.chapters[1].subtitle, null);
});

test("planUploadedManuscriptExport does not duplicate sceneTitle in body", () => {
  const plan = planUploadedManuscriptExport([CHAPTER_ONE]);
  assert.equal(plan.chapters[0].subtitle, "The Morning Train");
  assert.ok(!plan.chapters[0].bodyText.includes("The Morning Train"));
  assert.ok(plan.chapters[0].bodyText.includes("Lucas boarded"));
});

test("exported header lines round-trip through matchChapterHeader", () => {
  const plan = planUploadedManuscriptExport([CHAPTER_ONE, CHAPTER_TWO]);
  for (const ch of plan.chapters) {
    const parsed = matchChapterHeader(ch.headerLine);
    assert.ok(parsed, `expected parseable header: ${ch.headerLine}`);
  }
});

test("buildUploadedChapterSectionChildren has no act headings or scene separators", () => {
  const children = buildUploadedChapterSectionChildren(CHAPTER_ONE);
  const serialized = JSON.stringify(children);
  assert.ok(!/ACT\s+ONE/i.test(serialized));
  assert.ok(!serialized.includes("* * *"));
  assert.ok(serialized.includes("Chapter One, POV Lucas, Timeline 1932"));
  assert.ok(serialized.includes("The Morning Train"));
});

test("planUploadedManuscriptExport ignores actNumber for ordering", () => {
  const ch3 = {
    chapterNumber: 3,
    chapterLabel: "Chapter Three",
    pov: "Darien",
    actNumber: 1,
    userContent: "<p>Act one chapter three</p>",
  };
  const ch1 = {
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    actNumber: 3,
    userContent: "<p>Act three chapter one</p>",
  };

  const plan = planUploadedManuscriptExport([ch3, ch1]);
  assert.deepEqual(
    plan.chapters.map((c) => c.headerLine),
    ["Chapter One", "Chapter Three, POV Darien"]
  );
});

test("empty editor HTML is not exported as a chapter", () => {
  const emptyQuill = {
    chapterNumber: 3,
    chapterLabel: "Chapter Three",
    userContent: "<p><br></p>",
  };
  const nbspOnly = {
    chapterNumber: 2,
    chapterLabel: "Chapter Two",
    userContent: "<p>&nbsp;</p>",
  };
  const rows = getUploadedManuscriptExportRows([
    CHAPTER_ONE,
    emptyQuill,
    nbspOnly,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chapterNumber, 1);

  const plan = planUploadedManuscriptExport([CHAPTER_ONE, emptyQuill, nbspOnly]);
  assert.equal(plan.chapters.length, 1);
  assert.equal(plan.chapters[0].headerLine, "Chapter One, POV Lucas, Timeline 1932");
});

test("later chapters start with a page break, not a new Word section", () => {
  const hasPageBreakBefore = (paragraph) =>
    JSON.stringify(paragraph).includes("pageBreakBefore");

  const first = buildUploadedChapterSectionChildren(CHAPTER_ONE, {
    pageBreakBefore: false,
  });
  const second = buildUploadedChapterSectionChildren(CHAPTER_TWO, {
    pageBreakBefore: true,
  });
  assert.equal(hasPageBreakBefore(first[0]), false);
  assert.equal(hasPageBreakBefore(second[0]), true);
});
