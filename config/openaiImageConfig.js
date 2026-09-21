import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import { OpenAIImageError } from "../utils/openaiImageErrors.js";
import { StatusCodes } from "http-status-codes";

const ALLOWED_MODELS = new Set(["gpt-image-2", "gpt-image-1.5"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const ALLOWED_OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);
const ALLOWED_BACKGROUNDS = new Set(["auto", "opaque"]);
const ALLOWED_MODERATION = new Set(["auto", "low"]);

const envInt = (key, fallback) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
};

export const getStaticImageConfig = () => ({
  defaultModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
  defaultSize: process.env.OPENAI_IMAGE_DEFAULT_SIZE || "1024x1536",
  defaultQuality: process.env.OPENAI_IMAGE_DEFAULT_QUALITY || "high",
  defaultOutputFormat: process.env.OPENAI_IMAGE_DEFAULT_OUTPUT_FORMAT || "png",
  defaultBackground: process.env.OPENAI_IMAGE_DEFAULT_BACKGROUND || "auto",
  defaultModeration: process.env.OPENAI_IMAGE_DEFAULT_MODERATION || "auto",
  partialImages: Math.min(3, Math.max(0, envInt("OPENAI_IMAGE_PARTIAL_IMAGES", 0))),
  maxUploadBytes: envInt("OPENAI_IMAGE_MAX_UPLOAD_MB", 50) * 1024 * 1024,
  maxMaskBytes: envInt("OPENAI_IMAGE_MAX_MASK_MB", 4) * 1024 * 1024,
  maxPromptChars: envInt("OPENAI_IMAGE_MAX_PROMPT_CHARS", 32000),
  maxReferenceImages: envInt("OPENAI_IMAGE_MAX_REFERENCE_IMAGES", 16),
  maxN: Math.min(10, Math.max(1, envInt("OPENAI_IMAGE_MAX_N", 10))),
  timeoutMs: envInt("OPENAI_IMAGE_TIMEOUT_MS", 180000),
  retryMax: envInt("OPENAI_IMAGE_RETRY_MAX", 2),
  retryBackoffMs: envInt("OPENAI_IMAGE_RETRY_BACKOFF_MS", 1000),
  enhancementModel: process.env.OPENAI_IMAGE_ENHANCEMENT_MODEL || "gpt-4.1-mini",
  enhancementEnabled:
    process.env.OPENAI_IMAGE_ENHANCEMENT_ENABLED !== "false",
});

export const clampPartialImages = (value) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, n));
};

export const resolveImageSettings = async (overrides = {}) => {
  const staticConfig = getStaticImageConfig();
  let adminSettings = null;
  try {
    adminSettings = await ApiUsageSettings.getSettings();
  } catch (_err) {
    adminSettings = null;
  }

  const model =
    overrides.model ||
    adminSettings?.coverImageModel ||
    staticConfig.defaultModel;

  if (!ALLOWED_MODELS.has(model)) {
    throw new OpenAIImageError(`Unsupported image model: ${model}`, {
      code: "unsupported_model",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  const partialImages =
    overrides.partialImages != null
      ? clampPartialImages(overrides.partialImages)
      : clampPartialImages(
          adminSettings?.coverImagePartialImages ?? staticConfig.partialImages
        );

  const quality = overrides.quality || staticConfig.defaultQuality;
  const size = overrides.size || staticConfig.defaultSize;
  const outputFormat = overrides.outputFormat || staticConfig.defaultOutputFormat;
  const background = overrides.background || staticConfig.defaultBackground;
  const moderation = overrides.moderation || staticConfig.defaultModeration;

  if (!ALLOWED_QUALITIES.has(quality)) {
    throw new OpenAIImageError(`Invalid quality: ${quality}`, {
      code: "invalid_quality",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (!ALLOWED_OUTPUT_FORMATS.has(outputFormat)) {
    throw new OpenAIImageError(`Invalid output format: ${outputFormat}`, {
      code: "invalid_output_format",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }
  if (!ALLOWED_BACKGROUNDS.has(background)) {
    throw new OpenAIImageError(
      background === "transparent"
        ? "Transparent backgrounds are not supported for gpt-image-2."
        : `Invalid background: ${background}`,
      {
        code: "invalid_background",
        statusCode: StatusCodes.BAD_REQUEST,
      }
    );
  }
  if (!ALLOWED_MODERATION.has(moderation)) {
    throw new OpenAIImageError(`Invalid moderation: ${moderation}`, {
      code: "invalid_moderation",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  const nRaw = overrides.n != null ? Number(overrides.n) : 1;
  const n = Math.min(staticConfig.maxN, Math.max(1, Number.isFinite(nRaw) ? Math.floor(nRaw) : 1));

  const outputCompression =
    overrides.outputCompression != null
      ? Math.min(100, Math.max(0, Number(overrides.outputCompression)))
      : undefined;

  return {
    model,
    size,
    quality,
    outputFormat,
    background,
    moderation,
    n,
    partialImages,
    outputCompression,
    stream: Boolean(overrides.stream) && partialImages > 0,
    timeoutMs: staticConfig.timeoutMs,
    retryMax: staticConfig.retryMax,
    retryBackoffMs: staticConfig.retryBackoffMs,
    maxUploadBytes: staticConfig.maxUploadBytes,
    maxMaskBytes: staticConfig.maxMaskBytes,
    maxPromptChars: staticConfig.maxPromptChars,
    maxReferenceImages: staticConfig.maxReferenceImages,
    enhancementModel: staticConfig.enhancementModel,
    enhancementEnabled: staticConfig.enhancementEnabled,
  };
};
