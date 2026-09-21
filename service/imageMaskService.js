import sharp from "sharp";
import { validateMaskMatchesImage } from "./imageValidationService.js";

/**
 * Convert a luminance mask (white = editable, black = preserved) to OpenAI alpha format
 * (transparent = editable, opaque = preserved).
 */
export const convertLuminanceMaskToAlpha = async (maskBuffer) => {
  const { data, info } = await sharp(maskBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  const out = Buffer.alloc(pixels * 4);

  for (let i = 0; i < pixels; i += 1) {
    const idx = i * info.channels;
    const r = data[idx];
    const g = info.channels > 1 ? data[idx + 1] : r;
    const b = info.channels > 2 ? data[idx + 2] : r;
    const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const editable = luminance >= 128;
    const outIdx = i * 4;
    out[outIdx] = 0;
    out[outIdx + 1] = 0;
    out[outIdx + 2] = 0;
    out[outIdx + 3] = editable ? 0 : 255;
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
};

export const ensureMaskHasAlpha = async (maskBuffer) => {
  const meta = await sharp(maskBuffer).metadata();
  if (meta.hasAlpha) {
    return maskBuffer;
  }
  return convertLuminanceMaskToAlpha(maskBuffer);
};

export const prepareMaskForOpenAI = async (maskBuffer, imageMeta) => {
  const meta = await sharp(maskBuffer).metadata();
  validateMaskMatchesImage(meta, imageMeta);
  // convertLuminanceMaskToAlpha reads RGB luminance directly (white = editable)
  // and writes a fresh alpha channel, so it is correct whether or not the
  // incoming mask already had an alpha channel. Do not pre-run ensureMaskHasAlpha
  // here or the RGB would be flattened to black and the whole image marked preserve.
  return convertLuminanceMaskToAlpha(maskBuffer);
};

/**
 * Hard-composite the model's edit back onto the original so pixels outside the
 * painted (white) region are guaranteed identical to the source image.
 *
 * GPT Image masks are soft guides; the model can alter unmasked areas. This
 * blend enforces the mask on our side: white (edit) shows the model output,
 * black (preserve) shows the original, with a small feather to avoid seams.
 */
export const compositeMaskedEdit = async (
  originalBuffer,
  editedBuffer,
  luminanceMaskBuffer,
  { outputFormat = "png", feather = 1.5 } = {}
) => {
  const meta = await sharp(originalBuffer).metadata();
  const width = meta.width;
  const height = meta.height;

  const originalRgb = await sharp(originalBuffer)
    .removeAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  const editedRgb = await sharp(editedBuffer)
    .removeAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  let maskPipeline = sharp(luminanceMaskBuffer)
    .resize(width, height, { fit: "fill" })
    .greyscale();
  if (feather > 0) maskPipeline = maskPipeline.blur(feather);
  const maskGrey = await maskPipeline.raw().toBuffer();

  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const weight = maskGrey[i] / 255; // 1 = use edited, 0 = keep original
    for (let c = 0; c < 3; c += 1) {
      const idx = i * 3 + c;
      out[idx] = Math.round(editedRgb[idx] * weight + originalRgb[idx] * (1 - weight));
    }
  }

  let result = sharp(out, { raw: { width, height, channels: 3 } });
  if (outputFormat === "jpeg") result = result.jpeg();
  else if (outputFormat === "webp") result = result.webp();
  else result = result.png();
  return result.toBuffer();
};

export { validateMaskMatchesImage };
