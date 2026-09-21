/**
 * Upserts MongoDB AgentPrompt documents for Olivia agents from repo sources:
 *   - olivia_scenes  ← repo-root olivia-scene.txt
 *   - olivia_editor  ← repo-root olivia-editor.txt
 *   - olivia_coaching ← repo-root olivia-coaching.txt
 *
 * Usage (from storygroove-be): node scripts/syncOliviaAgentPromptsFromRepo.mjs
 * Requires: MONGO_URI, and MONGODB_NAME if your cluster uses a non-default DB name (same as config/db.js).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import AgentPrompt from "../models/agentPromptModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const DESCRIPTIONS = {
  olivia_scenes: "Olivia — Scene-by-scene outlining & book coaching",
  olivia_editor: "Olivia — Scene layering & outline expansion",
  olivia_coaching: "Olivia — Office 3 scene coaching (draft review)",
};

const readUtf8 = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) {
    throw new Error(`Empty ${label}: ${filePath}`);
  }
  return text;
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Load storygroove-be/.env or export MONGO_URI.");
    process.exit(1);
  }

  const opts = process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {};
  await mongoose.connect(uri, opts);

  const pairs = [
    {
      agentName: "olivia_scenes",
      prompt: readUtf8(path.join(repoRoot, "olivia-scene.txt"), "olivia-scene.txt"),
    },
    {
      agentName: "olivia_editor",
      prompt: readUtf8(path.join(repoRoot, "olivia-editor.txt"), "olivia-editor.txt"),
    },
    {
      agentName: "olivia_coaching",
      prompt: readUtf8(path.join(repoRoot, "olivia-coaching.txt"), "olivia-coaching.txt"),
    },
  ];

  for (const { agentName, prompt } of pairs) {
    const doc = await AgentPrompt.findOneAndUpdate(
      { agentName },
      {
        agentName,
        prompt,
        description: DESCRIPTIONS[agentName],
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    console.log(
      `AgentPrompt ${agentName}: upserted, prompt length ${doc.prompt.length}`
    );
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
