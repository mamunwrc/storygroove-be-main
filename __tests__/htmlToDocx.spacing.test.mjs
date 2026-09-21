import assert from "node:assert";
import test from "node:test";
import { LineRuleType } from "docx";
import {
  defaultBodySpacing,
  parseLineHeightFromStyle,
  parseMarginBottomFromStyle,
  spacingFromBlockStyle,
  parseHtmlToDocxParagraphs,
} from "../utils/htmlToDocx.js";

test("defaultBodySpacing uses double line spacing", () => {
  const s = defaultBodySpacing();
  assert.equal(s.after, 0);
  assert.equal(s.line, 480);
  assert.equal(s.lineRule, LineRuleType.AUTO);
});

test("parseLineHeightFromStyle maps unitless ratios to docx line", () => {
  assert.deepEqual(parseLineHeightFromStyle("line-height: 1"), {
    line: 240,
    lineRule: LineRuleType.AUTO,
  });
  assert.deepEqual(parseLineHeightFromStyle("line-height: 2; color: red"), {
    line: 480,
    lineRule: LineRuleType.AUTO,
  });
  assert.deepEqual(parseLineHeightFromStyle("line-height: 1.5"), {
    line: 360,
    lineRule: LineRuleType.AUTO,
  });
  assert.equal(parseLineHeightFromStyle(""), null);
});

test("parseMarginBottomFromStyle converts pt, em, and zero", () => {
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 0"), 0);
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 6pt"), 120);
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 12pt"), 240);
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 18pt"), 360);
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 1em"), 240);
  assert.equal(parseMarginBottomFromStyle("margin-bottom: 0.5em"), 120);
  assert.equal(parseMarginBottomFromStyle(""), null);
});

test("spacingFromBlockStyle merges inline styles with defaults", () => {
  assert.deepEqual(
    spacingFromBlockStyle("line-height: 2; margin-bottom: 1em"),
    { after: 240, line: 480, lineRule: LineRuleType.AUTO }
  );
  assert.deepEqual(spacingFromBlockStyle("line-height: 1"), {
    after: 0,
    line: 240,
    lineRule: LineRuleType.AUTO,
  });
  assert.deepEqual(spacingFromBlockStyle(""), defaultBodySpacing());
});

function getSpacingFromParagraph(paragraph) {
  const pPr = paragraph.root?.find((n) => n.rootKey === "w:pPr");
  const spacingWrapper = pPr?.root?.find((n) => n.rootKey === "w:spacing");
  const attrs = spacingWrapper?.root?.find((n) => n.rootKey === "_attr");
  return attrs?.root ?? null;
}

test("parseHtmlToDocxParagraphs applies paragraph inline spacing", () => {
  const paras = parseHtmlToDocxParagraphs(
    '<p style="line-height: 2; margin-bottom: 12pt">Hello</p>'
  );
  assert.equal(paras.length, 1);
  const spacing = getSpacingFromParagraph(paras[0]);
  assert.ok(spacing, "expected paragraph spacing in docx XML");
  assert.equal(spacing.line, 480);
  assert.equal(spacing.after, 240);
});
