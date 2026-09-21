#!/usr/bin/env node
/**
 * Recompute `cost` on every ApiUsageLog row using the current pricing
 * constants. Run after deploying a pricing change, or to backfill the
 * fix from the old single-flat-rate `estimateCost`.
 *
 * Usage:
 *   node scripts/recomputeApiUsageCost.js
 *
 *   # Apply a legacy cache-hit heuristic to old rows that were logged
 *   # before we started capturing OpenAI's `cached_tokens` field.
 *   # For rows older than --legacy-cutoff with an empty cachedInputTokens
 *   # AND a chat-style endpoint, treat `--ratio` fraction of input as cached:
 *   node scripts/recomputeApiUsageCost.js --legacy-cutoff=2026-05-15 --ratio=0.75
 *
 *   # Preview without writing anything:
 *   node scripts/recomputeApiUsageCost.js --legacy-cutoff=2026-05-15 --ratio=0.75 --dry-run
 *
 * Reads MONGO_URI and MONGODB_NAME from .env (same as the server).
 */
import "dotenv/config";
import { runRecomputeFromCli } from "../utils/recomputeApiUsageCost.js";

const parseArgs = () => {
  const opts = {};
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    opts[k] = v === undefined ? true : v;
  }
  return opts;
};

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n || 0);

const main = async () => {
  const args = parseArgs();

  let legacyCutoffDate;
  if (args["legacy-cutoff"]) {
    legacyCutoffDate = new Date(args["legacy-cutoff"]);
    if (Number.isNaN(legacyCutoffDate.getTime())) {
      console.error(
        `Invalid --legacy-cutoff date: ${args["legacy-cutoff"]} (use ISO format, e.g. 2026-05-15)`
      );
      process.exit(1);
    }
  }

  const legacyCacheRatio = args.ratio ? Number(args.ratio) : 0;
  if (legacyCutoffDate && (legacyCacheRatio <= 0 || legacyCacheRatio > 1)) {
    console.error("--ratio must be > 0 and <= 1 when --legacy-cutoff is set");
    process.exit(1);
  }

  const dryRun = Boolean(args["dry-run"]);

  console.log("[recomputeApiUsageCost] connecting...");
  if (legacyCutoffDate) {
    console.log(
      `[recomputeApiUsageCost] legacy heuristic: rows < ${legacyCutoffDate.toISOString()} on chat endpoints will assume ${(
        legacyCacheRatio * 100
      ).toFixed(0)}% cached`
    );
  } else {
    console.log("[recomputeApiUsageCost] no legacy heuristic (pass --legacy-cutoff and --ratio to enable)");
  }
  if (dryRun) {
    console.log("[recomputeApiUsageCost] DRY RUN — no rows will be written");
  }

  const startedAt = Date.now();
  try {
    const result = await runRecomputeFromCli({
      batchSize: 1000,
      legacyCutoffDate,
      legacyCacheRatio,
      dryRun,
      onProgress: ({ scanned, updated, legacyAdjusted }) => {
        console.log(
          `[recomputeApiUsageCost] scanned=${scanned} updated=${updated} legacyAdjusted=${legacyAdjusted}`
        );
      },
    });
    const elapsedMs = Date.now() - startedAt;
    console.log("");
    console.log("─── Summary ────────────────────────────────");
    console.log(`Rows scanned:           ${result.scanned.toLocaleString()}`);
    console.log(`Rows updated:           ${result.updated.toLocaleString()}`);
    console.log(`Legacy rows adjusted:   ${result.legacyAdjusted.toLocaleString()}`);
    console.log(`Total cost before:      ${fmtUSD(result.totalCostBefore)}`);
    console.log(`Total cost after:       ${fmtUSD(result.totalCostAfter)}`);
    console.log(
      `Delta:                  ${fmtUSD(
        result.totalCostAfter - result.totalCostBefore
      )}`
    );
    console.log(`Elapsed:                ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log(`Mode:                   ${dryRun ? "DRY RUN (no writes)" : "applied"}`);
    console.log("────────────────────────────────────────────");
    process.exit(0);
  } catch (err) {
    console.error("[recomputeApiUsageCost] failed:", err);
    process.exit(1);
  }
};

main();
