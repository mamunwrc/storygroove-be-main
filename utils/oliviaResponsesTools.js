/**
 * Build OpenAI Responses API tool list for Olivia editor / scene flows.
 *
 * Accepts `vectorStoreId` (single store) OR `vectorStoreIds` (array).
 * IDs are de-duplicated; when any are present, a `file_search` tool is
 * added for per-novel scene attachment memory (`novel.oliviaSceneMemoryVectorStoreId`).
 * Olivia craft rules come from methodology text in instructions, not vector search.
 *
 * @param {{
 *   webSearch?: boolean;
 *   vectorStoreId?: string | null;
 *   vectorStoreIds?: Array<string | null | undefined>;
 *   loadManuscriptScenes?: boolean;
 * }} opts
 */

export const OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME = "load_manuscript_scenes";

export const OLIVIA_LOAD_MANUSCRIPT_SCENES_TOOL = {
  type: "function",
  name: OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME,
  description:
    "Load Book Editor manuscript prose for this turn. Call when the writer wants pages beyond the open editor scene: read/assess/compare, 'what's written', 'those scenes', 'the placeholders', or a follow-up about scenes already discussed. Use DRAFT INDEX global numbers (or actNumbers 1-3, or wholeBook). Skip if MANUSCRIPT DRAFT PACK is already in this turn for those scenes. Do not call for outline/structure talk or casual 'full novel' craft discussion.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      wholeBook: { type: "boolean" },
      actNumbers: {
        type: "array",
        items: { type: "integer" },
      },
      globalSceneNumbers: {
        type: "array",
        items: { type: "integer" },
      },
    },
    required: ["wholeBook", "actNumbers", "globalSceneNumbers"],
  },
  strict: true,
};

export function buildOliviaResponsesTools({
  webSearch = false,
  vectorStoreId = null,
  vectorStoreIds = [],
  loadManuscriptScenes = false,
} = {}) {
  const tools = [];
  if (loadManuscriptScenes) {
    tools.push(OLIVIA_LOAD_MANUSCRIPT_SCENES_TOOL);
  }
  if (webSearch) {
    tools.push({ type: "web_search_preview" });
  }

  const ids = [
    ...(typeof vectorStoreId === "string" ? [vectorStoreId] : []),
    ...(Array.isArray(vectorStoreIds) ? vectorStoreIds : []),
  ]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const unique = Array.from(new Set(ids));
  if (unique.length) {
    tools.push({ type: "file_search", vector_store_ids: unique });
  }
  return tools;
}
