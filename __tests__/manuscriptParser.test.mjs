import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTitlePage,
  matchChapterHeader,
  matchStandaloneSectionHeader,
  isOrnamentDuplicateSectionHeader,
  validateChapterSequence,
  parseManuscriptLines,
  consolidateChaptersByBaseNumber,
  isPdfArtifactLine,
  filterPdfArtifactLines,
  shouldMergePdfLines,
  normalizePdfExtractedLines,
  buildChapterContentHtml,
  stripRedundantChapterMetaLines,
  splitToLines,
} from "../utils/manuscriptParser.js";
import { buildUploadedManuscriptMetaContext } from "../utils/manuscriptText.js";

test("parseTitlePage extracts author from standalone by line + name", () => {
  const tp = parseTitlePage([
    "Party Girls 40! - Office 3 Testing",
    "by",
    "Ana del Valle",
    "Contemporary Women's Fiction",
    "Approximately 85,000 words",
  ]);
  assert.equal(tp.title, "Party Girls 40! - Office 3 Testing");
  assert.equal(tp.author, "Ana del Valle");
  assert.equal(tp.genre, "Contemporary Women's Fiction");
});

test("parseTitlePage strips markdown emphasis from by line", () => {
  const tp = parseTitlePage([
    "My Novel Title",
    "*by*",
    "Jane Smith",
  ]);
  assert.equal(tp.author, "Jane Smith");
});

test("parseTitlePage extracts inline by Name", () => {
  const tp = parseTitlePage(["The Great Book", "by Ana del Valle"]);
  assert.equal(tp.title, "The Great Book");
  assert.equal(tp.author, "Ana del Valle");
});

test("parseTitlePage labeled Author regression", () => {
  const tp = parseTitlePage([
    "Title: My Book",
    "Author: Jane Doe",
    "Genre: Romance",
  ]);
  assert.equal(tp.title, "My Book");
  assert.equal(tp.author, "Jane Doe");
  assert.equal(tp.genre, "Romance");
});

test("parseTitlePage first line only becomes title when no author pattern", () => {
  const tp = parseTitlePage(["My Novel"]);
  assert.equal(tp.title, "My Novel");
  assert.equal(tp.author, "");
});

test("buildUploadedManuscriptMetaContext includes author salutation instruction", () => {
  const meta = buildUploadedManuscriptMetaContext({
    name: "Party Girls 40!",
    storyBibleAuthor: "Ana del Valle",
    genre: "Contemporary Women's Fiction",
  });
  assert.match(meta, /Author: Ana del Valle/);
  assert.match(meta, /Hello Ana del Valle,/);
  assert.match(meta, /do not use the placeholder "Author"/i);
});

test("matchChapterHeader parses letter suffix and preserves label", () => {
  const parsed = matchChapterHeader("Chapter Seven A");
  assert.equal(parsed.chapterNumber, 7);
  assert.equal(parsed.chapterSuffix, "A");
  assert.equal(parsed.chapterLabel, "Chapter Seven A");
});

test("matchChapterHeader accepts digit+letter and hyphen forms", () => {
  assert.equal(matchChapterHeader("Chapter 7A").chapterSuffix, "A");
  assert.equal(matchChapterHeader("Chapter 7 A").chapterSuffix, "A");
  assert.equal(matchChapterHeader("Chapter 7-A").chapterSuffix, "A");
  assert.equal(matchChapterHeader("Chapter Seven").chapterSuffix, null);
});

test("matchChapterHeader keeps POV after letter suffix", () => {
  const parsed = matchChapterHeader("Chapter Seven A, POV Darien");
  assert.equal(parsed.chapterNumber, 7);
  assert.equal(parsed.chapterSuffix, "A");
  assert.equal(parsed.pov, "Darien");
  assert.equal(parsed.chapterLabel, "Chapter Seven A");
});

test("validateChapterSequence treats consolidated chapters as unique base numbers", () => {
  const chapters = [
    { chapterNumber: 7, chapterSuffix: null, chapterLabel: "Chapter Seven" },
    { chapterNumber: 8, chapterSuffix: null, chapterLabel: "Chapter Eight" },
  ];
  const warnings = validateChapterSequence(chapters);
  assert.equal(
    warnings.some((w) => /Duplicate chapter/i.test(w)),
    false
  );
});

