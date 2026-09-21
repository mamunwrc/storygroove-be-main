/**
 * Agent prompt export/import bundle helpers.
 */

export const BUNDLE_FORMAT_VERSION = 1;

export const PROMPT_FIELDS = ["agentName", "prompt", "description"];

export const normalizeAgentNameForBundle = (agentName = "") =>
  String(agentName || "")
    .trim()
    .toLowerCase() || "";

export const normalizePromptText = (text = "") =>
  String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

export const pickFields = (row, fields) => {
  const out = {};
  for (const k of fields) {
    if (row?.[k] !== undefined) out[k] = row[k];
  }
  return out;
};

export const stripRowForExport = (row) => {
  const picked = pickFields(row, PROMPT_FIELDS);
  picked.agentName = normalizeAgentNameForBundle(picked.agentName);
  return picked;
};

export const equalIgnoringMeta = (existing, next) => {
  const a = {
    prompt: normalizePromptText(existing?.prompt),
    description: existing?.description ?? "",
  };
  const b = {
    prompt: normalizePromptText(next?.prompt),
    description: next?.description ?? "",
  };
  return a.prompt === b.prompt && a.description === b.description;
};

export const normalizeImportBundle = (body) => {
  if (Array.isArray(body)) {
    return { prompts: body };
  }
  if (!body || typeof body !== "object") {
    throw new Error("Import body must be a JSON object or array");
  }
  if (Array.isArray(body.prompts)) {
    return { prompts: body.prompts };
  }
  if (Array.isArray(body.agentPrompts)) {
    return { prompts: body.agentPrompts };
  }
  throw new Error(
    'Import body must include a "prompts" or "agentPrompts" array, or be a raw array'
  );
};

export const validatePromptRow = (row, index) => {
  const errors = [];
  if (!row || typeof row !== "object") {
    return [`prompts[${index}]: must be an object`];
  }
  const agentName = normalizeAgentNameForBundle(row.agentName);
  if (!agentName) {
    errors.push(`prompts[${index}]: agentName is required`);
  }
  const prompt = row.prompt;
  if (prompt === undefined || prompt === null || String(prompt).trim() === "") {
    errors.push(`prompts[${index}]: prompt is required`);
  }
  return errors;
};

export const preparePromptDoc = (row) => ({
  agentName: normalizeAgentNameForBundle(row.agentName),
  prompt: normalizePromptText(row.prompt),
  description:
    row.description === undefined || row.description === null
      ? ""
      : String(row.description),
});
