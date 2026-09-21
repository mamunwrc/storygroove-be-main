import mongoose from "mongoose";
import ApiUsageLog from "../models/apiUsageLogModel.js";
import { estimateCost } from "./logApiUsage.js";

/**
 * Chat-style endpoints where OpenAI's prompt cache is normally very active
 * (long, repeating conversation context). Legacy rows for these endpoints had
 * no `cachedInputTokens` stored, so applying an assumed cache-hit ratio brings
 * historical cost close to OpenAI's actual billed amount.
 *
 * Endpoints not in this set get a 0% legacy cache ratio (i.e. recompute treats
 * their input as fully fresh, which is correct for short one-shot prompts).
 */
const DEFAULT_LEGACY_CHAT_ENDPOINTS = new Set([
  "chat",
  "chat-stream",
  "generateStory",
  "generateRichSceneStream",
]);

/**
 * Recompute `cost` on existing ApiUsageLog rows using the current model
 * pricing table. Designed to be called from:
 *   - scripts/recomputeApiUsageCost.js   (one-off CLI run)
 *   - POST /api/api-usage/recompute-costs (admin-triggered, async)
 *
 * Streams the collection with a cursor and bulk-writes in batches so it
 * scales to the full log history without OOM.
 *
 * Legacy heuristic (only applied when `legacyCutoffDate` is set):
 *   For rows older than the cutoff that have `cachedInputTokens === 0` and an
 *   endpoint in `legacyChatEndpoints`, we synthesise a cached-token split:
 *     cachedInputTokens = round(promptTokens * legacyCacheRatio)
 *   The synthesised split is persisted to the row alongside the recomputed
 *   cost so the dashboard reads consistent numbers afterwards.
 *
 *   This is a best-effort backfill — the original `cached_tokens` value
 *   reported by OpenAI is no longer available for those calls.
 *
 * @param {object} [opts]
 * @param {number} [opts.batchSize=1000]
 * @param {object} [opts.filter={}]                       - mongo filter to limit scope
 * @param {Date}   [opts.legacyCutoffDate]                - rows older than this get the heuristic
 * @param {number} [opts.legacyCacheRatio=0]              - 0..1, fraction of input assumed cached
 * @param {Set<string>} [opts.legacyChatEndpoints]        - endpoints eligible for the heuristic
 * @param {boolean} [opts.dryRun=false]                   - log what would change without writing
 * @param {(progress: object) => void} [opts.onProgress]  - called every batch
 * @returns {Promise<{ scanned: number, updated: number, legacyAdjusted: number,
 *                     totalCostBefore: number, totalCostAfter: number }>}
 */
export async function recomputeApiUsageCost({
  batchSize = 1000,
  filter = {},
  legacyCutoffDate,
  legacyCacheRatio = 0,
  legacyChatEndpoints = DEFAULT_LEGACY_CHAT_ENDPOINTS,
  dryRun = false,
  onProgress,
} = {}) {
  let scanned = 0;
  let updated = 0;
  let legacyAdjusted = 0;
  let totalCostBefore = 0;
  let totalCostAfter = 0;
  let ops = [];

  const clampedRatio = Math.max(0, Math.min(1, Number(legacyCacheRatio) || 0));
  const hasLegacyHeuristic =
    legacyCutoffDate instanceof Date && clampedRatio > 0;

  const flush = async () => {
    if (ops.length === 0) return;
    if (!dryRun) {
      await ApiUsageLog.bulkWrite(ops, { ordered: false });
    }
    updated += ops.length;
    ops = [];
    if (onProgress) {
      onProgress({ scanned, updated, legacyAdjusted });
    }
  };

  const cursor = ApiUsageLog.find(filter, {
    _id: 1,
    model: 1,
    endpoint: 1,
    createdAt: 1,
    promptTokens: 1,
    cachedInputTokens: 1,
    completionTokens: 1,
    imageInputTokens: 1,
    imageCachedInputTokens: 1,
    imageOutputTokens: 1,
    cost: 1,
  })
    .lean()
    .cursor();

  for await (const doc of cursor) {
    scanned += 1;
    totalCostBefore += doc.cost || 0;

    let cachedInputTokens = doc.cachedInputTokens || 0;
    let appliedHeuristic = false;

    if (
      hasLegacyHeuristic &&
      cachedInputTokens === 0 &&
      doc.createdAt &&
      doc.createdAt < legacyCutoffDate &&
      legacyChatEndpoints.has(doc.endpoint)
    ) {
      cachedInputTokens = Math.round((doc.promptTokens || 0) * clampedRatio);
      appliedHeuristic = true;
    }

    const newCost = estimateCost({
      model: doc.model,
      inputTokens: doc.promptTokens || 0,
      cachedInputTokens,
      outputTokens: doc.completionTokens || 0,
      imageInputTokens: doc.imageInputTokens || 0,
      imageCachedInputTokens: doc.imageCachedInputTokens || 0,
      imageOutputTokens: doc.imageOutputTokens || 0,
    });

    totalCostAfter += newCost;

    const costChanged = newCost !== doc.cost;
    if (costChanged || appliedHeuristic) {
      const set = { cost: newCost };
      if (appliedHeuristic) {
        set.cachedInputTokens = cachedInputTokens;
        legacyAdjusted += 1;
      }
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: set },
        },
      });
    }

    if (ops.length >= batchSize) await flush();
  }

  await flush();
  return {
    scanned,
    updated,
    legacyAdjusted,
    totalCostBefore,
    totalCostAfter,
    dryRun,
  };
}

/**
 * Bare entry point so the script can `import { runRecomputeFromCli } from ...`
 * and not duplicate connection/cleanup boilerplate.
 */
export async function runRecomputeFromCli(opts = {}) {
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGODB_NAME,
  });
  try {
    return await recomputeApiUsageCost(opts);
  } finally {
    await mongoose.disconnect();
  }
}
