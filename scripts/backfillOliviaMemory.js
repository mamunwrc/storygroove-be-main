/**
 * Olivia memory pipeline — Phase 2 backfill (`phase2-backfill`).
 *
 * Walks existing novels and seeds the new memory collections by
 * running the `memoryWorker` extractors over each finalized scene.
 * Also handles `memoryVersion` upgrades going forward: pass
 * `--from-version 1 --to-version 2` to re-extract only rows whose
 * `memoryVersion < to-version`.
 *
 * Idempotent: each call re-runs `summarizeScene` /
 * `extractStateUpdates` / `extractEpisodicEvents` /
 * `updateRelationshipEdges`, which all upsert by (novelId, sceneRef).
 *
 * Usage (from storygroove-be):
 *   node scripts/backfillOliviaMemory.js
 *   node scripts/backfillOliviaMemory.js --novel <novelId>
 *   node scripts/backfillOliviaMemory.js --batch-size 5 --concurrency 2
 *   node scripts/backfillOliviaMemory.js --from-version 1 --to-version 2
 *   node scripts/backfillOliviaMemory.js --dry-run
 *
 * Requires: MONGO_URI, OPENAI_API_KEY env vars. The OpenAI key is
 * pulled from `SimoneConfig.openaiApiKey` when present (matches
 * runtime resolution); falls back to OPENAI_API_KEY otherwise.
 */

import "dotenv/config";
import mongoose from "mongoose";
import Novel from "../models/novelModel.js";
import Character from "../models/characterModel.js";
import StoryResponse from "../models/storyResponseModel.js";
import UserContent from "../models/userContentModel.js";
import SceneMemory from "../models/sceneMemoryModel.js";
import {
  summarizeScene,
  extractStateUpdates,
  extractEpisodicEvents,
  updateRelationshipEdges,
} from "../service/memoryWorker.js";
import SimoneConfig from "../models/simoneConfigModel.js";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

const parseArgs = () => {
  const args = { dryRun: false, concurrency: 2, batchSize: 10 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--novel") args.novelId = a[++i];
    else if (a[i] === "--user") args.userId = a[++i];
    else if (a[i] === "--from-version") args.fromVersion = Number(a[++i]);
    else if (a[i] === "--to-version") args.toVersion = Number(a[++i]);
    else if (a[i] === "--concurrency") args.concurrency = Number(a[++i]);
    else if (a[i] === "--batch-size") args.batchSize = Number(a[++i]);
    else if (a[i] === "--dry-run") args.dryRun = true;
  }
  return args;
};

const resolveOpenAIKey = async () => {
  const cfg = await SimoneConfig.findOne().lean().catch(() => null);
  return (
    cfg?.openaiApiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    ""
  );
};

const buildCharacterLookup = (characters) => {
  const map = {};
  for (const c of characters || []) {
    if (c?.name) map[c.name.toLowerCase().trim()] = String(c._id);
    for (const a of c?.aliases || []) {
      if (a) map[a.toLowerCase().trim()] = String(c._id);
    }
  }
  return map;
};

const processScene = async ({ novel, userId, sceneDoc, uc, characterLookup, openaiKey, dryRun }) => {
  const sceneRef = {
    actNumber: uc.actNumber,
    sceneIndex: uc.sceneIndex,
    promptKey: uc.promptKey,
  };
  const rawText = sceneDoc?.responseText || "";
  if (!rawText.trim()) {
    return { skipped: true, reason: "empty-scene" };
  }

  if (dryRun) {
    console.log(
      `[dry-run] novel ${novel._id} ${sceneRef.promptKey} (A${sceneRef.actNumber}/S${sceneRef.sceneIndex}) — ${rawText.length} chars`
    );
    return { skipped: true, reason: "dry-run" };
  }

  // Sequential within a scene — the four workers share the same source
  // text and we want predictable token usage per scene; parallel cross-
  // scene concurrency is handled by the outer loop.
  await summarizeScene({
    novelId: novel._id,
    userId,
    sceneRef,
    rawText,
    openaiKey,
  });
  await extractStateUpdates({
    novelId: novel._id,
    userId,
    rawText,
    characterLookup,
    sceneRef,
    openaiKey,
    source: "scene_close",
  });
  await extractEpisodicEvents({
    novelId: novel._id,
    userId,
    sceneRef,
    rawText,
    characterLookup,
    openaiKey,
  });
  await updateRelationshipEdges({
    novelId: novel._id,
    userId,
    sceneRef,
    rawText,
    characterLookup,
    openaiKey,
  });

  return { ok: true };
};

