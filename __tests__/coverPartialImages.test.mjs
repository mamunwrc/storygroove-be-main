import test from "node:test";
import assert from "node:assert/strict";

import { clampCoverPartialImages } from "../service/coverGenerationService.js";

test("clampCoverPartialImages clamps to 0-3", () => {
  assert.equal(clampCoverPartialImages(-1), 0);
  assert.equal(clampCoverPartialImages(0), 0);
  assert.equal(clampCoverPartialImages(2.9), 2);
  assert.equal(clampCoverPartialImages(3), 3);
  assert.equal(clampCoverPartialImages(10), 3);
  assert.equal(clampCoverPartialImages("bad"), 0);
});
