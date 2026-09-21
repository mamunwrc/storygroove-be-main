#!/usr/bin/env node
/**
 * Diagnose why the admin dashboard's "Estimated Cost · This Month" doesn't
 * match the OpenAI usage page.
 *
 * Prints, for the current calendar month:
 *   1. Per-model totals       — request count, tokens (input / cached / output /
 *                                image-in / image-out), and our computed cost.
 *   2. Per-endpoint totals    — same breakdown grouped by `endpoint`, so you
 *                                can spot a single feature inflating the bill.
 *   3. Duplicate suspects     — pairs of rows for the same user/endpoint/model
 *                                with identical token counts created within 60s
 *                                of each other (likely double-logged events).
 *   4. Grand total            — our computed cost for the month.
 *
 * Usage:
 *   node scripts/diagnoseApiUsageCost.js              # current month
 *   node scripts/diagnoseApiUsageCost.js --days=30    # rolling last N days
 *   node scripts/diagnoseApiUsageCost.js --start=2026-05-01 --end=2026-05-15
 *
 * Reads MONGO_URI and MONGODB_NAME from .env (same as the server).
 */
import "dotenv/config";
import mongoose from "mongoose";
import ApiUsageLog from "../models/apiUsageLogModel.js";
import { MODEL_PRICING, getPricing } from "../constants/modelPricing.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {};
  for (const arg of args) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    opts[k] = v === undefined ? true : v;
  }
  return opts;
};

const resolveRange = (opts) => {
  const now = new Date();
  if (opts.start && opts.end) {
    return { start: new Date(opts.start), end: new Date(opts.end) };
  }
  if (opts.days) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - Number(opts.days));
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
};

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n || 0);

const fmtInt = (n) => (n || 0).toLocaleString();

const ratesFor = (model) => {
  const p = getPricing(model);
  return {
    input: p.input ?? p.textInput ?? 0,
    cachedInput: p.cachedInput ?? p.textCachedInput ?? 0,
    output: p.output ?? p.textOutput ?? 0,
    imageInput: p.imageInput ?? 0,
    imageOutput: p.imageOutput ?? 0,
  };
};