const isCurrent = (memory, toVersion) =>
  memory && memory.memoryVersion >= (toVersion ?? MEMORY_SCHEMA_VERSION);

const processNovel = async ({ novel, openaiKey, args }) => {
  const userId = novel.user;
  const characters = await Character.find({ novel: novel._id })
    .select("_id name aliases")
    .lean();
  const characterLookup = buildCharacterLookup(characters);

  const [userContents, sceneDocs, existingMemories] = await Promise.all([
    UserContent.find({ novelId: novel._id, user: userId })
      .sort({ actNumber: 1, sceneIndex: 1 })
      .lean(),
    StoryResponse.find({ novel: novel._id, user: userId }).lean(),
    SceneMemory.find({ novelId: novel._id }).select("sceneRef memoryVersion").lean(),
  ]);

  const memoryByPromptKey = new Map(
    existingMemories.map((m) => [
      `${m.sceneRef?.actNumber}/${m.sceneRef?.sceneIndex}`,
      m,
    ])
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const uc of userContents) {
    if (!uc?.actNumber || !uc?.sceneIndex || !uc?.promptKey) continue;
    const sceneDoc = sceneDocs.find((s) => s.promptKey === uc.promptKey);
    if (!sceneDoc?.responseText?.trim()) {
      skipped++;
      continue;
    }

    // Version gating: only process when target row's `memoryVersion`
    // is below `--to-version` (or always when no version flags).
    const memKey = `${uc.actNumber}/${uc.sceneIndex}`;
    const existing = memoryByPromptKey.get(memKey);
    if (args.toVersion && isCurrent(existing, args.toVersion)) {
      skipped++;
      continue;
    }
    if (args.fromVersion && existing && existing.memoryVersion !== args.fromVersion) {
      skipped++;
      continue;
    }

    try {
      const result = await processScene({
        novel,
        userId,
        sceneDoc,
        uc,
        characterLookup,
        openaiKey,
        dryRun: args.dryRun,
      });
      if (result?.ok) processed++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error(
        `[backfill] novel ${novel._id} scene ${uc.promptKey} failed:`,
        err?.message || err
      );
    }
  }

  return { processed, skipped, failed, total: userContents.length };
};

async function main() {
  const args = parseArgs();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Load storygroove-be/.env or export MONGO_URI.");
    process.exit(1);
  }
  const opts = process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {};
  await mongoose.connect(uri, opts);

  const openaiKey = args.dryRun ? "dry-run" : await resolveOpenAIKey();
  if (!args.dryRun && !openaiKey) {
    console.error("No OpenAI key available (set OPENAI_API_KEY or seed SimoneConfig).");
    await mongoose.disconnect();
    process.exit(2);
  }

  const novelFilter = {};
  if (args.novelId) novelFilter._id = args.novelId;
  if (args.userId) novelFilter.user = args.userId;

  const novels = await Novel.find(novelFilter).select("_id name user").lean();
  console.log(
    `[backfill] processing ${novels.length} novels (concurrency=${args.concurrency}, dryRun=${args.dryRun})`
  );

  const summary = { novels: 0, processed: 0, skipped: 0, failed: 0 };

  // Process novels in small batches to bound concurrency without
  // pulling in a queue dependency.
  for (let i = 0; i < novels.length; i += args.concurrency) {
    const batch = novels.slice(i, i + args.concurrency);
    const results = await Promise.allSettled(
      batch.map((n) => processNovel({ novel: n, openaiKey, args }))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        summary.novels++;
        summary.processed += r.value.processed;
        summary.skipped += r.value.skipped;
        summary.failed += r.value.failed;
      } else {
        console.error("[backfill] novel batch entry rejected:", r.reason?.message || r.reason);
      }
    }
    console.log(
      `[backfill] progress ${Math.min(i + args.concurrency, novels.length)}/${novels.length} — processed=${summary.processed} skipped=${summary.skipped} failed=${summary.failed}`
    );
  }

  console.log("[backfill] done:", summary);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[backfill] fatal:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
