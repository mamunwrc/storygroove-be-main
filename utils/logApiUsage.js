import ApiUsageLog from "../models/apiUsageLogModel.js";
import { DEFAULT_MODEL } from "../constants/models.js";
import { getPricing } from "../constants/modelPricing.js";

/**
 * Round a USD cost to 6 decimals to prevent float-summation drift when the
 * admin dashboard aggregates thousands of rows. 6 decimals = $0.000001
 * resolution, well below any per-call OpenAI price.
 */
const roundCost = (value) => Math.round((value || 0) * 1e6) / 1e6;

/**
 * Compute USD cost for a single OpenAI API call from token counts and the
 * model's published pricing.
 *
 * Pricing is resolved from constants/modelPricing.js. Unknown models fall back
 * to $0, which is visible as drift against the OpenAI Admin Costs API total —
 * that's the signal to add the model to modelPricing.js.
 *
 * Text models (`gpt-5.x`) bill against:
 *   - inputTokens / cachedInputTokens / outputTokens
 *   using pricing.input / pricing.cachedInput / pricing.output. If the model
 *   declares a `longContextThreshold` and `inputTokens` exceeds it, the
 *   `longInput / longCachedInput / longOutput` rates are used instead (this
 *   matches OpenAI's published "Long context" tier on the pricing page).
 *
 * Image-generation models (`gpt-image-x`) bill against:
 *   - inputTokens / cachedInputTokens                  → text prompt tokens
 *     (pricing.textInput / pricing.textCachedInput)
 *   - imageInputTokens / imageCachedInputTokens        → reference image tokens
 *     (pricing.imageInput / pricing.imageCachedInput)
 *   - imageOutputTokens                                → generated image tokens
 *     (pricing.imageOutput)
 *   - outputTokens                                     → any text output
 *     (pricing.textOutput, e.g. gpt-image-1.5)
 *
 * For text models, the textInput / textCachedInput / textOutput rates are not
 * defined, so input / cachedInput / output are used. For image models, the
 * opposite holds. Missing rates default to 0.
 *
 * @param {object} params
 * @param {string} [params.model]
 * @param {number} [params.inputTokens]          - text input (includes any cached portion)
 * @param {number} [params.cachedInputTokens]    - subset of inputTokens served from cache
 * @param {number} [params.outputTokens]         - text output tokens
 * @param {number} [params.imageInputTokens]     - reference image tokens
 * @param {number} [params.imageCachedInputTokens]
 * @param {number} [params.imageOutputTokens]    - generated image tokens
 * @returns {number} cost in USD, rounded to 6 decimals
 */
export function estimateCost({
  model,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  imageInputTokens = 0,
  imageCachedInputTokens = 0,
  imageOutputTokens = 0,
} = {}) {
  const p = getPricing(model);

  const useLongContext =
    p.longContextThreshold != null &&
    (inputTokens || 0) > p.longContextThreshold;

  const inputRate = useLongContext
    ? (p.longInput ?? 0)
    : (p.input ?? p.textInput ?? 0);
  const cachedInputRate = useLongContext
    ? (p.longCachedInput ?? 0)
    : (p.cachedInput ?? p.textCachedInput ?? 0);
  const outputRate = useLongContext
    ? (p.longOutput ?? 0)
    : (p.output ?? p.textOutput ?? 0);
  const imageInputRate = p.imageInput ?? 0;
  const imageCachedInputRate = p.imageCachedInput ?? 0;
  const imageOutputRate = p.imageOutput ?? 0;

  const billableTextInput = Math.max(0, (inputTokens || 0) - (cachedInputTokens || 0));
  const billableImageInput = Math.max(
    0,
    (imageInputTokens || 0) - (imageCachedInputTokens || 0)
  );

  const textInputCost = (billableTextInput / 1_000_000) * inputRate;
  const textCachedCost = ((cachedInputTokens || 0) / 1_000_000) * cachedInputRate;
  const textOutputCost = ((outputTokens || 0) / 1_000_000) * outputRate;
  const imageInputCost = (billableImageInput / 1_000_000) * imageInputRate;
  const imageCachedCost =
    ((imageCachedInputTokens || 0) / 1_000_000) * imageCachedInputRate;
  const imageOutputCost = ((imageOutputTokens || 0) / 1_000_000) * imageOutputRate;

  return roundCost(
    textInputCost +
      textCachedCost +
      textOutputCost +
      imageInputCost +
      imageCachedCost +
      imageOutputCost
  );
}

