import test from "node:test";
import assert from "node:assert/strict";
import { AlignmentType } from "docx";
import JSZip from "jszip";

import { normalizeWordHtmlToQuillBlocks } from "../utils/wordHtmlToQuillHtml.js";
import {
  parseManuscriptBlocks,
  buildChapterContentHtmlFromBlocks,
  consolidateChaptersByBaseNumber,
  extractManuscriptBlocks,
} from "../utils/manuscriptParser.js";
import { parseHtmlToDocxParagraphs } from "../utils/htmlToDocx.js";

const WORDPROCESSING_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * Build a minimal in-memory .docx buffer so tests can exercise the real
 * mammoth extraction path (`extractManuscriptBlocks`), not just the
 * post-mammoth HTML normalizer. `stylesXmlBody` and `documentXmlBody` are
 * the raw contents to place inside `<w:styles>`/`<w:body>`.
 */
const buildTestDocx = async ({ stylesXmlBody = "", documentXmlBody }) => {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${WORDPROCESSING_NS}>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  ${stylesXmlBody}
</w:styles>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${WORDPROCESSING_NS}><w:body>${documentXmlBody}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels").file(".rels", rootRels);
  zip.folder("word/_rels").file("document.xml.rels", documentRels);
  zip.folder("word").file("document.xml", document);
  zip.folder("word").file("styles.xml", styles);
  return zip.generateAsync({ type: "nodebuffer" });
};

