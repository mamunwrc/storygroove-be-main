import AgentPrompt from "../models/agentPromptModel.js";

/**
 * Load an agent prompt from the AgentPrompt collection.
 * Prompts are seeded once (Agent Prompts page or sync script) then edited
 * manually. File changes in the repo do not update existing documents.
 *
 * OPS (Ellis): Keep agentName `ellis_scene_architect` synced with repo
 * `ellis-scene-architect-v3.txt` after prompt edits. File changes alone do not
 * update production — paste/update via the Agent Prompts dashboard or seed.
 */
export const loadAgentPromptFromDb = async (
  agentName,
  { minLength = 80 } = {}
) => {
  const promptDoc = await AgentPrompt.findOne({ agentName }).lean();
  const prompt = String(promptDoc?.prompt || "").trim();
  if (prompt.length < minLength) {
    const err = new Error(
      `Agent prompt "${agentName}" is not configured. Set it in Agent Prompts.`
    );
    err.statusCode = 503;
    throw err;
  }
  return prompt;
};
