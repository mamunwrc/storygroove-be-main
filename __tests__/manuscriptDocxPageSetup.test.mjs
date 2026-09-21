import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Packer } from "docx";

import {
  LETTER_PAGE_HEIGHT_TWIPS,
  LETTER_PAGE_WIDTH_TWIPS,
} from "../utils/docxPageSetup.js";
import { userContentHasProse } from "../utils/manuscriptText.js";
import { parseHtmlToDocxParagraphs } from "../utils/htmlToDocx.js";
import { buildUploadedManuscriptDocument } from "../service/uploadedManuscriptExportService.js";

const unzipDocumentXml = async (buffer) => {
  const dir = mkdtempSync(join(tmpdir(), "ms-docx-"));
  writeFileSync(join(dir, "t.docx"), buffer);
  execSync(`unzip -q -o "${join(dir, "t.docx")}" -d "${dir}"`);
  const xml = readFileSync(join(dir, "word/document.xml"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return xml;
};

test("userContentHasProse ignores Quill empty saves and style-only HTML", () => {
  assert.equal(userContentHasProse(""), false);
  assert.equal(userContentHasProse("<p><br></p>"), false);
  assert.equal(userContentHasProse("<p>&nbsp;</p>"), false);
  assert.equal(userContentHasProse("<p>  </p>"), false);
  assert.equal(
    userContentHasProse(
      "<style>@page WordSection1{size:11.0in 8.5in;margin:0.25in;}</style><p><br></p>"
    ),
    false
  );
  assert.equal(userContentHasProse("<p>She opened the door.</p>"), true);
});

test("parseHtmlToDocxParagraphs drops style tags instead of emitting CSS as prose", () => {
  const paras = parseHtmlToDocxParagraphs(
    "<style>@page{size:landscape}</style><p>Hello world.</p>"
  );
  const serialized = JSON.stringify(paras);
  assert.equal(serialized.includes("landscape"), false);
  assert.equal(serialized.includes("@page"), false);
  assert.equal(serialized.includes("Hello world."), true);
});

test("uploaded manuscript docx is US Letter portrait with two sections", async () => {
  const doc = buildUploadedManuscriptDocument({
    novel: { name: "Test Novel", genre: "Mystery" },
    user: { fname: "Ada", lname: "Lovelace" },
    chapterRows: [
      {
        chapterNumber: 1,
        chapterLabel: "Chapter One",
        pov: "Lucas",
        userContent: "<p>Lucas boarded the train before dawn.</p>",
      },
      {
        chapterNumber: 3,
        chapterLabel: "Chapter Three",
        userContent: "<p>Real prose in chapter three.</p>",
      },
    ],
  });

  const xml = await unzipDocumentXml(await Packer.toBuffer(doc));
  const sectPr = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
  assert.equal(sectPr.length, 2, "title page + one body section");

  for (const sect of sectPr) {
    assert.match(
      sect,
      new RegExp(`w:w="${LETTER_PAGE_WIDTH_TWIPS}"`)
    );
    assert.match(
      sect,
      new RegExp(`w:h="${LETTER_PAGE_HEIGHT_TWIPS}"`)
    );
    assert.match(sect, /w:orient="portrait"/);
    assert.doesNotMatch(sect, /w:orient="landscape"/);
  }

  assert.match(xml, /w:pageBreakBefore/);
});
