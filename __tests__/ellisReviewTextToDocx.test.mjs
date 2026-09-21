import test from "node:test";
import assert from "node:assert/strict";
import { ellisReviewMarkdownToDocxParagraphs } from "../utils/ellisReviewTextToDocx.js";

const SAMPLE = `Chapter One – POV: Darien

Function in Story
Inciting injustice beat that crystallizes systemic bias.

Genre Beat Check
This scene delivers a major required beat.

🔍 Scene Analysis — Editorial Review

Structurally, this is one of the strongest early chapters.

🎨 Creative Suggestions

Structural Weakness: Mid-interview repetition
Creative Suggestion Name: "Tighten the Screw"
Editorial Logic: Compress the middle examples.
Example 1: After the third interruption, Darien stops expecting curiosity.
Example 2: The interviewer jumps to something insultingly basic.

📌 Chapter Cumulative Editorial Note

As a whole, this chapter is doing essential heavy lifting.
`;

test("ellisReviewMarkdownToDocxParagraphs creates multiple structured paragraphs", () => {
  const paras = ellisReviewMarkdownToDocxParagraphs(SAMPLE);
  assert.ok(paras.length >= 8, `expected many paragraphs, got ${paras.length}`);
});

test("ellisReviewMarkdownToDocxParagraphs returns empty for blank input", () => {
  assert.deepEqual(ellisReviewMarkdownToDocxParagraphs(""), []);
  assert.deepEqual(ellisReviewMarkdownToDocxParagraphs("   "), []);
});
