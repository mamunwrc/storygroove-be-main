import test from "node:test";
import assert from "node:assert/strict";
import { outlineMarkdownToDocxParagraphs } from "../utils/outlineTextToDocx.js";

test("outlineMarkdownToDocxParagraphs renders --- as a horizontal rule paragraph", () => {
  const paragraphs = outlineMarkdownToDocxParagraphs(
    "**Premise**\n\nA haunted lighthouse.\n\n---\n\n**Theme**\n\nRedemption."
  );

  assert.ok(paragraphs.length >= 3);
  const serialized = JSON.stringify(paragraphs);
  assert.match(serialized, /B8C4CC/);
});

test("outlineMarkdownToDocxParagraphs does not emit literal --- text", () => {
  const paragraphs = outlineMarkdownToDocxParagraphs("Section one\n\n---\n\nSection two");
  const serialized = JSON.stringify(paragraphs);
  assert.doesNotMatch(serialized, /"text":"---"/);
});

test("outlineMarkdownToDocxParagraphs preserveSingleLineBreaks keeps Title block lines separate", () => {
  const input = [
    "**Title & Word Count**",
    "Party Girls 40!",
    "Approx. 70,000 words",
    "**Author:** Ana del Valle",
  ].join("\n");

  const merged = outlineMarkdownToDocxParagraphs(input);
  const separate = outlineMarkdownToDocxParagraphs(input, {
    preserveSingleLineBreaks: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(separate.length, 4);

  const mergedText = JSON.stringify(merged);
  assert.match(mergedText, /Party Girls 40! Approx\. 70,000 words/);

  const separateText = JSON.stringify(separate);
  assert.match(separateText, /Title & Word Count/);
  assert.match(separateText, /Party Girls 40!/);
  assert.match(separateText, /Approx\. 70,000 words/);
  assert.match(separateText, /Ana del Valle/);
  assert.doesNotMatch(separateText, /Party Girls 40! Approx\. 70,000 words/);
});