test("validateChapterSequence warns on duplicate base chapter number", () => {
  const warnings = validateChapterSequence([
    { chapterNumber: 7, chapterSuffix: null, chapterLabel: "Chapter Seven" },
    {
      chapterNumber: 7,
      chapterSuffix: null,
      chapterLabel: "Chapter Seven duplicate",
    },
  ]);
  assert.equal(warnings.some((w) => /Duplicate chapter/i.test(w)), true);
});

test("consolidateChaptersByBaseNumber merges Seven, Seven A, and Seven B", () => {
  const merged = consolidateChaptersByBaseNumber([
    {
      chapterNumber: 7,
      chapterSuffix: null,
      chapterLabel: "Chapter Seven",
      pov: "Alice",
      timeline: null,
      contentLines: ["Body seven."],
    },
    {
      chapterNumber: 7,
      chapterSuffix: "A",
      chapterLabel: "Chapter Seven A",
      pov: "Bob",
      timeline: null,
      contentLines: ["Body seven A."],
    },
    {
      chapterNumber: 7,
      chapterSuffix: "B",
      chapterLabel: "Chapter Seven B",
      pov: "Cassie",
      timeline: null,
      contentLines: ["Body seven B."],
    },
    {
      chapterNumber: 8,
      chapterSuffix: null,
      chapterLabel: "Chapter Eight",
      pov: null,
      timeline: null,
      contentLines: ["Body eight."],
    },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].chapterNumber, 7);
  assert.equal(merged[0].chapterSuffix, null);
  assert.equal(merged[0].sectionCount, 3);
  // Section labels stay in metadata — they must not reappear in the body.
  assert.doesNotMatch(merged[0].contentLines.join("\n"), /Chapter Seven A/);
  assert.match(merged[0].contentLines.join("\n"), /Body seven A/);
  assert.match(merged[0].contentLines.join("\n"), /Body seven B/);
  assert.equal(merged[1].chapterNumber, 8);
});

test("consolidateChaptersByBaseNumber merges Seven A and Seven B without bare row", () => {
  const merged = consolidateChaptersByBaseNumber([
    {
      chapterNumber: 7,
      chapterSuffix: "A",
      chapterLabel: "Chapter Seven A",
      contentLines: ["A body."],
    },
    {
      chapterNumber: 7,
      chapterSuffix: "B",
      chapterLabel: "Chapter Seven B",
      contentLines: ["B body."],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].chapterNumber, 7);
  assert.equal(merged[0].chapterSuffix, null);
  assert.equal(merged[0].chapterLabel, "Chapter Seven");
});

test("parseManuscriptLines consolidates lettered headers into one row per number", () => {
  const { chapters } = parseManuscriptLines([
    "My Book",
    "by Author",
    "Chapter Seven",
    "Body seven.",
    "Chapter Seven A",
    "Body seven A.",
    "Chapter Eight",
    "Body eight.",
  ]);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].chapterNumber, 7);
  assert.equal(chapters[0].chapterSuffix, null);
  assert.equal(chapters[0].sectionCount, 2);
  assert.equal(chapters[1].chapterNumber, 8);
});

test("isPdfArtifactLine detects pdf-parse page joiners and header stamps", () => {
  assert.equal(isPdfArtifactLine("-- 2 of 272 --"), true);
  assert.equal(isPdfArtifactLine("/ 12_23_24 / 2"), true);
  assert.equal(isPdfArtifactLine("Page 2 of 272"), true);
  assert.equal(isPdfArtifactLine("She opened the door."), false);
});

test("filterPdfArtifactLines removes page markers but keeps prose", () => {
  const filtered = filterPdfArtifactLines([
    "POV: Darien",
    "-- 2 of 272 --",
    "/ 12_23_24 / 2",
    "She opened the door.",
  ]);
  assert.deepEqual(filtered, ["POV: Darien", "She opened the door."]);
});

