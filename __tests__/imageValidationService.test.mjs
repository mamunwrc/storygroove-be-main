import test from "node:test";
import assert from "node:assert/strict";

import {
  validatePrompt,
  validateBackgroundSetting,
  ALLOWED_IMAGE_MIMES,
} from "../service/imageValidationService.js";
import { OpenAIImageError } from "../utils/openaiImageErrors.js";

test("validatePrompt rejects empty and too-long prompts", () => {
  assert.throws(() => validatePrompt("  ", 100), (err) => err.code === "prompt_required");
  assert.throws(
    () => validatePrompt("x".repeat(101), 100),
    (err) => err.code === "prompt_too_long"
  );
  assert.equal(validatePrompt(" hello ", 100), "hello");
});

test("validateBackgroundSetting rejects transparent", () => {
  assert.throws(
    () => validateBackgroundSetting("transparent"),
    (err) => err instanceof OpenAIImageError && err.code === "invalid_background"
  );
});

test("ALLOWED_IMAGE_MIMES includes png jpeg webp", () => {
  assert.ok(ALLOWED_IMAGE_MIMES.has("image/png"));
  assert.ok(ALLOWED_IMAGE_MIMES.has("image/jpeg"));
  assert.ok(ALLOWED_IMAGE_MIMES.has("image/webp"));
});
