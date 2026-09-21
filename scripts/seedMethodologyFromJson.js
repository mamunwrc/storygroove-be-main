/**
 * Phase 1.5A seed script — methodology JSON → Mongo.
 *
 * Reads `seed/olivia-methodology/{methodology-rules,prompt-templates,
 * genre-overlays}.json` and upserts each row by its natural key into
 * the matching collection. Idempotent — re-runs only mutate rows
 * whose content has actually changed.
 *
 * Flags (all optional):
 *   --dry-run               Show diff but write nothing.
 *   --only=<rules|templates|overlays|all>   Default: all.
 *   --bump-version          Stamp every upserted row with the current
 *                           `METHODOLOGY_VERSION` constant even if the
 *                           content is unchanged. Use this after a
 *                           breaking schema or copy edit.
 *   --apply-agentprompt-slim  Seed AgentPrompt: olivia-editor.txt → olivia_editor,
 *                           olivia-scene.txt → olivia_scenes; other agents from
 *                           agent-prompts/*.slim.md (e.g. olivia_coaching).
 *   --audit-constants       Fail if MethodologyRule text duplicates UI constants.
 *
 * Usage:
 *   node storygroove-be/scripts/seedMethodologyFromJson.js
 *   node storygroove-be/scripts/seedMethodologyFromJson.js --apply-agentprompt-slim
 *   node storygroove-be/scripts/seedMethodologyFromJson.js --dry-run --only=rules
 *
 * Requires: MONGO_URI env var.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";

import MethodologyRule from "../models/methodologyRuleModel.js";
import PromptTemplate from "../models/promptTemplateModel.js";
import GenreOverlay from "../models/genreOverlayModel.js";
import AgentPrompt from "../models/agentPromptModel.js";
import { METHODOLOGY_VERSION, MEMORY_SCHEMA_VERSION } from "../constants/models.js";
import {
  invalidateMethodologyCache,
  auditAgainstCodeConstants,
} from "../service/methodologyService.js";
import {
  RULE_FIELDS,
  TEMPLATE_FIELDS,
  OVERLAY_FIELDS,
  equalIgnoringMeta,
} from "../utils/methodologyBundle.js";
import {
  OLIVIA_LAYERING_AFTER_TABLE_REMINDER,
  OLIVIA_SCENE_POST_SCENE_CTA,
} from "../constants/oliviaUiMessages.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_DIR = path.resolve(__dirname, "..", "seed", "olivia-methodology");
/** Monorepo root — `olivia-editor.txt` / `olivia-scene.txt` live here. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Authoritative AgentPrompt bodies from repo-root `.txt` files (not slim).
 * Keys are Mongo `agentName` values.
 */
const AGENT_PROMPT_TXT_SOURCES = {
  olivia_editor: path.join(REPO_ROOT, "olivia-editor.txt"),
  olivia_scenes: path.join(REPO_ROOT, "olivia-scene.txt"),
  olivia_coaching: path.join(REPO_ROOT, "olivia-coaching.txt"),
};

const parseArgs = () => {
  const out = {
    dryRun: false,
    only: "all",
    bumpVersion: false,
    auditConstants: false,
    applyAgentPromptSlim: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--bump-version") out.bumpVersion = true;
    else if (arg === "--audit-constants") out.auditConstants = true;
    else if (arg === "--apply-agentprompt-slim") out.applyAgentPromptSlim = true;
    else if (arg.startsWith("--only=")) out.only = arg.slice(7);
  }
  if (!["all", "rules", "templates", "overlays"].includes(out.only)) {
    console.error(`--only must be one of: all, rules, templates, overlays`);
    process.exit(1);
  }
  return out;
};