/**
 * Log an OpenAI Responses API call to the ApiUsageLog collection.
 *
 * @param {object} response  - The OpenAI Responses API response object (must have .usage)
 * @param {object} params
 * @param {string} params.userId      - Mongoose user _id
 * @param {string} params.userEmail   - User email for quick lookups
 * @param {string} params.endpoint    - Logical endpoint name (e.g. "chat", "generateStory")
 * @param {string} [params.model]     - Model used
 */
export async function logApiUsage(response, { userId, userEmail, endpoint, model }) {
  try {
    if (!response?.usage || !userId) return;

    const promptTokens = response.usage.input_tokens || 0;
    const cachedInputTokens =
      response.usage.input_tokens_details?.cached_tokens || 0;
    const completionTokens = response.usage.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;
    const resolvedModel = model || DEFAULT_MODEL;
    const cost = estimateCost({
      model: resolvedModel,
      inputTokens: promptTokens,
      cachedInputTokens,
      outputTokens: completionTokens,
    });

    await ApiUsageLog.create({
      userId,
      userEmail: userEmail || "unknown",
      endpoint: endpoint || "unknown",
      model: resolvedModel,
      promptTokens,
      cachedInputTokens,
      completionTokens,
      totalTokens,
      cost,
    });
  } catch (err) {
    console.error("logApiUsage error (non-blocking):", err.message);
  }
}

/**
 * Log usage from raw token / image counts. Used for:
 *   - streaming chat responses (usage accumulated from the final stream event)
 *   - image generation (usage from `openai.images.generate` response)
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.userEmail]
 * @param {string} [params.endpoint]
 * @param {string} [params.model]
 * @param {number} [params.promptTokens]
 * @param {number} [params.cachedInputTokens]
 * @param {number} [params.completionTokens]
 * @param {number} [params.imageInputTokens]
 * @param {number} [params.imageCachedInputTokens]
 * @param {number} [params.imageOutputTokens]
 * @param {number} [params.imageCount]            - informational only (not used in cost)
 */
export async function logApiUsageRaw({
  userId,
  userEmail,
  endpoint,
  model,
  promptTokens = 0,
  cachedInputTokens = 0,
  completionTokens = 0,
  imageInputTokens = 0,
  imageCachedInputTokens = 0,
  imageOutputTokens = 0,
  imageCount = 0,
}) {
  try {
    if (!userId) return;

    const totalTokens =
      promptTokens + completionTokens + imageInputTokens + imageOutputTokens;
    const resolvedModel = model || DEFAULT_MODEL;
    const cost = estimateCost({
      model: resolvedModel,
      inputTokens: promptTokens,
      cachedInputTokens,
      outputTokens: completionTokens,
      imageInputTokens,
      imageCachedInputTokens,
      imageOutputTokens,
    });

    await ApiUsageLog.create({
      userId,
      userEmail: userEmail || "unknown",
      endpoint: endpoint || "unknown",
      model: resolvedModel,
      promptTokens,
      cachedInputTokens,
      completionTokens,
      imageInputTokens,
      imageCachedInputTokens,
      imageOutputTokens,
      totalTokens,
      imageCount,
      cost,
    });
  } catch (err) {
    console.error("logApiUsageRaw error (non-blocking):", err.message);
  }
}
