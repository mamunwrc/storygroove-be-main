import test from "node:test";
import assert from "node:assert/strict";
import { formatEditorialLetterMarkdown } from "../utils/editorialLetterFormat.js";
import { editorialLetterMarkdownToDocxParagraphs } from "../utils/editorialLetterToDocx.js";

test("formatEditorialLetterMarkdown emphasizes Ellis section transitions", () => {
  const input =
    "Hello Ana,\n\n1. Core manuscript strengths (voice, stakes).\n\nYour opening works.\n\n2. Recurring structural risks.\n\nPacing dips in Act 2.";
  const output = formatEditorialLetterMarkdown(input);

  assert.match(output, /\*\*Hello Ana,\*\*/);
  assert.match(output, /\*\*1\. Core Manuscript Strengths\*\*/);
  assert.match(output, /\*\*2\. Recurring Structural Risks\*\*/);
  assert.doesNotMatch(output, /voice, stakes/);
});

test("editorialLetterMarkdownToDocxParagraphs builds section headings", () => {
  const formatted = formatEditorialLetterMarkdown(
    "Hello Ana,\n\n1. Core manuscript strengths (voice, stakes).\n\nYour opening works."
  );
  const paragraphs = editorialLetterMarkdownToDocxParagraphs(formatted);

  assert.ok(paragraphs.length >= 3);
  const hasHeading2 = paragraphs.some((paragraph) =>
    JSON.stringify(paragraph.properties?.root || []).includes("Heading2")
  );
  assert.ok(hasHeading2);
});
