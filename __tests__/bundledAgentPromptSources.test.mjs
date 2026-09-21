import test from "node:test";
import assert from "node:assert/strict";

import {
  BUNDLED_AGENT_PROMPT_FILES,
  readBundledAgentPrompt,
} from "../utils/bundledAgentPromptSources.js";

test("bundled cover prompts exist and meet min length", () => {
  for (const agentName of Object.keys(BUNDLED_AGENT_PROMPT_FILES)) {
    const prompt = readBundledAgentPrompt(agentName);
    assert.ok(prompt, `${agentName} should load from seed/cover-prompts`);
    assert.ok(prompt.length >= 80, `${agentName} prompt too short`);
  }
  assert.match(readBundledAgentPrompt("cover_studio"), /Cover Studio/);
  assert.match(readBundledAgentPrompt("cover_image_concept"), /imagePrompt/);
});
