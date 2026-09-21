/**
 * Phase 1.5C — A/B harness for the methodology integration.
 *
 * For a single (novel, userMessage, targetScene) input, builds the
 * assembled `instructions` + `memoryBlockMessage` twice:
 *
 *   (a) `legacy`   — methodology service forced to return an empty
 *                    block; the assembler falls back to the
 *                    AgentPrompt-only path.
 *   (b) `methodology` — full methodology block injected.
 *
 * Writes a side-by-side markdown diff to disk (token counts, the two
 * full `instructions` strings, the two `memoryBlockMessage` strings,
 * and the diff of section markers). Use this on staging before
 * flipping `OLIVIA_METHODOLOGY_V2=1` in production.
 *
 * Optionally calls `openai.responses.create` (non-streaming) for both
 * variants so the model's actual response can be eyeballed for
 * regression — guarded behind `--with-llm-call` since each comparison
 * burns ~2 chat-completion calls' worth of tokens.
 *
 * Usage:
 *   node storygroove-be/scripts/oliviaMethodologyAbHarness.js \
 *     --novel-id=<id> \
 *     --user-message="Help me layer scene 5" \
 *     --target-scene=5 \
 *     --out=./tmp/olivia-ab.md \
 *     [--with-llm-call] [--model=gpt-4o-mini]
 *
 * Requires: MONGO_URI; OPENAI_API_KEY only with `--with-llm-call`.
 */

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import dotenv from "dotenv";

import Novel from "../models/novelModel.js";
import StoryState from "../models/storyStateModel.js";
import { assembleOliviaContext, invalidateAssemblerCache } from "../service/contextAssembler.js";
import {
  getMethodologyBlock as realGetMethodologyBlock,
  invalidateMethodologyCache,
} from "../service/methodologyService.js";
import * as methodologyServiceModule from "../service/methodologyService.js";
import { OLIVIA_MODEL } from "../constants/models.js";

dotenv.config();

const parseArgs = () => {
  const out = {
    novelId: null,
    userMessage: "What's the best way to layer in the next scene?",
    targetScene: null,
    outPath: "./tmp/olivia-methodology-ab.md",
    withLlmCall: false,
    model: OLIVIA_MODEL,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--with-llm-call") out.withLlmCall = true;
    else if (arg.startsWith("--novel-id=")) out.novelId = arg.slice(11);
    else if (arg.startsWith("--user-message=")) out.userMessage = arg.slice(15);
    else if (arg.startsWith("--target-scene=")) {
      const n = Number(arg.slice(15));
      out.targetScene = Number.isFinite(n) ? n : null;
    } else if (arg.startsWith("--out=")) out.outPath = arg.slice(6);
    else if (arg.startsWith("--model=")) out.model = arg.slice(8);
  }
  return out;
};

const tokenEstimate = (s) => Math.ceil((s?.length || 0) / 4);

/**
 * Force the methodology service to return an empty block for the
 * "legacy" leg of the A/B. We do this by patching the module export
 * before calling the assembler.
 */
const withMethodologyDisabled = async (fn) => {
  const orig = methodologyServiceModule.getMethodologyBlock;
  // ESM exports are read-only from the importer's side, but the
  // module record itself is mutable. We swap the binding on the
  // module namespace object.
  Object.defineProperty(methodologyServiceModule, "getMethodologyBlock", {
    value: async () => ({ block: "", tokenEstimate: 0, sourcesUsed: [] }),
    configurable: true,
    writable: true,
  });
  invalidateMethodologyCache();
  invalidateAssemblerCache();
  try {
    return await fn();
  } finally {
    Object.defineProperty(methodologyServiceModule, "getMethodologyBlock", {
      value: orig,
      configurable: true,
      writable: true,
    });
    invalidateMethodologyCache();
    invalidateAssemblerCache();
  }
};

const runLlmCall = async ({ instructions, memoryBlockMessage, userMessage, model }) => {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = [];
  if (memoryBlockMessage) input.push(memoryBlockMessage);
  input.push({ role: "user", content: userMessage });
  const response = await openai.responses.create({
    model,
    instructions,
    input,
    temperature: 0.3,
    stream: false,
  });
  const outputText = response.output
    ?.flatMap((o) => o?.content || [])
    ?.map((c) => c?.text || "")
    ?.filter(Boolean)
    ?.join("\n")
    || "(no output)";
  return {
    outputText,
    usage: response.usage || null,
  };
};

