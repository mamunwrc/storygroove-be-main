import test from "node:test";
import assert from "node:assert/strict";
import { sliceStoryBibleForDisplay } from "../utils/storyBibleDisplay.js";

test("sliceStoryBibleForDisplay trims chat above Story Bible title", () => {
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

  const out = sliceStoryBibleForDisplay(input);
  assert.doesNotMatch(out, /Olivia chat intro/);
  assert.match(out, /Story Bible/);
  assert.match(out, /Party Girls 40!/);
  assert.match(out, /Ana del Valle/);
});

test("sliceStoryBibleForDisplay cuts at character dossiers heading", () => {
  const input = [
    "**📘 Story Bible**",
    "",
    "**1. Genre**",
    "Thriller",
    "",
    "**👤 CHARACTER DOSSIERS — 17-Point Dossiers**",
    "",
    "**👤 Alice: 17-Point Dossier**",
  ].join("\n");

  const out = sliceStoryBibleForDisplay(input);
  assert.match(out, /Thriller/);
  assert.doesNotMatch(out, /Alice/);
});
