import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  convertLuminanceMaskToAlpha,
  ensureMaskHasAlpha,
  compositeMaskedEdit,
} from "../service/imageMaskService.js";
import { validateMaskMatchesImage } from "../service/imageValidationService.js";
import { buildMaskedEditPrompt, buildCoverEditPromptWithMetadata } from "../service/imagePromptEnhancementService.js";
import { OpenAIImageError } from "../utils/openaiImageErrors.js";

const solid = (width, height, color) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

test("convertLuminanceMaskToAlpha maps white to transparent and black to opaque", async () => {
  const mask = await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 1,
            height: 1,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        },
        left: 1,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  const out = await convertLuminanceMaskToAlpha(mask);
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 2);
  assert.equal(data[3], 0);
  assert.equal(data[7], 255);
});

test("ensureMaskHasAlpha adds alpha when missing", async () => {
  const gray = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  const out = await ensureMaskHasAlpha(gray);
  const meta = await sharp(out).metadata();
  assert.equal(meta.hasAlpha, true);
});

test("validateMaskMatchesImage rejects dimension mismatch", () => {
  assert.throws(
    () => validateMaskMatchesImage({ width: 100, height: 100 }, { width: 101, height: 100 }),
    (err) => err instanceof OpenAIImageError && err.code === "mask_dimension_mismatch"
  );
});

test("compositeMaskedEdit keeps original outside the painted region", async () => {
  const width = 4;
  const height = 2;
  const original = await solid(width, height, { r: 255, g: 0, b: 0 }); // red
  const edited = await solid(width, height, { r: 0, g: 0, b: 255 }); // blue

  // Mask: left half white (edit), right half black (preserve)
  const mask = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: width / 2,
            height,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  const merged = await compositeMaskedEdit(original, edited, mask, { feather: 0 });
  const { data } = await sharp(merged).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // Top-left pixel (edited region) should be blue
  assert.equal(data[0], 0);
  assert.equal(data[2], 255);
  // Top-right pixel (preserved region) should be red
  const lastIdx = (width - 1) * 3;
  assert.equal(data[lastIdx], 255);
  assert.equal(data[lastIdx + 2], 0);
});

test("buildMaskedEditPrompt includes instruction and preservation guidance", () => {
  const prompt = buildMaskedEditPrompt("remove the text on the pillow");
  assert.match(prompt, /remove the text on the pillow/);
  assert.match(prompt, /outside the selected region/i);
});

test("buildCoverEditPromptWithMetadata locks title and author", () => {
  const prompt = buildCoverEditPromptWithMetadata("remove the castle", {
    displayTitle: "Valley of the Dudes",
    authorName: "Jane Smith",
  });
  assert.match(prompt, /Valley of the Dudes/);
  assert.match(prompt, /Jane Smith/);
  assert.match(prompt, /remove the castle/);
});
