/**
 * Shared methodology export/import helpers.
 * Field lists align with `scripts/seedMethodologyFromJson.js`.
 */

export const BUNDLE_FORMAT_VERSION = 1;

export const RULE_FIELDS = [
  "key",
  "title",
  "scope",
  "phase",
  "priority",
  "source",
  "enabled",
  "summary",
  "text",
];

export const TEMPLATE_FIELDS = [
  "key",
  "sceneIndex",
  "actNumber",
  "title",
  "tentpoleHint",
  "source",
  "enabled",
  "outputFormatLabels",
  "template",
  "coachingPrompt",
  "subplotReminder",
];

export const OVERLAY_FIELDS = [
  "genreKey",
  "displayName",
  "category",
  "appliesAs",
  "aliases",
  "source",
  "enabled",
  "applicabilityNote",
  "beats",
  "notes",
];

const META_KEYS = new Set([
  "_id",
  "__v",
  "createdAt",
  "updatedAt",
  "methodologyVersion",
  "memoryVersion",
  "deletedAt",
]);

const RULE_SCOPES = ["universal", "phase"];
const LAYERING_PHASES = [
  "outlining",
  "phase1_table",
  "phase2_expansion",
  "coaching",
  "drafting",
];
const OVERLAY_APPLIES_AS = ["base_genre", "additional_overlay"];
const OVERLAY_CATEGORIES = [
  "romance",
  "mystery",
  "speculative",
  "realistic",
  "audience",
  "structural",
];
const TENTPOLE_HINTS = [
  "inciting_incident",
  "first_reversal",
  "midpoint",
  "dark_night",
  "climax",
  "resolution",
  null,
];

export const equalIgnoringMeta = (a, b, keys) => {
  for (const k of keys) {
    const va = a?.[k];
    const vb = b?.[k];
    if (typeof va === "object" || typeof vb === "object") {
      if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) return false;
    } else if (va !== vb) {
      return false;
    }
  }
  return true;
};

export const pickFields = (row, fields) => {
  const out = {};
  for (const k of fields) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
};

export const stripRowForExport = (row, fields) => {
  const picked = pickFields(row, fields);
  if (picked.phase === undefined || picked.phase === null) {
    picked.phase = Array.isArray(row?.phase) ? row.phase : [];
  }
  return picked;
};

const inferCollectionFromRow = (row) => {
  if (!row || typeof row !== "object") return null;
  if (row.genreKey != null) return "overlays";
  if (typeof row.sceneIndex === "number") return "templates";
  if (row.key != null) return "rules";
  return null;
};

/**
 * Normalize import body into { rules, templates, overlays } arrays.
 * @param {unknown} body
 * @param {{ collectionHint?: 'rules'|'templates'|'overlays' }} [opts]
 */
export const normalizeImportBundle = (body, opts = {}) => {
  if (body == null) {
    throw new Error("Import body is required");
  }

  if (Array.isArray(body)) {
    const hint = opts.collectionHint || inferCollectionFromRow(body[0]);
    if (!hint) {
      throw new Error(
        "Cannot infer collection from array; pass collectionHint or use a bundle object"
      );
    }
    return {
      rules: hint === "rules" ? body : [],
      templates: hint === "templates" ? body : [],
      overlays: hint === "overlays" ? body : [],
    };
  }

  if (typeof body !== "object") {
    throw new Error("Import body must be a JSON object or array");
  }

  return {
    rules: Array.isArray(body.rules) ? body.rules : [],
    templates: Array.isArray(body.templates) ? body.templates : [],
    overlays: Array.isArray(body.overlays) ? body.overlays : [],
  };
};

export const validateRuleRow = (row, index) => {
  const errors = [];
  const label = `rules[${index}]`;
  if (!row?.key || String(row.key).trim() === "") {
    errors.push(`${label}: \`key\` is required`);
  }
  if (!RULE_SCOPES.includes(row?.scope)) {
    errors.push(`${label}: \`scope\` must be 'universal' or 'phase'`);
  }
  if (row?.scope === "phase") {
    const phases = Array.isArray(row.phase) ? row.phase : [];
    if (phases.length === 0) {
      errors.push(`${label}: \`phase\` is required when scope === 'phase'`);
    }
    for (const p of phases) {
      if (!LAYERING_PHASES.includes(p)) {
        errors.push(`${label}: invalid phase "${p}"`);
      }
    }
  }
  if (row?.priority != null) {
    const p = Number(row.priority);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      errors.push(`${label}: \`priority\` must be 0–100`);
    }
  }
  return errors;
};

export const validateTemplateRow = (row, index) => {
  const errors = [];
  const label = `templates[${index}]`;
  if (!Number.isInteger(row?.sceneIndex) || row.sceneIndex < 1 || row.sceneIndex > 15) {
    errors.push(`${label}: \`sceneIndex\` must be an integer in [1, 15]`);
  }
  if (row?.tentpoleHint != null && !TENTPOLE_HINTS.includes(row.tentpoleHint)) {
    errors.push(`${label}: invalid \`tentpoleHint\``);
  }
  return errors;
};

export const validateOverlayRow = (row, index) => {
  const errors = [];
  const label = `overlays[${index}]`;
  if (!row?.genreKey || String(row.genreKey).trim() === "") {
    errors.push(`${label}: \`genreKey\` is required`);
  }
  if (!OVERLAY_APPLIES_AS.includes(row?.appliesAs)) {
    errors.push(
      `${label}: \`appliesAs\` must be 'base_genre' or 'additional_overlay'`
    );
  }
  if (row?.category && !OVERLAY_CATEGORIES.includes(row.category)) {
    errors.push(`${label}: invalid \`category\``);
  }
  return errors;
};

export const prepareRuleDoc = (row) => ({
  key: row.key,
  title: row.title ?? "",
  scope: row.scope,
  phase: row.scope === "universal" ? [] : Array.isArray(row.phase) ? row.phase : [],
  priority: row.priority ?? 50,
  enabled: row.enabled !== false,
  summary: row.summary ?? "",
  text: row.text ?? "",
  source: row.source ?? "",
});

export const prepareTemplateDoc = (row) => ({
  key: row.key,
  sceneIndex: row.sceneIndex,
  actNumber: row.actNumber,
  title: row.title ?? "",
  tentpoleHint: row.tentpoleHint ?? null,
  enabled: row.enabled !== false,
  outputFormatLabels: row.outputFormatLabels ?? [],
  template: row.template ?? "",
  coachingPrompt: row.coachingPrompt ?? "",
  subplotReminder: row.subplotReminder ?? "",
  source: row.source ?? "",
});

export const prepareOverlayDoc = (row) => ({
  genreKey: String(row.genreKey).trim().toLowerCase(),
  displayName: row.displayName ?? "",
  category: row.category,
  appliesAs: row.appliesAs,
  aliases: row.aliases ?? [],
  beats: row.beats ?? [],
  notes: row.notes ?? "",
  applicabilityNote: row.applicabilityNote ?? "",
  enabled: row.enabled !== false,
  source: row.source ?? "",
});
