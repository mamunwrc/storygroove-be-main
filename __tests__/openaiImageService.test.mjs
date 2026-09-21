import test from "node:test";
import assert from "node:assert/strict";

import {
  clampPartialImages,
  clampCoverPartialImages,
  normalizeImageStreamEvent,
  accumulateImageUsage,
  createEmptyImageUsage,
} from "../service/openaiImageService.js";
import { mapOpenAIImageError } from "../utils/openaiImageErrors.js";

test("clampPartialImages clamps to 0-3", () => {
  assert.equal(clampPartialImages(-1), 0);
  assert.equal(clampPartialImages(0), 0);
  assert.equal(clampPartialImages(2.9), 2);
  assert.equal(clampPartialImages(3), 3);
  assert.equal(clampPartialImages(10), 3);
  assert.equal(clampPartialImages("bad"), 0);
});

test("clampCoverPartialImages is alias of clampPartialImages", () => {
  assert.equal(clampCoverPartialImages, clampPartialImages);
});

test("normalizeImageStreamEvent unwraps nested data", () => {
  assert.deepEqual(
    normalizeImageStreamEvent({ type: "image_generation.completed" }),
    { type: "image_generation.completed" }
  );
  assert.deepEqual(
    normalizeImageStreamEvent({ data: { type: "image_edit.partial_image" } }),
    { type: "image_edit.partial_image" }
  );
  assert.equal(normalizeImageStreamEvent(null), null);
});

test("accumulateImageUsage aggregates token buckets", () => {
  const bucket = createEmptyImageUsage();
  accumulateImageUsage(
    {
      input_tokens: 100,
      output_tokens: 200,
      input_tokens_details: {
        text_tokens: 60,
        image_tokens: 40,
        cached_tokens: 10,
      },
    },
    bucket
  );
  assert.equal(bucket.promptTokens, 60);
  assert.equal(bucket.imageInputTokens, 40);
  assert.equal(bucket.imageOutputTokens, 200);
  assert.ok(bucket.cachedInputTokens >= 0);
});

test("mapOpenAIImageError maps moderation and rate limits", () => {
  const mod = mapOpenAIImageError({ code: "moderation_blocked", message: "blocked" });
  assert.equal(mod.code, "moderation_blocked");
  assert.equal(mod.statusCode, 400);

  const rate = mapOpenAIImageError({ status: 429, message: "slow down" });
  assert.equal(rate.code, "rate_limited");
  assert.equal(rate.statusCode, 429);
});
