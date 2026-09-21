/**
 * OpenAI per-model pricing in USD per 1,000,000 tokens.
 *
 * Text models (`gpt-5.x` family):
 *   - input            → short-context input tokens (not cached)
 *   - cachedInput      → short-context prompt-cache hits
 *                        (Responses API: usage.input_tokens_details.cached_tokens)
 *   - output           → short-context output tokens (includes reasoning tokens)
 *
 *   Some models additionally publish a "long context" tier that activates
 *   once a single request's prompt exceeds `longContextThreshold` input tokens.
 *   When that happens, ALL input + output for that request bills at the
 *   `longInput / longCachedInput / longOutput` rates instead.
 *
 *   Models that don't publish a long-context tier (mini / nano) keep the
 *   short rates regardless of prompt size.
 *
 * Image generation models (`gpt-image-x`): OpenAI bills these per token, NOT
 * per image. The `images.generate` response carries:
 *   usage.input_tokens, usage.input_tokens_details.{text_tokens, image_tokens},
 *   usage.output_tokens
 * Each entry below provides separate rates for the text and image modalities:
 *   - textInput / textCachedInput / textOutput → prompt text tokens
 *   - imageInput / imageCachedInput            → uploaded reference-image tokens
 *   - imageOutput                              → generated image tokens
 *
 * Rates below are the "Standard" tier from
 * https://developers.openai.com/api/docs/pricing — switch tiers when we adopt
 * Batch / Flex / Priority processing. Update via PR whenever OpenAI publishes
 * new prices.
 *
 * Last verified: 2026-05-25.
 */

/**
 * Long-context activation thresholds (input tokens in a single request).
 * OpenAI publishes different cutoffs per model family — override per entry
 * via `longContextThreshold` on each MODEL_PRICING row.
 */
export const LONG_CONTEXT_THRESHOLD_STANDARD = 272_000;
export const LONG_CONTEXT_THRESHOLD_PRO = 200_000;

export const MODEL_PRICING = {
  "gpt-5.5": {
    input: 5.0,
    cachedInput: 0.5,
    output: 30.0,
    longContextThreshold: LONG_CONTEXT_THRESHOLD_STANDARD,
    longInput: 10.0,
    longCachedInput: 1.0,
    longOutput: 45.0,
  },
  "gpt-5.5-pro": {
    input: 30.0,
    cachedInput: 0,
    output: 180.0,
    longContextThreshold: LONG_CONTEXT_THRESHOLD_PRO,
    longInput: 60.0,
    longCachedInput: 0,
    longOutput: 270.0,
  },
  "gpt-5.4": {
    input: 2.5,
    cachedInput: 0.25,
    output: 15.0,
    longContextThreshold: LONG_CONTEXT_THRESHOLD_STANDARD,
    longInput: 5.0,
    longCachedInput: 0.5,
    longOutput: 22.5,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    cachedInput: 0.075,
    output: 4.5,
  },
  "gpt-5.4-nano": {
    input: 0.2,
    cachedInput: 0.02,
    output: 1.25,
  },
  "gpt-5.4-pro": {
    input: 30.0,
    cachedInput: 0,
    output: 180.0,
    longContextThreshold: LONG_CONTEXT_THRESHOLD_PRO,
    longInput: 60.0,
    longCachedInput: 0,
    longOutput: 270.0,
  },
  "gpt-image-2": {
    textInput: 5.0,
    textCachedInput: 1.25,
    imageInput: 8.0,
    imageCachedInput: 2.0,
    imageOutput: 30.0,
  },
  "gpt-image-1.5": {
    textInput: 5.0,
    textCachedInput: 1.25,
    textOutput: 10.0,
    imageInput: 8.0,
    imageCachedInput: 2.0,
    imageOutput: 32.0,
  },
  "gpt-image-1-mini": {
    textInput: 2.0,
    textCachedInput: 0.2,
    imageInput: 2.5,
    imageCachedInput: 0.25,
    imageOutput: 8.0,
  },
};

export const FALLBACK_PRICING = {
  input: 0,
  cachedInput: 0,
  output: 0,
  longContextThreshold: null,
  longInput: 0,
  longCachedInput: 0,
  longOutput: 0,
  textInput: 0,
  textCachedInput: 0,
  textOutput: 0,
  imageInput: 0,
  imageCachedInput: 0,
  imageOutput: 0,
};

/**
 * Resolve pricing for a given OpenAI model id.
 * Falls back to all-zero rates (rather than throwing) so an unknown model never
 * crashes the request path — it just logs $0 cost, which is visible as drift
 * against the OpenAI Admin Costs API total in the admin dashboard.
 *
 * @param {string} model - OpenAI model id (e.g. "gpt-5.4-mini")
 * @returns {object} pricing entry; missing rates are treated as 0 by `estimateCost`
 */
export function getPricing(model) {
  if (!model) return FALLBACK_PRICING;
  return MODEL_PRICING[model] || FALLBACK_PRICING;
}