const main = async () => {
  const args = parseArgs();
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  if (args.withLlmCall && !process.env.OPENAI_API_KEY) {
    console.error("--with-llm-call requires OPENAI_API_KEY");
    process.exit(1);
  }
  await mongoose.connect(
    process.env.MONGO_URI,
    process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {}
  );

  try {
    const novel = args.novelId
      ? await Novel.findById(args.novelId).lean()
      : await Novel.findOne().sort({ updatedAt: -1 }).lean();
    if (!novel) {
      console.error("No novel found.");
      process.exit(2);
    }
    const userId = String(novel.user);
    const novelId = String(novel._id);
    const targetScene = args.targetScene
      ? { actNumber: Math.ceil(args.targetScene / 5), sceneIndex: args.targetScene }
      : null;

    // Make sure the StoryState row exists so the phase rules can be
    // resolved deterministically.
    const storyState =
      (await StoryState.findOne({ novelId }).lean()) || { layeringPhase: "outlining" };

    console.log(
      `[ab] novel=${novel.name || novelId} phase=${storyState.layeringPhase} sceneIndex=${args.targetScene ?? "—"}`
    );

    // Leg A — legacy (methodology disabled)
    const legacy = await withMethodologyDisabled(async () => {
      return assembleOliviaContext({
        novel,
        novelId,
        userId,
        mode: targetScene ? "scene" : "editor",
        targetScene,
        userMessage: args.userMessage,
      });
    });

    // Leg B — methodology enabled
    invalidateAssemblerCache();
    invalidateMethodologyCache();
    const methodology = await assembleOliviaContext({
      novel,
      novelId,
      userId,
      mode: targetScene ? "scene" : "editor",
      targetScene,
      userMessage: args.userMessage,
    });

    let legacyLlm = null;
    let methodologyLlm = null;
    if (args.withLlmCall) {
      console.log("[ab] running legacy LLM call …");
      legacyLlm = await runLlmCall({
        instructions: legacy.instructions,
        memoryBlockMessage: legacy.memoryBlockMessage,
        userMessage: args.userMessage,
        model: args.model,
      });
      console.log("[ab] running methodology LLM call …");
      methodologyLlm = await runLlmCall({
        instructions: methodology.instructions,
        memoryBlockMessage: methodology.memoryBlockMessage,
        userMessage: args.userMessage,
        model: args.model,
      });
    }

    const outPath = path.resolve(process.cwd(), args.outPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const out = renderReport({
      novel,
      storyState,
      args,
      legacy,
      methodology,
      legacyLlm,
      methodologyLlm,
    });
    fs.writeFileSync(outPath, out);
    console.log(`[ab] report written: ${outPath}`);
  } finally {
    await mongoose.disconnect();
  }
};

const renderReport = ({
  novel,
  storyState,
  args,
  legacy,
  methodology,
  legacyLlm,
  methodologyLlm,
}) => {
  const lines = [];
  lines.push(`# Olivia Methodology A/B Report`);
  lines.push("");
  lines.push(`- novel: \`${novel.name || novel._id}\` (${novel._id})`);
  lines.push(`- genre: ${novel.genre || "(unset)"}`);
  lines.push(`- layeringPhase: ${storyState.layeringPhase}`);
  lines.push(`- targetScene: ${args.targetScene ?? "(none)"}`);
  lines.push(`- userMessage: \`${args.userMessage}\``);
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Token sizes`);
  lines.push("");
  lines.push(`| Leg | instructions chars | instructions ≈tokens | memoryBlockMessage chars | demoted sections |`);
  lines.push(`| --- | ---: | ---: | ---: | --- |`);
  lines.push(
    `| legacy | ${legacy.instructions?.length || 0} | ${tokenEstimate(legacy.instructions)} | ${memBlockChars(legacy.memoryBlockMessage)} | ${(legacy.demoted || []).join(", ") || "—"} |`
  );
  lines.push(
    `| methodology | ${methodology.instructions?.length || 0} | ${tokenEstimate(methodology.instructions)} | ${memBlockChars(methodology.memoryBlockMessage)} | ${(methodology.demoted || []).join(", ") || "—"} |`
  );
  lines.push("");

  lines.push(`## Sections present in \`instructions\``);
  lines.push("");
  lines.push(`| Marker | legacy | methodology |`);
  lines.push(`| --- | :---: | :---: |`);
  const markers = [
    "## OLIVIA METHODOLOGY",
    "### Craft Rules",
    "### Scene Template",
    "### Genre Overlay",
    "STORY_GROOVE_LAYERING_RUNTIME_RULES",
  ];
  for (const m of markers) {
    lines.push(
      `| \`${m}\` | ${legacy.instructions?.includes(m) ? "✓" : ""} | ${methodology.instructions?.includes(m) ? "✓" : ""} |`
    );
  }
  lines.push("");

  lines.push(`## Legacy instructions`);
  lines.push("");
  lines.push("```text");
  lines.push(legacy.instructions || "");
  lines.push("```");
  lines.push("");

  lines.push(`## Methodology instructions`);
  lines.push("");
  lines.push("```text");
  lines.push(methodology.instructions || "");
  lines.push("```");
  lines.push("");

  if (legacyLlm || methodologyLlm) {
    lines.push(`## LLM output comparison`);
    lines.push("");
    if (legacyLlm) {
      lines.push(`### Legacy output`);
      lines.push("```");
      lines.push(legacyLlm.outputText);
      lines.push("```");
      if (legacyLlm.usage) lines.push(`Usage: ${JSON.stringify(legacyLlm.usage)}`);
      lines.push("");
    }
    if (methodologyLlm) {
      lines.push(`### Methodology output`);
      lines.push("```");
      lines.push(methodologyLlm.outputText);
      lines.push("```");
      if (methodologyLlm.usage) lines.push(`Usage: ${JSON.stringify(methodologyLlm.usage)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
};

const memBlockChars = (msg) => {
  if (!msg) return 0;
  if (typeof msg === "string") return msg.length;
  if (typeof msg.content === "string") return msg.content.length;
  return JSON.stringify(msg).length;
};

main().catch((err) => {
  console.error("[ab] failed:", err);
  process.exit(1);
});
