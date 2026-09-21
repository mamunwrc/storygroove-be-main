/**
 * One-time seed of Cover Studio AgentPrompt documents from bundled files:
 *   - cover_studio        ← seed/cover-prompts/cover-studio-chat.txt
 *   - cover_image_concept ← seed/cover-prompts/cover-image-concept.txt
 *
 * Default: insert only if the agentName is missing. Existing rows are left
 * alone so Agent Prompts dashboard edits are not overwritten.
 *
 * Usage (from storygroove-be):
 *   node scripts/syncCoverAgentPromptsFromRepo.mjs
 *   node scripts/syncCoverAgentPromptsFromRepo.mjs --force   # overwrite from files
 *
 * Requires: MONGO_URI, and MONGODB_NAME if your cluster uses a non-default DB name.
 */

import "dotenv/config";
import mongoose from "mongoose";
import AgentPrompt from "../models/agentPromptModel.js";
import {
  BUNDLED_AGENT_PROMPT_DESCRIPTIONS,
  BUNDLED_AGENT_PROMPT_FILES,
  readBundledAgentPrompt,
} from "../utils/bundledAgentPromptSources.js";

async function main() {
  const force = process.argv.includes("--force");
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Load storygroove-be/.env or export MONGO_URI.");
    process.exit(1);
  }

  const opts = process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {};
  await mongoose.connect(uri, opts);

  for (const agentName of Object.keys(BUNDLED_AGENT_PROMPT_FILES)) {
    const prompt = readBundledAgentPrompt(agentName);
    if (!prompt) {
      throw new Error(
        `Missing bundled prompt for ${agentName}: ${BUNDLED_AGENT_PROMPT_FILES[agentName]}`
      );
    }

    const existing = await AgentPrompt.findOne({ agentName }).lean();
    if (existing && !force) {
      console.log(
        `AgentPrompt ${agentName}: already exists (${existing.prompt?.length || 0} chars) — skipped. Use --force to overwrite from file.`
      );
      continue;
    }

    const doc = await AgentPrompt.findOneAndUpdate(
      { agentName },
      {
        agentName,
        prompt,
        description: BUNDLED_AGENT_PROMPT_DESCRIPTIONS[agentName],
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    console.log(
      `AgentPrompt ${agentName}: ${existing ? "overwritten" : "created"} from bundled file, prompt length ${doc.prompt.length}`
    );
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
