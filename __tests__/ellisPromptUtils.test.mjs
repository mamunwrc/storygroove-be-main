import test from "node:test";
import assert from "node:assert/strict";

import { buildEllisCreativeSuggestionCalibrationBlock } from "../utils/reviewPrompts/ellisPromptUtils.js";

test("buildEllisCreativeSuggestionCalibrationBlock is empty (calibration in prompt v2)", () => {
  const block = buildEllisCreativeSuggestionCalibrationBlock();
  assert.equal(block, "");
});
