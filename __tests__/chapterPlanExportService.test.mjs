import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSafeChapterPlanFilename,
  ChapterPlanExportError,
} from "../service/chapterPlanExportService.js";

test("buildSafeChapterPlanFilename sanitizes novel title", () => {
  assert.equal(
    buildSafeChapterPlanFilename("My Novel"),
    "My Novel_Chapter_Plan.docx"
  );
  assert.equal(
    buildSafeChapterPlanFilename('Bad/Name:Test|"<>'),
    "Bad-Name-Test----_Chapter_Plan.docx"
  );
  assert.equal(
    buildSafeChapterPlanFilename(
      "Triptych of Totems — La Dueda / The Miner's Ocarina"
    ),
    "Triptych of Totems - La Dueda - The Miner's Ocarina_Chapter_Plan.docx"
  );
  assert.equal(
    buildSafeChapterPlanFilename(""),
    "Manuscript_Chapter_Plan.docx"
  );
});

test("ChapterPlanExportError carries statusCode", () => {
  const err = new ChapterPlanExportError(
    "No chapter reviews have been inserted into your Revision Plan yet",
    404
  );
  assert.equal(err.name, "ChapterPlanExportError");
  assert.equal(err.statusCode, 404);
  assert.match(err.message, /Revision Plan/);
});
