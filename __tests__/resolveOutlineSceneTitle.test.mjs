import test from "node:test";
import assert from "node:assert/strict";

import { resolveOutlineSceneTitle } from "../utils/resolveOutlineSceneTitle.js";

const responseWithTitle = [
  "Scene Title: Morning After the Clip",
  "POV: Alex",
  "📝 Scene to Write: Something happens",
].join("\n");

test("resolveOutlineSceneTitle prefers UserContent.sceneTitle over extraction", () => {
  const title = resolveOutlineSceneTitle(
    { sceneTitle: "Renamed Sidebar Title" },
    responseWithTitle,
    2
  );
  assert.equal(title, "Renamed Sidebar Title");
});

test("resolveOutlineSceneTitle falls back to extraction when sceneTitle empty", () => {
  const title = resolveOutlineSceneTitle({ sceneTitle: "" }, responseWithTitle, 2);
  assert.equal(title, "Morning After the Clip");
});

test("resolveOutlineSceneTitle falls back to Chapter N when no title sources", () => {
  const title = resolveOutlineSceneTitle({ sceneTitle: "" }, "", 5);
  assert.equal(title, "Chapter 5");
});

test("resolveOutlineSceneTitle caps user title at 80 characters", () => {
  const long = "A".repeat(100);
  const title = resolveOutlineSceneTitle({ sceneTitle: long }, responseWithTitle, 1);
  assert.equal(title.length, 80);
  assert.equal(title, "A".repeat(80));
});
