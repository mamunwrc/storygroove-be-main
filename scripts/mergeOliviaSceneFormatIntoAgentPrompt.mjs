/**
 * One-time migration (Phase 1, todo `phase1-prompt-relocation`):
 *
 * Append the OLIVIA_SCENE_FORMAT_RULE constant onto the `olivia_scenes`
 * AgentPrompt row so the controller no longer has to inline it. The
 * controller already skips the inline append when the AgentPrompt
 * `prompt` field already contains "SCENE FORMAT RULE (MANDATORY):",
 * so this script is the trigger that switches the source of truth from
 * code → DB.
 *
 * Idempotent:
 *   - Skips the merge when the rule string is already present in the prompt.
 *   - Safe to re-run.
 *
 * Usage (from storygroove-be):
 *   node scripts/mergeOliviaSceneFormatIntoAgentPrompt.mjs
 *   node scripts/mergeOliviaSceneFormatIntoAgentPrompt.mjs --dry-run
 *
 * Requires: MONGO_URI (and MONGODB_NAME if your cluster uses a
 * non-default DB name).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import AgentPrompt from '../models/agentPromptModel.js';
import { OLIVIA_SCENE_FORMAT_RULE } from '../constants/oliviaUiMessages.js';

const MARKER = 'SCENE FORMAT RULE (MANDATORY):';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(
      'MONGO_URI is not set. Load storygroove-be/.env or export MONGO_URI.'
    );
    process.exit(1);
  }

  const opts = process.env.MONGODB_NAME ? { dbName: process.env.MONGODB_NAME } : {};
  await mongoose.connect(uri, opts);

  const row = await AgentPrompt.findOne({ agentName: 'olivia_scenes' });
  if (!row) {
    console.error(
      'AgentPrompt row "olivia_scenes" not found. Run syncOliviaAgentPromptsFromRepo.mjs first.'
    );
    await mongoose.disconnect();
    process.exit(2);
  }

  if ((row.prompt || '').includes(MARKER)) {
    console.log(
      'olivia_scenes already contains SCENE FORMAT RULE — nothing to merge.'
    );
    await mongoose.disconnect();
    return;
  }

  const merged = `${(row.prompt || '').trimEnd()}\n\n${OLIVIA_SCENE_FORMAT_RULE}\n`;

  console.log(
    `[merge] olivia_scenes: prompt length ${row.prompt?.length || 0} → ${merged.length}`
  );

  if (dryRun) {
    console.log('--dry-run: not writing to DB.');
  } else {
    row.prompt = merged;
    await row.save();
    console.log('olivia_scenes updated.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