const main = async () => {
  const opts = parseArgs();
  const { start, end } = resolveRange(opts);

  console.log("\n=== API Usage Cost Diagnostic ===");
  console.log(`Range: ${start.toISOString()}  →  ${end.toISOString()}\n`);

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGODB_NAME,
  });

  try {
    // 1. Per-model totals ------------------------------------------------
    const perModel = await ApiUsageLog.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: "$model",
          rows: { $sum: 1 },
          inputTokens: { $sum: "$promptTokens" },
          cachedInputTokens: { $sum: "$cachedInputTokens" },
          outputTokens: { $sum: "$completionTokens" },
          imageInputTokens: { $sum: "$imageInputTokens" },
          imageOutputTokens: { $sum: "$imageOutputTokens" },
          cost: { $sum: "$cost" },
        },
      },
      { $sort: { cost: -1 } },
    ]);

    console.log("─── Per-model totals ───────────────────────────────────────");
    console.log(
      [
        "model".padEnd(18),
        "rows".padStart(7),
        "input".padStart(12),
        "cached".padStart(12),
        "output".padStart(12),
        "imgIn".padStart(10),
        "imgOut".padStart(10),
        "our $".padStart(12),
      ].join(" ")
    );
    let totalCost = 0;
    for (const r of perModel) {
      totalCost += r.cost || 0;
      console.log(
        [
          String(r._id || "(none)").padEnd(18),
          fmtInt(r.rows).padStart(7),
          fmtInt(r.inputTokens).padStart(12),
          fmtInt(r.cachedInputTokens).padStart(12),
          fmtInt(r.outputTokens).padStart(12),
          fmtInt(r.imageInputTokens).padStart(10),
          fmtInt(r.imageOutputTokens).padStart(10),
          fmtUSD(r.cost).padStart(12),
        ].join(" ")
      );
    }
    console.log("─".repeat(95));
    console.log(`Total this range: ${fmtUSD(totalCost)}\n`);

    // 2. Show the current pricing rates so the user can sanity-check ----
    console.log("─── Current pricing in modelPricing.js (USD per 1M tokens) ─");
    console.log(
      [
        "model".padEnd(18),
        "input".padStart(9),
        "cached".padStart(9),
        "output".padStart(9),
        "imgIn".padStart(9),
        "imgOut".padStart(9),
      ].join(" ")
    );
    const seenModels = new Set([
      ...perModel.map((r) => r._id),
      ...Object.keys(MODEL_PRICING),
    ]);
    for (const model of seenModels) {
      if (!model) continue;
      const r = ratesFor(model);
      console.log(
        [
          String(model).padEnd(18),
          ("$" + r.input).padStart(9),
          ("$" + r.cachedInput).padStart(9),
          ("$" + r.output).padStart(9),
          ("$" + r.imageInput).padStart(9),
          ("$" + r.imageOutput).padStart(9),
        ].join(" ")
      );
    }
    console.log("");

    // 3. Per-endpoint totals --------------------------------------------
    const perEndpoint = await ApiUsageLog.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: "$endpoint",
          rows: { $sum: 1 },
          inputTokens: { $sum: "$promptTokens" },
          outputTokens: { $sum: "$completionTokens" },
          cost: { $sum: "$cost" },
        },
      },
      { $sort: { cost: -1 } },
      { $limit: 20 },
    ]);

    console.log("─── Top endpoints by cost ─────────────────────────────────");
    console.log(
      [
        "endpoint".padEnd(28),
        "rows".padStart(7),
        "input".padStart(12),
        "output".padStart(12),
        "our $".padStart(12),
      ].join(" ")
    );
    for (const r of perEndpoint) {
      console.log(
        [
          String(r._id || "(none)").padEnd(28),
          fmtInt(r.rows).padStart(7),
          fmtInt(r.inputTokens).padStart(12),
          fmtInt(r.outputTokens).padStart(12),
          fmtUSD(r.cost).padStart(12),
        ].join(" ")
      );
    }
    console.log("");

    // 4. Duplicate suspects ---------------------------------------------
    // Rows with identical token counts for the same user + endpoint + model,
    // created within 60s of each other. Most likely double-logged events.
    const dupes = await ApiUsageLog.aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: {
            userId: "$userId",
            endpoint: "$endpoint",
            model: "$model",
            promptTokens: "$promptTokens",
            completionTokens: "$completionTokens",
          },
          rows: { $sum: 1 },
          ids: { $push: "$_id" },
          createdAts: { $push: "$createdAt" },
          totalCost: { $sum: "$cost" },
        },
      },
      { $match: { rows: { $gte: 2 } } },
      {
        $project: {
          rows: 1,
          totalCost: 1,
          maxGapMs: {
            $subtract: [{ $max: "$createdAts" }, { $min: "$createdAts" }],
          },
        },
      },
      { $match: { maxGapMs: { $lte: 60 * 1000 } } },
      { $sort: { totalCost: -1 } },
      { $limit: 15 },
    ]);

    console.log("─── Potential duplicate logs (same tokens, < 60 s apart) ───");
    if (dupes.length === 0) {
      console.log("None detected.\n");
    } else {
      console.log(
        [
          "endpoint".padEnd(28),
          "model".padEnd(14),
          "prompt".padStart(10),
          "output".padStart(10),
          "rows".padStart(5),
          "extra $".padStart(12),
        ].join(" ")
      );
      let dupExtraCost = 0;
      for (const d of dupes) {
        // Extra cost = total - (cost of one row) ≈ (rows-1)/rows * total
        const extra = ((d.rows - 1) / d.rows) * d.totalCost;
        dupExtraCost += extra;
        console.log(
          [
            String(d._id.endpoint || "(none)").padEnd(28),
            String(d._id.model || "(none)").padEnd(14),
            fmtInt(d._id.promptTokens).padStart(10),
            fmtInt(d._id.completionTokens).padStart(10),
            String(d.rows).padStart(5),
            fmtUSD(extra).padStart(12),
          ].join(" ")
        );
      }
      console.log(
        `\nEstimated extra cost from these duplicates: ${fmtUSD(dupExtraCost)}`
      );
      console.log(
        "(rerun with `--days=1` for the last 24 h if you want a smaller window)\n"
      );
    }

    console.log("=== Done ===\n");
    console.log("Next steps:");
    console.log(
      "1) Compare the per-model token totals above to the OpenAI Usage page (per model)."
    );
    console.log(
      "   If our token counts match OpenAI's but cost is higher, our rates in modelPricing.js are too high."
    );
    console.log(
      "2) If duplicate suspects above add up to a big chunk, we're double-logging — share that section and I'll fix the source."
    );
    console.log(
      "3) After fixing pricing, run: node scripts/recomputeApiUsageCost.js to rewrite historical cost.\n"
    );
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error("diagnoseApiUsageCost failed:", err);
  process.exit(1);
});
