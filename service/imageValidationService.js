import sharp from "sharp";
import { OpenAIImageError } from "../utils/openaiImageErrors.js";
import { StatusCodes } from "http-status-codes";
import { getStaticImageConfig } from "../config/openaiImageConfig.js";

export const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export const validatePrompt = (prompt, maxChars) => {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) {
    throw new OpenAIImageError("Prompt is required.", {
      code: "prompt_required",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (trimmed.length > maxChars) {
    throw new OpenAIImageError(`Prompt exceeds ${maxChars} characters.`, {
      code: "prompt_too_long",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  return trimmed;
};

export const validateBackgroundSetting = (background) => {
  if (background === "transparent") {
    throw new OpenAIImageError(
      "Transparent backgrounds are not supported for gpt-image-2.",
      {
        code: "invalid_background",
        statusCode: StatusCodes.BAD_REQUEST,
      }
    );
  }
};

export const validateUploadedImage = async (
  file,
  { maxBytes = getStaticImageConfig().maxUploadBytes } = {}
) => {
  if (!file?.buffer?.length) {
    throw new OpenAIImageError("Image file is required.", {
      code: "image_required",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
    throw new OpenAIImageError("Unsupported image format.", {
      code: "unsupported_format",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (file.size > maxBytes) {
    throw new OpenAIImageError("Image file exceeds size limit.", {
      code: "file_too_large",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  let meta;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch (_err) {
    throw new OpenAIImageError("Invalid image file.", {
      code: "invalid_image",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (!meta.width || !meta.height) {
    throw new OpenAIImageError("Could not read image dimensions.", {
      code: "invalid_image",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  return { buffer: file.buffer, meta, mimetype: file.mimetype };
};

export const validateImageBuffer = async (
  buffer,
  { maxBytes = getStaticImageConfig().maxUploadBytes, label = "Image" } = {}
) => {
  if (!buffer?.length) {
    throw new OpenAIImageError(`${label} is required.`, {
      code: "image_required",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (buffer.length > maxBytes) {
    throw new OpenAIImageError(`${label} exceeds size limit.`, {
      code: "file_too_large",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (_err) {
    throw new OpenAIImageError(`Invalid ${label.toLowerCase()}.`, {
      code: "invalid_image",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  return { buffer, meta };
};

export const validateMaskUpload = async (
  file,
  imageMeta,
  { maxBytes = getStaticImageConfig().maxMaskBytes } = {}
) => {
  if (!file?.buffer?.length) {
    throw new OpenAIImageError("Mask file is required.", {
      code: "mask_required",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (file.mimetype !== "image/png") {
    throw new OpenAIImageError("Mask must be a PNG file.", {
      code: "unsupported_format",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (file.size > maxBytes) {
    throw new OpenAIImageError("Mask file exceeds size limit.", {
      code: "file_too_large",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  const { meta } = await validateImageBuffer(file.buffer, {
    maxBytes,
    label: "Mask",
  });
  validateMaskMatchesImage(meta, imageMeta);
  return { buffer: file.buffer, meta };
};

export const validateMaskMatchesImage = (maskMeta, imageMeta) => {
  if (
    maskMeta.width !== imageMeta.width ||
    maskMeta.height !== imageMeta.height
  ) {
    throw new OpenAIImageError(
      "Mask dimensions must exactly match the source image.",
      {
        code: "mask_dimension_mismatch",
        statusCode: StatusCodes.BAD_REQUEST,
      }
    );
  }
};
