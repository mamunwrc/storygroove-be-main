import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeDownloadFilenameStem,
  buildDocxDownloadFilename,
  buildSafeDocxFilenameFromTitle,
  buildContentDispositionAttachment,
  toAsciiDownloadFilename,
} from "../utils/downloadFilename.js";

const TRIPTYCH_TITLE =
  "Triptych of Totems — La Dueda / The Miner's Ocarina";

test("sanitizeDownloadFilenameStem normalizes em dash and slash", () => {
  assert.equal(
    sanitizeDownloadFilenameStem(TRIPTYCH_TITLE),
    "Triptych of Totems - La Dueda - The Miner's Ocarina"
  );
});

test("buildSafeDocxFilenameFromTitle produces ASCII outline filename for triptych title", () => {
  assert.equal(
    buildSafeDocxFilenameFromTitle(TRIPTYCH_TITLE, "Outline", "Novel"),
    "Triptych of Totems - La Dueda - The Miner's Ocarina_Outline.docx"
  );
});

test("sanitizeDownloadFilenameStem strips embedded newlines", () => {
  assert.equal(
    sanitizeDownloadFilenameStem("Line One\nLine Two"),
    "Line One Line Two"
  );
});

test("sanitizeDownloadFilenameStem normalizes smart quotes to safe filename chars", () => {
  assert.equal(
    sanitizeDownloadFilenameStem("The “Quoted” Title"),
    "The -Quoted- Title"
  );
});

test("buildContentDispositionAttachment is safe for Node header validation", () => {
  const filename = buildSafeDocxFilenameFromTitle(TRIPTYCH_TITLE, "Outline", "Novel");
  const header = buildContentDispositionAttachment(filename);
  assert.doesNotMatch(header, /[\r\n]/);
  const quotedMatch = header.match(/filename="((?:\\.|[^"\\])*)"/);
  assert.ok(quotedMatch, "expected filename= quoted segment");
  const quotedValue = quotedMatch[1].replace(/\\"/g, '"');
  assert.match(quotedValue, /^[\x20-\x7E]*$/);
});

test("buildContentDispositionAttachment adds filename* when non-ASCII remains", () => {
  const filename = "Café_Novel_Outline.docx";
  const header = buildContentDispositionAttachment(filename);
  assert.match(header, /filename\*=UTF-8''/);
  assert.match(header, /filename="/);
});

test("buildContentDispositionAttachment omits filename* for pure ASCII names", () => {
  const header = buildContentDispositionAttachment("Simple_Novel_Outline.docx");
  assert.doesNotMatch(header, /filename\*/);
});

test("toAsciiDownloadFilename replaces emoji with dash", () => {
  assert.equal(
    toAsciiDownloadFilename("My 📖 Book_Outline.docx"),
    "My - Book_Outline.docx"
  );
});

test("buildDocxDownloadFilename uses fallback stem when empty", () => {
  assert.equal(
    buildDocxDownloadFilename("", "Outline", "Novel"),
    "Novel_Outline.docx"
  );
});
