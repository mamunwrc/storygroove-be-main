import test from "node:test";
import assert from "node:assert/strict";

import { buildChapterContentHtml } from "../utils/manuscriptParser.js";
import {
  looksLikeSceneTitleLine,
  peelLeadingSceneTitleLine,
  stripLeadingSceneTitleFromHtml,
  isSceneBreakOrnamentLine,
  filterSceneBreakOrnamentLines,
  stripSceneBreakOrnamentsFromHtml,
} from "../utils/manuscriptText.js";

test("looksLikeSceneTitleLine accepts short scene titles", () => {
  assert.equal(looksLikeSceneTitleLine("Birthday Glass"), true);
});

test("looksLikeSceneTitleLine rejects prose sentences", () => {
  assert.equal(
    looksLikeSceneTitleLine("Open with velocity and social texture."),
    false
  );
});

test("looksLikeSceneTitleLine rejects chapter headers", () => {
  assert.equal(looksLikeSceneTitleLine("Chapter One, POV Lucas"), false);
});

test("peelLeadingSceneTitleLine removes leading title line", () => {
  const peeled = peelLeadingSceneTitleLine([
    "Birthday Glass",
    "She opened the door",
  ]);
  assert.equal(peeled.sceneTitle, "Birthday Glass");
  assert.deepEqual(peeled.contentLines, ["She opened the door"]);
});

test("stripLeadingSceneTitleFromHtml removes title paragraph", () => {
  const html = stripLeadingSceneTitleFromHtml(
    "<p>Birthday Glass</p><p>Prose</p>"
  );
  assert.equal(html, "<p>Prose</p>");
});

test("peel then buildChapterContentHtml omits title from body HTML", () => {
  const peeled = peelLeadingSceneTitleLine([
    "Birthday Glass",
    "She opened the door",
  ]);
  const html = buildChapterContentHtml(peeled.contentLines);
  assert.equal(html.includes("Birthday Glass"), false);
  assert.equal(html.includes("She opened the door"), true);
});

test("isSceneBreakOrnamentLine detects common scene break markers", () => {
  assert.equal(isSceneBreakOrnamentLine("* * *"), true);
  assert.equal(isSceneBreakOrnamentLine("***"), true);
  assert.equal(isSceneBreakOrnamentLine("# # #"), true);
  assert.equal(isSceneBreakOrnamentLine("---"), true);
  assert.equal(isSceneBreakOrnamentLine("- - -"), true);
});

test("isSceneBreakOrnamentLine rejects prose and scene titles", () => {
  assert.equal(isSceneBreakOrnamentLine("She walked in."), false);
  assert.equal(isSceneBreakOrnamentLine("Birthday Glass"), false);
});

test("looksLikeSceneTitleLine rejects scene break ornaments", () => {
  assert.equal(looksLikeSceneTitleLine("* * *"), false);
});

test("filterSceneBreakOrnamentLines removes ornament lines", () => {
  const filtered = filterSceneBreakOrnamentLines([
    "Prose",
    "* * *",
    "More prose",
  ]);
  assert.deepEqual(filtered, ["Prose", "More prose"]);
});

test("stripSceneBreakOrnamentsFromHtml removes ornament paragraphs", () => {
  const html = stripSceneBreakOrnamentsFromHtml(
    "<p>Prose</p><p>* * *</p><p>More</p>"
  );
  assert.equal(html, "<p>Prose</p><p>More</p>");
});

test("filter then peel omits ornaments from body HTML", () => {
  const filtered = filterSceneBreakOrnamentLines([
    "* * *",
    "She opened the door slowly.",
  ]);
  const peeled = peelLeadingSceneTitleLine(filtered);
  const html = buildChapterContentHtml(peeled.contentLines);
  assert.equal(html.includes("* * *"), false);
  assert.equal(html.includes("She opened the door slowly."), true);
});