const paragraphXml = (text, { pStyle, jc } = {}) => `<w:p><w:pPr>${
  pStyle ? `<w:pStyle w:val="${pStyle}"/>` : ""
}${jc ? `<w:jc w:val="${jc}"/>` : ""}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const emptyParagraphXml = () => "<w:p><w:pPr></w:pPr></w:p>";

test("normalizeWordHtmlToQuillBlocks maps text-align inline styles to ql-align classes", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p style="text-align: center">Chapter One</p><p style="text-align: justify">Body text.</p>'
  );
  assert.equal(blocks[0].html, '<p class="ql-align-center">Chapter One</p>');
  assert.equal(blocks[1].html, '<p class="ql-align-justify">Body text.</p>');
});

test("normalizeWordHtmlToQuillBlocks passes through an existing ql-align class", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p class="ql-align-right">Right aligned</p>'
  );
  assert.equal(blocks[0].html, '<p class="ql-align-right">Right aligned</p>');
});

test("normalizeWordHtmlToQuillBlocks omits the class for left alignment (Quill default)", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p style="text-align: left">Default aligned</p>'
  );
  assert.equal(blocks[0].html, "<p>Default aligned</p>");
});

test("normalizeWordHtmlToQuillBlocks clamps h4-h6 down to h3", () => {
  const blocks = normalizeWordHtmlToQuillBlocks("<h5>A Heading</h5>");
  assert.equal(blocks[0].html, "<h3>A Heading</h3>");
  assert.equal(blocks[0].text, "A Heading");
});

test("normalizeWordHtmlToQuillBlocks keeps h1-h3 as-is", () => {
  const blocks = normalizeWordHtmlToQuillBlocks("<h1>Title</h1><h2>Sub</h2><h3>Sub sub</h3>");
  assert.equal(blocks[0].html, "<h1>Title</h1>");
  assert.equal(blocks[1].html, "<h2>Sub</h2>");
  assert.equal(blocks[2].html, "<h3>Sub sub</h3>");
});

test("normalizeWordHtmlToQuillBlocks drops unknown attributes but keeps allowed inline formatting", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p id="x" data-foo="bar" style="color:red;">She <strong class="x">walked</strong> in and ' +
      "<em>saw</em> <u>him</u> <s>gone</s>.</p>"
  );
  assert.equal(
    blocks[0].html,
    "<p>She <strong>walked</strong> in and <em>saw</em> <u>him</u> <s>gone</s>.</p>"
  );
});

test("normalizeWordHtmlToQuillBlocks unwraps unknown inline wrappers like span/font", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p><span style="font-size: 14pt">Spanned</span> <font color="red">Fonted</font></p>'
  );
  assert.equal(blocks[0].html, "<p>Spanned Fonted</p>");
});

test("normalizeWordHtmlToQuillBlocks preserves safe http(s) links only", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    '<p><a href="https://example.com">Example</a> and <a href="javascript:alert(1)">bad</a></p>'
  );
  assert.equal(
    blocks[0].html,
    '<p><a href="https://example.com">Example</a> and bad</p>'
  );
});

test("normalizeWordHtmlToQuillBlocks preserves ordered and unordered lists", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    "<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>"
  );
  assert.equal(blocks[0].html, "<ul><li>One</li><li>Two</li></ul>");
  assert.equal(blocks[0].text, "One\nTwo");
  assert.equal(blocks[1].html, "<ol><li>First</li></ol>");
});

test("normalizeWordHtmlToQuillBlocks preserves empty and nbsp-only paragraphs", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    "<p>Real text</p><p>&nbsp;</p><p></p>"
  );
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, "Real text");
  assert.equal(blocks[1].html, "<p><br></p>");
  assert.equal(blocks[2].html, "<p><br></p>");
});

test("normalizeWordHtmlToQuillBlocks unwraps div wrappers into top-level blocks", () => {
  const blocks = normalizeWordHtmlToQuillBlocks(
    "<div><p>Inside a div</p></div><p>Sibling</p>"
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, "Inside a div");
  assert.equal(blocks[1].text, "Sibling");
});

test("extractManuscriptBlocks resolves alignment inherited from a paragraph's named style (no direct w:jc)", async () => {
  const buffer = await buildTestDocx({
    stylesXmlBody:
      '<w:style w:type="paragraph" w:styleId="BodyCentered"><w:name w:val="Body Centered"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
    documentXmlBody: paragraphXml("Centered via style inheritance.", {
      pStyle: "BodyCentered",
    }),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(
    blocks[0].html,
    '<p class="ql-align-center">Centered via style inheritance.</p>'
  );
});

test("extractManuscriptBlocks resolves alignment through a multi-level basedOn chain", async () => {
  const buffer = await buildTestDocx({
    stylesXmlBody:
      '<w:style w:type="paragraph" w:styleId="BaseCentered"><w:name w:val="Base Centered"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="DerivedCentered"><w:name w:val="Derived Centered"/><w:basedOn w:val="BaseCentered"/></w:style>',
    documentXmlBody: paragraphXml("Inherited two levels deep.", {
      pStyle: "DerivedCentered",
    }),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(
    blocks[0].html,
    '<p class="ql-align-center">Inherited two levels deep.</p>'
  );
});

test("extractManuscriptBlocks applies direct alignment even when the paragraph already has a styleId (regression: previously skipped)", async () => {
  const buffer = await buildTestDocx({
    documentXmlBody: paragraphXml(
      "Right aligned despite Normal style.",
      { pStyle: "Normal", jc: "right" }
    ),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(
    blocks[0].html,
    '<p class="ql-align-right">Right aligned despite Normal style.</p>'
  );
});

test("extractManuscriptBlocks leaves unaligned styled paragraphs as plain <p>", async () => {
  const buffer = await buildTestDocx({
    documentXmlBody: paragraphXml("Just a normal paragraph.", {
      pStyle: "Normal",
    }),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(blocks[0].html, "<p>Just a normal paragraph.</p>");
});

test("extractManuscriptBlocks preserves heading level alongside inherited/direct alignment", async () => {
  const buffer = await buildTestDocx({
    stylesXmlBody:
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
    documentXmlBody: paragraphXml("Chapter One", {
      pStyle: "Heading1",
      jc: "center",
    }),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(blocks[0].html, '<h1 class="ql-align-center">Chapter One</h1>');
});

test("parseManuscriptBlocks detects a centered chapter header and keeps body block formatting", () => {
  const blocks = [
    { text: "Chapter One", html: '<p class="ql-align-center">Chapter One</p>' },
    { text: "She walked in.", html: '<p class="ql-align-justify">She walked in.</p>' },
  ];
  const { chapters } = parseManuscriptBlocks(blocks);

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].chapterNumber, 1);
  assert.equal(chapters[0].chapterLabel, "Chapter One");
  assert.equal(chapters[0].contentBlocks.length, 1);
  assert.equal(
    chapters[0].contentBlocks[0].html,
    '<p class="ql-align-justify">She walked in.</p>'
  );
  // The header line itself must not leak into the chapter body.
  assert.ok(!chapters[0].contentBlocks.some((b) => b.text === "Chapter One"));
});

test("parseManuscriptBlocks preserves plain-text blocks for TXT/PDF-style input", () => {
  const blocks = [
    { text: "Chapter One", html: null },
    { text: "Plain body line.", html: null },
  ];
  const { chapters } = parseManuscriptBlocks(blocks);
  assert.equal(chapters[0].contentBlocks[0].html, null);
  assert.equal(chapters[0].contentBlocks[0].text, "Plain body line.");
  assert.equal(chapters[0].contentLines.join(" "), "Plain body line.");
});

test("consolidateChaptersByBaseNumber merges Seven + Seven A and preserves each section's HTML", () => {
  const merged = consolidateChaptersByBaseNumber([
    {
      chapterNumber: 7,
      chapterSuffix: null,
      chapterLabel: "Chapter Seven",
      contentLines: ["Body seven."],
      contentBlocks: [
        { text: "Body seven.", html: '<p class="ql-align-center">Body seven.</p>' },
      ],
    },
    {
      chapterNumber: 7,
      chapterSuffix: "A",
      chapterLabel: "Chapter Seven A",
      contentLines: ["Body seven A."],
      contentBlocks: [
        { text: "Body seven A.", html: "<p>Body seven A. <strong>Bold.</strong></p>" },
      ],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].sectionCount, 2);

  const html = buildChapterContentHtmlFromBlocks(merged[0].contentBlocks);
  assert.doesNotMatch(html, /Chapter Seven A/); // section labels stay in metadata only
  assert.match(html, /ql-align-center/); // first section's alignment survives
  assert.match(html, /<strong>Bold\.<\/strong>/); // second section's inline formatting survives
});

test("buildChapterContentHtmlFromBlocks falls back to plain <p> for blocks without rich HTML", () => {
  const html = buildChapterContentHtmlFromBlocks([
    { text: "Plain & simple", html: null },
  ]);
  assert.equal(html, "<p>Plain &amp; simple</p>");
});

test("buildChapterContentHtmlFromBlocks uses the block's rich HTML when present", () => {
  const html = buildChapterContentHtmlFromBlocks([
    { text: "Centered", html: '<p class="ql-align-center">Centered</p>' },
  ]);
  assert.equal(html, '<p class="ql-align-center">Centered</p>');
});

test("buildChapterContentHtmlFromBlocks preserves blank plain-text blocks", () => {
  const html = buildChapterContentHtmlFromBlocks([
    { text: "First.", html: null },
    { text: "", html: null },
    { text: "Second.", html: null },
  ]);
  assert.equal(html, "<p>First.</p><p><br></p><p>Second.</p>");
});

test("extractManuscriptBlocks preserves empty DOCX paragraphs through mammoth", async () => {
  const buffer = await buildTestDocx({
    documentXmlBody: [
      paragraphXml("Chapter One"),
      paragraphXml("Opening beat."),
      emptyParagraphXml(),
      paragraphXml("After the break."),
      emptyParagraphXml(),
      emptyParagraphXml(),
      paragraphXml("Closing beat."),
    ].join(""),
  });

  const blocks = await extractManuscriptBlocks(buffer, "test.docx");
  assert.equal(blocks.length, 7);
  assert.equal(blocks[0].text, "Chapter One");
  assert.equal(blocks[1].text, "Opening beat.");
  assert.equal(blocks[2].html, "<p><br></p>");
  assert.equal(blocks[3].text, "After the break.");
  assert.equal(blocks[4].html, "<p><br></p>");
  assert.equal(blocks[5].html, "<p><br></p>");
  assert.equal(blocks[6].text, "Closing beat.");

  const { chapters } = parseManuscriptBlocks(blocks);
  assert.equal(chapters.length, 1);
  const html = buildChapterContentHtmlFromBlocks(chapters[0].contentBlocks);
  assert.equal(
    html,
    "<p>Opening beat.</p><p><br></p><p>After the break.</p><p><br></p><p><br></p><p>Closing beat.</p>"
  );
});

/** Recursively find a docx internal `w:jc` (justification) node's value. */
const findAlignmentValue = (node) => {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (current.rootKey === "w:jc") {
      const attr = (current.root || []).find((r) => r.rootKey === "_attr");
      return attr?.root?.val;
    }
    if (Array.isArray(current.root)) stack.push(...current.root);
  }
  return undefined;
};

test("normalized alignment classes round-trip through parseHtmlToDocxParagraphs", () => {
  const centerBlocks = normalizeWordHtmlToQuillBlocks(
    '<p style="text-align: center">Chapter One</p>'
  );
  const [centerParagraph] = parseHtmlToDocxParagraphs(centerBlocks[0].html);
  assert.equal(findAlignmentValue(centerParagraph), "center");

  const rightBlocks = normalizeWordHtmlToQuillBlocks(
    '<p style="text-align: right">Signed,</p>'
  );
  const [rightParagraph] = parseHtmlToDocxParagraphs(rightBlocks[0].html);
  assert.equal(findAlignmentValue(rightParagraph), "right");
});

test("alignmentFromQuillClass fallback (via parseHtmlToDocxParagraphs) reads raw text-align style", () => {
  // Defends against HTML that escaped Quill-class normalization on import.
  const [paragraph] = parseHtmlToDocxParagraphs(
    '<p style="text-align: center">Escaped raw style</p>'
  );
  assert.equal(findAlignmentValue(paragraph), "center");
});