const readJson = (filename) => {
  const p = path.join(SEED_DIR, filename);
  if (!fs.existsSync(p)) throw new Error(`Seed file missing: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

const upsertOne = async ({ Model, filter, doc, dryRun, bumpVersion, compareKeys }) => {
  const existing = await Model.findOne(filter).lean();
  const next = {
    ...doc,
    methodologyVersion: METHODOLOGY_VERSION,
    memoryVersion: MEMORY_SCHEMA_VERSION,
  };
  if (!existing) {
    if (!dryRun) await Model.create(next);
    return "added";
  }
  const same = equalIgnoringMeta(existing, next, compareKeys);
  const versionDrift =
    bumpVersion ||
    existing.methodologyVersion !== METHODOLOGY_VERSION ||
    existing.memoryVersion !== MEMORY_SCHEMA_VERSION;
  if (same && !versionDrift) return "unchanged";
  if (!dryRun) await Model.updateOne(filter, { $set: next });
  return "updated";
};

const seedRules = async ({ dryRun, bumpVersion }) => {
  const rows = readJson("methodology-rules.json");
  const compareKeys = RULE_FIELDS;
  const tally = { added: 0, updated: 0, unchanged: 0 };
  for (const row of rows) {
    if (!row.key) {
      console.warn("[seed] skipping rule without `key`:", row);
      continue;
    }
    const status = await upsertOne({
      Model: MethodologyRule,
      filter: { key: row.key },
      doc: row,
      dryRun,
      bumpVersion,
      compareKeys,
    });
    tally[status]++;
  }
  return tally;
};

const seedTemplates = async ({ dryRun, bumpVersion }) => {
  const rows = readJson("prompt-templates.json");
  const compareKeys = TEMPLATE_FIELDS;
  const tally = { added: 0, updated: 0, unchanged: 0 };
  for (const row of rows) {
    if (typeof row.sceneIndex !== "number") {
      console.warn("[seed] skipping template without `sceneIndex`:", row.key);
      continue;
    }
    const status = await upsertOne({
      Model: PromptTemplate,
      filter: { sceneIndex: row.sceneIndex },
      doc: row,
      dryRun,
      bumpVersion,
      compareKeys,
    });
    tally[status]++;
  }
  return tally;
};

const seedOverlays = async ({ dryRun, bumpVersion }) => {
  const rows = readJson("genre-overlays.json");
  const compareKeys = OVERLAY_FIELDS;
  const tally = { added: 0, updated: 0, unchanged: 0 };
  for (const row of rows) {
    if (!row.genreKey) {
      console.warn("[seed] skipping overlay without `genreKey`:", row);
      continue;
    }
    const status = await upsertOne({
      Model: GenreOverlay,
      filter: { genreKey: row.genreKey },
      doc: row,
      dryRun,
      bumpVersion,
      compareKeys,
    });
    tally[status]++;
  }
  return tally;
};

/**
 * Phase 1.5B audit — flag any MethodologyRule row whose text overlaps
 * with the parsing-sensitive constants we keep in code. Catches the
 * "I migrated this rule but forgot to delete the constants copy" bug.
 */
const auditConstants = async () => {
  const result = await auditAgainstCodeConstants({
    codeBlocks: [OLIVIA_LAYERING_AFTER_TABLE_REMINDER, OLIVIA_SCENE_POST_SCENE_CTA],
    minOverlap: 80,
  });
  if (result.collisions.length === 0) {
    console.log("[seed] audit: no MethodologyRule overlaps with kept code constants");
    return;
  }
  console.error(
    "[seed] audit: FOUND OVERLAPS — these rules duplicate parsing-sensitive constants. Trim the rule text or move the constant fully into Mongo:"
  );
  for (const c of result.collisions) {
    console.error(`  - rule.key=${c.ruleKey}  code-hint="${c.codeBlockHint}"`);
  }
  process.exitCode = 3;
};

/** Human labels for admin UI — keep in sync with assistantController REQUIRED_AGENT_PROMPTS. */
const AGENT_PROMPT_DESCRIPTIONS = {
  simone: "Simone — AI writing assistant",
  ellis: "Ellis — Scene-level feedback & review",
  olivia: "Olivia — AI book coaching assistant",
  olivia_editor: "Olivia — Scene layering & outline expansion",
  olivia_scenes: "Olivia — Scene-by-scene outlining & book coaching",
  olivia_coaching: "Olivia — Office 3 scene coaching (draft review)",
};

const upsertAgentPromptFromText = async ({
  agentName,
  promptText,
  sourceLabel,
  dryRun,
  tally,
}) => {
  const text = (promptText || "").trim();
  if (!text) {
    console.warn(`[seed] agentprompt: ${agentName} (${sourceLabel}) is empty; skipping`);
    tally.skipped++;
    return;
  }
  const row = await AgentPrompt.findOne({ agentName }).lean();
  if (!row) {
    const description =
      AGENT_PROMPT_DESCRIPTIONS[agentName] ||
      `Agent prompt for ${agentName.replace(/_/g, " ")}`;
    if (!dryRun) {
      await AgentPrompt.create({ agentName, prompt: text, description });
    }
    console.log(`[seed] agentprompt: ${agentName} — created from ${sourceLabel} (${text.length} chars)`);
    tally.created++;
    return;
  }
  if ((row.prompt || "").trim() === text) {
    tally.skipped++;
    return;
  }
  const backupMarker = `[AGENTPROMPT BACKUP @ ${new Date().toISOString()}]`;
  const newDescription = `${backupMarker}\n\n${row.prompt}`;
  if (!dryRun) {
    await AgentPrompt.updateOne(
      { _id: row._id },
      { $set: { prompt: text, description: newDescription } }
    );
  }
  console.log(
    `[seed] agentprompt: ${agentName} — updated from ${sourceLabel} (${row.prompt?.length || 0} → ${text.length} chars, prior prompt in description)`
  );
  tally.updated++;
};

/**
 * Seed AgentPrompt rows for admin + runtime.
 * - `olivia_editor` ← repo-root `olivia-editor.txt`
 * - `olivia_scenes` ← repo-root `olivia-scene.txt`
 * - Other agents ← `seed/olivia-methodology/agent-prompts/<name>.slim.md` only
 *   (e.g. `olivia_coaching`). Slim files for editor/scenes are ignored when .txt exists.
 */
const applyAgentPromptSeeds = async ({ dryRun }) => {
  const tally = { created: 0, updated: 0, skipped: 0 };

  for (const [agentName, filePath] of Object.entries(AGENT_PROMPT_TXT_SOURCES)) {
    if (!fs.existsSync(filePath)) {
      console.warn(`[seed] agentprompt: missing ${filePath} for ${agentName}`);
      continue;
    }
    const promptText = fs.readFileSync(filePath, "utf8");
    const sourceLabel = path.basename(filePath);
    await upsertAgentPromptFromText({
      agentName,
      promptText,
      sourceLabel,
      dryRun,
      tally,
    });
  }

  const slimDir = path.join(SEED_DIR, "agent-prompts");
  const txtAgentNames = new Set(Object.keys(AGENT_PROMPT_TXT_SOURCES));
  if (fs.existsSync(slimDir)) {
    const entries = fs
      .readdirSync(slimDir)
      .filter((f) => f.endsWith(".slim.md"));
    for (const entry of entries) {
      const agentName = entry.replace(/\.slim\.md$/, "");
      if (txtAgentNames.has(agentName)) {
        console.log(
          `[seed] agentprompt: ${agentName} — skipping ${entry} (using repo-root .txt)`
        );
        continue;
      }
      const promptText = fs.readFileSync(path.join(slimDir, entry), "utf8");
      await upsertAgentPromptFromText({
        agentName,
        promptText,
        sourceLabel: entry,
        dryRun,
        tally,
      });
    }
  }

  console.log(
    `[seed] agentprompt: ${tally.created} created, ${tally.updated} updated, ${tally.skipped} unchanged`
  );
};

const main = async () => {
  const args = parseArgs();
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Load storygroove-be/.env or export MONGO_URI.");
    process.exit(1);
  }
  const mongoOpts = process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {};
  await mongoose.connect(uri, mongoOpts);
  console.log(
    `[seed] connected. methodologyVersion=${METHODOLOGY_VERSION} memoryVersion=${MEMORY_SCHEMA_VERSION} ` +
      `only=${args.only} dryRun=${args.dryRun} bumpVersion=${args.bumpVersion}`
  );

  try {
    if (args.only === "all" || args.only === "rules") {
      const t = await seedRules(args);
      console.log(
        `[seed] methodology-rules: +${t.added} ~${t.updated} =${t.unchanged}`
      );
    }
    if (args.only === "all" || args.only === "templates") {
      const t = await seedTemplates(args);
      console.log(
        `[seed] prompt-templates: +${t.added} ~${t.updated} =${t.unchanged}`
      );
    }
    if (args.only === "all" || args.only === "overlays") {
      const t = await seedOverlays(args);
      console.log(`[seed] genre-overlays: +${t.added} ~${t.updated} =${t.unchanged}`);
    }
    if (args.auditConstants) {
      await auditConstants();
    }
    if (args.applyAgentPromptSlim) {
      await applyAgentPromptSeeds({ dryRun: args.dryRun });
    }
    if (!args.dryRun) invalidateMethodologyCache();
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
