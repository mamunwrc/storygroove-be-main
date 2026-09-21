/**
 * OpenAI Responses API tools for Ellis chat.
 * Which chapter body to load is Ellis's call, not regex on the writer message.
 */

export const ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME = "load_manuscript_chapters";

export const ELLIS_LOAD_MANUSCRIPT_CHAPTERS_TOOL = {
  type: "function",
  name: ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME,
  description:
    "Load full manuscript text for map chapters the writer meant whose bodies are not already in this turn. Copy chapterId from the MANUSCRIPT MAP row you decided they named — including a short or partial form of a custom title. Skip ids already attached. Do not invent prose.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      chapterIds: {
        type: "array",
        items: { type: "string" },
        description:
          "chapterId values copied from MANUSCRIPT MAP rows the writer referred to.",
      },
    },
    required: ["chapterIds"],
  },
  strict: true,
};

export function buildEllisResponsesTools() {
  return [ELLIS_LOAD_MANUSCRIPT_CHAPTERS_TOOL];
}