test("shouldMergePdfLines merges hyphenation and lowercase continuations", () => {
  assert.equal(shouldMergePdfLines("some-", "thing"), true);
  assert.equal(
    shouldMergePdfLines("She opened the door", "and walked in."),
    true
  );
  assert.equal(
    shouldMergePdfLines("She opened the door.", "The room was dark."),
    false
  );
  assert.equal(shouldMergePdfLines("Chapter One", "Body text"), false);
});

test("normalizePdfExtractedLines drops artifacts and merges soft wraps", () => {
  const normalized = normalizePdfExtractedLines([
    "POV: Darien",
    "-- 2 of 272 --",
    "/ 12_23_24 / 2",
    "She opened the door",
    "and walked in slowly.",
    "The room was dark.",
  ]);
  assert.deepEqual(normalized, [
    "POV: Darien",
    "She opened the door and walked in slowly.",
    "The room was dark.",
  ]);
});

test("matchChapterHeader parses hybrid Chapter One / Prologue label", () => {
  const parsed = matchChapterHeader("Chapter One / Prologue");
  assert.equal(parsed.chapterNumber, 1);
  assert.equal(parsed.chapterLabel, "Chapter One / Prologue");
  assert.equal(parsed.sceneTitle, "Prologue");
});

test("matchChapterHeader parses hybrid Chapter Twenty-Five / Epilogue label", () => {
  const parsed = matchChapterHeader("Chapter Twenty-Five / Epilogue");
  assert.equal(parsed.chapterNumber, 25);
  assert.equal(parsed.chapterLabel, "Chapter Twenty Five / Epilogue");
  assert.equal(parsed.sceneTitle, "Epilogue");
});

test("matchChapterHeader keeps POV after hybrid section suffix", () => {
  const parsed = matchChapterHeader("Chapter Seven A / Interlude, POV Darien");
  assert.equal(parsed.chapterNumber, 7);
  assert.equal(parsed.chapterSuffix, "A");
  assert.equal(parsed.chapterLabel, "Chapter Seven A / Interlude");
  assert.equal(parsed.pov, "Darien");
});

test("matchStandaloneSectionHeader recognizes prologue and epilogue", () => {
  assert.deepEqual(matchStandaloneSectionHeader("Prologue"), {
    chapterLabel: "Prologue",
    sceneTitle: "Prologue",
    isStandaloneSection: true,
  });
  assert.deepEqual(matchStandaloneSectionHeader("EPILOGUE."), {
    chapterLabel: "Epilogue",
    sceneTitle: "Epilogue",
    isStandaloneSection: true,
  });
  assert.equal(matchStandaloneSectionHeader("Chapter One"), null);
});

test("parseManuscriptLines splits standalone Prologue before numbered chapters", () => {
  const { chapters } = parseManuscriptLines([
    "My Book",
    "by Author",
    "Prologue",
    "Prologue body.",
    "Chapter One",
    "Chapter one body.",
    "Chapter Two",
    "Chapter two body.",
  ]);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].chapterNumber, 0);
  assert.equal(chapters[0].chapterLabel, "Prologue");
  assert.match(chapters[0].contentLines.join("\n"), /Prologue body/);
  assert.equal(chapters[1].chapterNumber, 1);
  assert.equal(chapters[2].chapterNumber, 2);
});

test("parseManuscriptLines assigns standalone Epilogue after last chapter", () => {
  const { chapters } = parseManuscriptLines([
    "Chapter One",
    "One body.",
    "Chapter Two",
    "Two body.",
    "Epilogue",
    "Epilogue body.",
  ]);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[2].chapterNumber, 3);
  assert.equal(chapters[2].chapterLabel, "Epilogue");
  assert.match(chapters[2].contentLines.join("\n"), /Epilogue body/);
});

test("parseManuscriptLines parses hybrid prologue without extra rows", () => {
  const { chapters } = parseManuscriptLines([
    "Chapter One / Prologue",
    "Opening.",
    "Chapter Two",
    "Next.",
  ]);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].chapterNumber, 1);
  assert.equal(chapters[0].chapterLabel, "Chapter One / Prologue");
});

