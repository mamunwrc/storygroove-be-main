import test from "node:test";
import assert from "node:assert/strict";
import { replaceSceneTitleInResponseText } from "../utils/replaceSceneTitleInResponseText.js";

const RICH_SCENE = `Scene Title: Old Name
POV: Lola Reyes
📘 Book Coaching for Scene: Keep the beat tight.
📝 Scene to Write: Party chaos.`;

test("replaceSceneTitleInResponseText updates Scene Title line", () => {
  const out = replaceSceneTitleInResponseText(RICH_SCENE, "New Name");
  assert.match(out, /^Scene Title: New Name/);
  assert.match(out, /POV: Lola Reyes/);
  assert.doesNotMatch(out, /Old Name/);
});

test("replaceSceneTitleInResponseText prepends title when line missing", () => {
  const body = "POV: Someone\n📘 Book Coaching for Scene: Note.";
  const out = replaceSceneTitleInResponseText(body, "Inserted Title");
  assert.equal(out, "Scene Title: Inserted Title\nPOV: Someone\n📘 Book Coaching for Scene: Note.");
});

test("replaceSceneTitleInResponseText leaves empty body unchanged", () => {
  assert.equal(replaceSceneTitleInResponseText("", "Any"), "");
  assert.equal(replaceSceneTitleInResponseText("   ", "Any"), "   ");
});

test("replaceSceneTitleInResponseText returns unchanged when newTitle empty", () => {
  assert.equal(replaceSceneTitleInResponseText(RICH_SCENE, ""), RICH_SCENE);
});
