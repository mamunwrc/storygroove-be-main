import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVER_DIR = path.join(__dirname, "../seed/cover-prompts");

export const BUNDLED_AGENT_PROMPT_FILES = {
  cover_studio: path.join(COVER_DIR, "cover-studio-chat.txt"),
  cover_image_concept: path.join(COVER_DIR, "cover-image-concept.txt"),
};

export const BUNDLED_AGENT_PROMPT_DESCRIPTIONS = {
  cover_studio:
    "Cover Studio — conversational cover direction and generation offers",
  cover_image_concept:
    "Cover Studio — image concept JSON pipeline (server-only, not shown in chat)",
};

/** Read a prompt shipped with the backend repo, or null if missing/too short. */
export const readBundledAgentPrompt = (agentName) => {
  const filePath = BUNDLED_AGENT_PROMPT_FILES[agentName];
  if (!filePath || !fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text.length >= 80 ? text : null;
};
