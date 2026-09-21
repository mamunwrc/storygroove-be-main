import OpenAI, { toFile } from "openai";
import { getSharedOpenAIKey } from "../controllers/chatController.js";
import { clampPartialImages } from "../config/openaiImageConfig.js";
import { mapOpenAIImageError } from "../utils/openaiImageErrors.js";

export { clampPartialImages };

export const clampCoverPartialImages = clampPartialImages;

export const createEmptyImageUsage = () => ({
  promptTokens: 0,
  cachedInputTokens: 0,
  completionTokens: 0,
  imageInputTokens: 0,
  imageCachedInputTokens: 0,
  imageOutputTokens: 0,
});

export const createImageClient = async ({ timeoutMs } = {}) => {
  const apiKey = await getSharedOpenAIKey();
  return new OpenAI({
    apiKey,
    timeout: timeoutMs || 180000,
    maxRetries: 0,
  });
};

export const normalizeImageStreamEvent = (raw) => {
  if (!raw) return null;
  if (raw.type) return raw;
  if (raw.data?.type) return raw.data;
  return null;
};

export const consumeImageStream = async (stream, onPartialImage) => {
  let finalB64 = null;
  let usage = null;

  for await (const raw of stream) {
    const event = normalizeImageStreamEvent(raw);
    if (!event?.type) continue;

    if (
      event.type === "image_generation.partial_image" ||
      event.type === "image_edit.partial_image"
    ) {
      if (event.b64_json && onPartialImage) {
        onPartialImage(event.b64_json, event.partial_image_index ?? 0);
      }
      continue;
    }

    if (
      event.type === "image_generation.completed" ||
      event.type === "image_edit.completed"
    ) {
      finalB64 = event.b64_json || finalB64;
      usage = event.usage || usage;
    }
  }

  if (!finalB64) {
    throw new Error("Image stream ended without a final image");
  }

  return { b64_json: finalB64, usage };
};

export const accumulateImageUsage = (usage, bucket) => {
  if (!usage || !bucket) return;
  const textIn = usage.input_tokens_details?.text_tokens;
  const imgIn = usage.input_tokens_details?.image_tokens;
  const totalCached = usage.input_tokens_details?.cached_tokens || 0;

  bucket.promptTokens += textIn != null ? textIn : usage.input_tokens || 0;
  bucket.imageInputTokens += imgIn || 0;
  bucket.imageOutputTokens += usage.output_tokens || 0;

  const textPart = textIn || 0;
  const imagePart = imgIn || 0;
  const totalIn = textPart + imagePart;
  if (totalIn === 0 || totalCached === 0) {
    bucket.cachedInputTokens += totalCached;
  } else {
    const textCached = Math.round((totalCached * textPart) / totalIn);
    bucket.cachedInputTokens += textCached;
    bucket.imageCachedInputTokens += totalCached - textCached;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (err) => {
  const status = err?.status;
  return status === 429 || (status >= 500 && status < 600);
};

export const withImageRetry = async (fn, { retryMax = 2, retryBackoffMs = 1000 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retryMax; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retryMax || !isRetryableError(err)) {
        throw mapOpenAIImageError(err);
      }
      await sleep(retryBackoffMs * (attempt + 1));
    }
  }
  throw mapOpenAIImageError(lastErr);
};

const buildGeneratePayload = (settings, prompt) => {
  const payload = {
    model: settings.model,
    prompt,
    n: settings.n,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    background: settings.background,
    moderation: settings.moderation,
  };
  if (settings.outputCompression != null && settings.outputFormat !== "png") {
    payload.output_compression = settings.outputCompression;
  }
  if (settings.stream) {
    payload.stream = true;
    payload.partial_images = settings.partialImages;
  }
  return payload;
};

// gpt-image-2 processes inputs at high fidelity automatically and rejects
// input_fidelity; gpt-image-1.5 / gpt-image-1 support it and benefit on edits.
const INPUT_FIDELITY_MODELS = new Set(["gpt-image-1.5", "gpt-image-1"]);

const buildEditPayload = (settings, prompt, imageFiles, maskFile) => {
  const payload = {
    model: settings.model,
    prompt,
    image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
    n: settings.n,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    background: settings.background,
    moderation: settings.moderation,
  };
  if (maskFile) payload.mask = maskFile;
  if (INPUT_FIDELITY_MODELS.has(settings.model)) {
    payload.input_fidelity = "high";
  }
  if (settings.outputCompression != null && settings.outputFormat !== "png") {
    payload.output_compression = settings.outputCompression;
  }
  if (settings.stream) {
    payload.stream = true;
    payload.partial_images = settings.partialImages;
  }
  return payload;
};

export const bufferToImageFile = async (buffer, filename = "image.png", type = "image/png") =>
  toFile(buffer, filename, { type });

export const generateImages = async (
  openai,
  { prompt, settings, onPartialImage }
) => {
  const payload = buildGeneratePayload(settings, prompt);
  const usageBucket = createEmptyImageUsage();
  let imageCount = 0;

  const runOnce = async () => {
    if (settings.stream) {
      const stream = await openai.images.generate(payload, { stream: true });
      imageCount += 1;
      const result = await consumeImageStream(stream, onPartialImage);
      accumulateImageUsage(result.usage, usageBucket);
      return {
        data: [{ b64_json: result.b64_json }],
        usage: result.usage,
        imageCount,
        usageBucket,
      };
    }

    const resp = await openai.images.generate(payload);
    imageCount += settings.n || 1;
    accumulateImageUsage(resp.usage, usageBucket);
    return {
      data: resp.data,
      usage: resp.usage,
      imageCount,
      usageBucket,
    };
  };

  return withImageRetry(runOnce, settings);
};

export const editImages = async (
  openai,
  { prompt, settings, imageBuffers, maskBuffer, onPartialImage }
) => {
  const imageFiles = await Promise.all(
    imageBuffers.map((buf, i) =>
      bufferToImageFile(buf, `image-${i}.png`, "image/png")
    )
  );
  const maskFile = maskBuffer
    ? await bufferToImageFile(maskBuffer, "mask.png", "image/png")
    : null;

  const payload = buildEditPayload(settings, prompt, imageFiles, maskFile);
  const usageBucket = createEmptyImageUsage();
  let imageCount = 0;

  const runOnce = async () => {
    if (settings.stream) {
      try {
        const stream = await openai.images.edit(payload, { stream: true });
        imageCount += 1;
        const result = await consumeImageStream(stream, onPartialImage);
        accumulateImageUsage(result.usage, usageBucket);
        return {
          data: [{ b64_json: result.b64_json }],
          usage: result.usage,
          imageCount,
          usageBucket,
        };
      } catch (streamEditErr) {
        console.error(
          "Image edit stream failed, falling back to blocking edit:",
          streamEditErr.message
        );
      }
    }

    const blockingPayload = { ...payload };
    delete blockingPayload.stream;
    delete blockingPayload.partial_images;

    const resp = await openai.images.edit(blockingPayload);
    imageCount += settings.n || 1;
    accumulateImageUsage(resp.usage, usageBucket);
    return {
      data: resp.data,
      usage: resp.usage,
      imageCount,
      usageBucket,
    };
  };

  return withImageRetry(runOnce, settings);
};
