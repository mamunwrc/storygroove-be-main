import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEllisLoadChapterArgs,
  executeEllisLoadManuscriptChapters,
} from "../service/ellisChapterLoader.js";
import {
  buildEllisResponsesTools,
  ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME,
} from "../utils/ellisResponsesTools.js";

const contents = [
  {
    _id: "emon",
    chapterNumber: 10,
    chapterLabel: "Emon Work - September 1936 - California",
    pov: "Myla",
    userContent: "<p>Emon chapter prose.</p>",
  },
  {
    _id: "six",
    chapterNumber: 6,
    chapterLabel: "Chapter Six",
    userContent: "<p>Six prose.</p>",
  },
];

test("parseEllisLoadChapterArgs reads chapterIds from JSON or object", () => {
  assert.deepEqual(parseEllisLoadChapterArgs('{"chapterIds":["emon"]}'), {
    chapterIds: ["emon"],
  });
  assert.deepEqual(parseEllisLoadChapterArgs({ chapterIds: ["emon", ""] }), {
    chapterIds: ["emon"],
  });
  assert.equal(parseEllisLoadChapterArgs("not-json"), null);
});

test("executeEllisLoadManuscriptChapters loads the map row Ellis picked by id", () => {
  const pack = executeEllisLoadManuscriptChapters({
    args: { chapterIds: ["emon"] },
    userContents: contents,
  });
  assert.match(pack, /Emon Work - September 1936 - California/);
  assert.match(pack, /Emon chapter prose/);
  assert.doesNotMatch(pack, /Six prose/);
});

test("executeEllisLoadManuscriptChapters reports unknown ids", () => {
  const pack = executeEllisLoadManuscriptChapters({
    args: { chapterIds: ["missing"] },
    userContents: contents,
  });
  assert.match(pack, /No manuscript chapter matched/);
  assert.match(pack, /missing/);
});

test("buildEllisResponsesTools exposes load_manuscript_chapters", () => {
  const tools = buildEllisResponsesTools();
  assert.equal(tools[0].name, ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME);
  assert.deepEqual(tools[0].parameters.required, ["chapterIds"]);
});