test("parseManuscriptLines ignores repeated Prologue heading before body", () => {
  const { chapters } = parseManuscriptLines([
    "My Book",
    "by Author",
    "Prologue",
    "Prologue",
    "The first thing I learned about Louisiana was that the air had weight.",
    "Chapter One",
    "Chapter one body.",
  ]);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].chapterNumber, 0);
  assert.equal(chapters[0].chapterLabel, "Prologue");
  assert.match(chapters[0].contentLines.join(" "), /Louisiana/);
  assert.equal(chapters[1].chapterNumber, 1);
});

test("isOrnamentDuplicateSectionHeader detects empty duplicate prologue", () => {
  const current = {
    chapterLabel: "Prologue",
    sceneTitle: "Prologue",
    isStandaloneSection: true,
    contentLines: [],
  };
  const incoming = {
    chapterLabel: "Prologue",
    sceneTitle: "Prologue",
    isStandaloneSection: true,
  };
  assert.equal(isOrnamentDuplicateSectionHeader(current, incoming), true);
  assert.equal(
    isOrnamentDuplicateSectionHeader(
      { ...current, contentLines: ["Body."] },
      incoming
    ),
    false
  );
});

test("validateChapterSequence ignores back matter when checking narrative gaps", () => {
  const warnings = validateChapterSequence([
    { chapterNumber: 0, chapterSuffix: null, chapterLabel: "Prologue" },
    { chapterNumber: 1, chapterSuffix: null, chapterLabel: "Chapter One" },
    { chapterNumber: 2, chapterSuffix: null, chapterLabel: "Chapter Two" },
    {
      chapterNumber: 4,
      chapterSuffix: null,
      chapterLabel: "Epilogue",
      _isBackMatter: true,
    },
  ]);
  assert.equal(warnings.some((w) => /Missing chapter/i.test(w)), false);
  assert.equal(warnings.some((w) => /Duplicate chapter/i.test(w)), false);
});

test("splitToLines preserves blank lines as paragraph separators", () => {
  const lines = splitToLines("Para one.\n\nPara two.\n\n\nPara three.");
  assert.deepEqual(lines, ["Para one.", "", "Para two.", "", "Para three."]);
});

test("buildChapterContentHtml preserves blank lines as empty Quill paragraphs", () => {
  const html = buildChapterContentHtml(["First.", "", "Second.", "", ""]);
  assert.equal(
    html,
    "<p>First.</p><p><br></p><p>Second.</p><p><br></p><p><br></p>"
  );
});

test("stripRedundantChapterMetaLines keeps POV/Timeline in body; strips chapter header", () => {
  const stripped = stripRedundantChapterMetaLines(
    [
      "Chapter Fifteen",
      "POV: Darien",
      "Timeline: 1932",
      "She opened the door.",
      "",
      "He followed.",
    ],
    {
      chapterLabel: "Chapter Fifteen",
      pov: "Darien",
      timeline: "1932",
    }
  );
  assert.deepEqual(stripped, [
    "POV: Darien",
    "Timeline: 1932",
    "She opened the door.",
    "",
    "He followed.",
  ]);
});

test("buildChapterContentHtml includes POV/Timeline lines in stored HTML", () => {
  const html = buildChapterContentHtml([
    "POV: Darien",
    "Timeline: 1932",
    "She opened the door.",
  ]);
  assert.match(html, /<p>POV: Darien<\/p>/);
  assert.match(html, /<p>Timeline: 1932<\/p>/);
  assert.match(html, /<p>She opened the door\.<\/p>/);
});

test("normalizePdfExtractedLines keeps blank lines as hard paragraph breaks", () => {
  const lines = normalizePdfExtractedLines([
    "First sentence.",
    "",
    "Second paragraph starts here.",
    "-- 2 of 10 --",
    "Third block after the page marker.",
  ]);
  assert.ok(lines.includes(""));
  assert.ok(lines.includes("First sentence."));
  assert.ok(lines.includes("Second paragraph starts here."));
  assert.ok(lines.includes("Third block after the page marker."));
  assert.equal(lines.includes("-- 2 of 10 --"), false);
});
