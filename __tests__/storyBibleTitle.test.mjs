import test from "node:test";
import assert from "node:assert/strict";
import {
  extractStoryBibleTitle,
  ensureStoryBibleApproxOnOwnLine,
} from "../utils/storyBibleTitle.js";

test("extractStoryBibleTitle reads the title under Title & Word Count", () => {
  const input = [
    "Olivia chat intro",
    "",
    "**📘 Story Bible**",
    "",
    "**Title & Word Count**",
    "Party Girls 40!",
    "Approx. 70,000 words",
    "**Author:** Ana del Valle",
  ].join("\n");

  assert.equal(extractStoryBibleTitle(input), "Party Girls 40!");
});

test("extractStoryBibleTitle skips Author and word-count lines before the title", () => {
  const input = [
    "**Title & Word Count**",
    "Approx. 85,000 words",
    "Author: Jane Doe",
    "The Hollow Echo",
  ].join("\n");

  assert.equal(extractStoryBibleTitle(input), "The Hollow Echo");
});

test("extractStoryBibleTitle strips a Title: prefix", () => {
  const input = [
    "Title & Word Count",
    "Title: Echoes of the Hollow",
    "Approx. 80,000 words",
  ].join("\n");

  assert.equal(extractStoryBibleTitle(input), "Echoes of the Hollow");
});

test("extractStoryBibleTitle caps at 200 characters", () => {
  const longTitle = "A".repeat(250);
  const input = ["**Title & Word Count**", longTitle, "Approx. 10,000 words"].join(
    "\n"
  );
  const out = extractStoryBibleTitle(input);
  assert.equal(out.length, 200);
  assert.equal(out, "A".repeat(200));
});

test("extractStoryBibleTitle returns empty when no Title & Word Count block", () => {
  assert.equal(extractStoryBibleTitle("**Genre**\nThriller"), "");
  assert.equal(extractStoryBibleTitle(""), "");
  assert.equal(extractStoryBibleTitle(null), "");
});

test("extractStoryBibleTitle peels Approx. word count glued onto the title line", () => {
  const input = [
    "**Title & Word Count**",
    "Party Girls 40! - Test Approx. 70,000 words",
    "**Author:** Ana del Valle",
  ].join("\n");

  assert.equal(extractStoryBibleTitle(input), "Party Girls 40! - Test");
});

test("extractStoryBibleTitle returns empty when the block has no title line", () => {
  const input = [
    "**Title & Word Count**",
    "Approx. 70,000 words",
    "**Author:** Ana del Valle",
  ].join("\n");

  assert.equal(extractStoryBibleTitle(input), "");
});

test("ensureStoryBibleApproxOnOwnLine splits a glued title + Approx line", () => {
  const input = [
    "**Title & Word Count**",
    "Party Girls 40! - Test Approx. 70,000 words",
    "**Author:** Ana del Valle",
    "---",
    "**📚 Story Context**",
  ].join("\n");

  const out = ensureStoryBibleApproxOnOwnLine(input);
  assert.match(out, /Party Girls 40! - Test  \nApprox\. 70,000 words/);
  assert.doesNotMatch(out, /Test Approx\. 70,000 words/);
  assert.doesNotMatch(out, /Test\n\nApprox/);
  assert.match(out, /Story Context/);
});

test("ensureStoryBibleApproxOnOwnLine removes an extra blank line before Approx", () => {
  const input = [
    "**Title & Word Count**",
    "Party Girls 40! - test",
    "",
    "Approx. 90,000 words",
    "**Author:** Ana del Valle",
  ].join("\n");

  const out = ensureStoryBibleApproxOnOwnLine(input);
  assert.match(out, /Party Girls 40! - test  \nApprox\. 90,000 words/);
  assert.doesNotMatch(out, /test\n\nApprox/);
});
