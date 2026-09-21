import test from "node:test";
import assert from "node:assert/strict";

import { matchChapterHeader } from "../utils/manuscriptParser.js";
import {
  formatEllisChapterHeaderLine,
  resolveChapterExportMeta,
} from "../utils/manuscriptText.js";

test("formatEllisChapterHeaderLine with full metadata", () => {
  const line = formatEllisChapterHeaderLine({
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    pov: "Lucas",
    timeline: "1932",
  });
  assert.equal(line, "Chapter One, POV Lucas, Timeline 1932");
});

test("formatEllisChapterHeaderLine with POV only", () => {
  const line = formatEllisChapterHeaderLine({
    chapterNumber: 2,
    chapterLabel: "Chapter Two",
    pov: "Mara",
    timeline: null,
  });
  assert.equal(line, "Chapter Two, POV Mara");
});

test("formatEllisChapterHeaderLine label-only fallback uses word form", () => {
  const line = formatEllisChapterHeaderLine({
    chapterNumber: 3,
    chapterLabel: null,
    pov: null,
    timeline: null,
  });
  assert.equal(line, "Chapter Three");
});

test("resolveChapterExportMeta prefers UserContent chapter fields", () => {
  const meta = resolveChapterExportMeta(
    {
      chapterNumber: 5,
      chapterLabel: "Chapter Five",
      pov: "Darien",
      timeline: "2017",
    },
    { globalSceneNum: 99, responseText: "POV: Someone Else" }
  );
  assert.equal(meta.chapterNumber, 5);
  assert.equal(meta.chapterLabel, "Chapter Five");
  assert.equal(meta.pov, "Darien");
  assert.equal(meta.timeline, "2017");
  assert.equal(
    meta.headerLine,
    "Chapter Five, POV Darien, Timeline 2017"
  );
});

test("resolveChapterExportMeta falls back to global scene and StoryResponse POV", () => {
  const meta = resolveChapterExportMeta(
    { promptKey: "scene_1", actNumber: 1, sceneIndex: 1 },
    {
      globalSceneNum: 1,
      responseText: "📘 Book Coaching for Scene:\nPOV: Lucas Vance\n\n📝 Scene to Write:",
    }
  );
  assert.equal(meta.chapterNumber, 1);
  assert.equal(meta.chapterLabel, "Chapter One");
  assert.equal(meta.pov, "Lucas Vance");
  assert.equal(meta.headerLine, "Chapter One, POV Lucas Vance");
});

test("exported header line round-trips through matchChapterHeader", () => {
  const line = formatEllisChapterHeaderLine({
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    pov: "Lucas",
    timeline: "1932",
  });
  const parsed = matchChapterHeader(line);
  assert.ok(parsed);
  assert.equal(parsed.chapterNumber, 1);
  assert.equal(parsed.chapterLabel, "Chapter One");
  assert.equal(parsed.pov, "Lucas");
  assert.equal(parsed.timeline, "1932");
});
