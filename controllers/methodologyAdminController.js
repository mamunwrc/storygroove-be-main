/**
 * Phase 1.5C admin CRUD — superadmin-edited methodology content.
 *
 * Lets the content team hot-tune `MethodologyRule` / `PromptTemplate`
 * / `GenreOverlay` rows from the internal admin UI without a deploy.
 * Mirrors the existing `AgentPrompt` admin pattern (see
 * `assistantController.upsertAgentPrompt`).
 *
 * On every successful write we:
 *   1. Stamp the row's `methodologyVersion` to the current constant.
 *   2. Invalidate the in-process `methodologyService` LRU so the next
 *      assembler turn picks up the change immediately on this process.
 *      (Other processes pick it up within 5 min via the LRU TTL.)
 *
 * Routes (wired in `assistantRoute.js`):
 *   GET    /api/assistant/methodology/rules
 *   POST   /api/assistant/methodology/rule
 *   DELETE /api/assistant/methodology/rule/:key
 *   GET    /api/assistant/methodology/templates
 *   POST   /api/assistant/methodology/template
 *   GET    /api/assistant/methodology/overlays
 *   POST   /api/assistant/methodology/overlay
 *   DELETE /api/assistant/methodology/overlay/:genreKey
 *   POST   /api/assistant/methodology/audit
 *   GET    /api/assistant/methodology/export
 *   POST   /api/assistant/methodology/import
 *
 * All endpoints require `authenticateUserWithoutOpenAI` + `requireAdmin`.
 */

import asyncHandler from "express-async-handler";

import MethodologyRule from "../models/methodologyRuleModel.js";
import PromptTemplate from "../models/promptTemplateModel.js";
import GenreOverlay from "../models/genreOverlayModel.js";
import { METHODOLOGY_VERSION, MEMORY_SCHEMA_VERSION } from "../constants/models.js";
import {
  invalidateMethodologyCache,
  auditAgainstCodeConstants,
} from "../service/methodologyService.js";
import {
  OLIVIA_LAYERING_AFTER_TABLE_REMINDER,
  OLIVIA_SCENE_POST_SCENE_CTA,
} from "../constants/oliviaUiMessages.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";
import {
  BUNDLE_FORMAT_VERSION,
  RULE_FIELDS,
  TEMPLATE_FIELDS,
  OVERLAY_FIELDS,
  equalIgnoringMeta,
  stripRowForExport,
  normalizeImportBundle,
  validateRuleRow,
  validateTemplateRow,
  validateOverlayRow,
  prepareRuleDoc,
  prepareTemplateDoc,
  prepareOverlayDoc,
} from "../utils/methodologyBundle.js";

const stampVersion = (doc) => ({
  ...doc,
  methodologyVersion: METHODOLOGY_VERSION,
  memoryVersion: MEMORY_SCHEMA_VERSION,
});

// ---------------------------------------------------------------------------
// Methodology rules
// ---------------------------------------------------------------------------

export const listMethodologyRules = asyncHandler(async (req, res) => {
  const rows = await MethodologyRule.find({})
    .sort({ scope: 1, priority: -1, key: 1 })
    .lean();
  res.status(200).json({ rules: rows, methodologyVersion: METHODOLOGY_VERSION });
});

export const upsertMethodologyRule = asyncHandler(async (req, res) => {
  const {
    key,
    title,
    scope,
    phase = null,
    priority = 50,
    enabled = true,
    summary = "",
    text = "",
    source = "",
  } = req.body || {};
  if (!key) return res.status(400).json({ message: "`key` is required" });
  if (!["universal", "phase"].includes(scope)) {
    return res.status(400).json({ message: "`scope` must be 'universal' or 'phase'" });
  }
  if (scope === "phase" && !phase) {
    return res
      .status(400)
      .json({ message: "`phase` is required when scope === 'phase'" });
  }

  const doc = await MethodologyRule.findOneAndUpdate(
    { key },
    {
      $set: stampVersion({
        key,
        title,
        scope,
        phase,
        priority,
        enabled,
        summary,
        text,
        source,
      }),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "update",
    module: "assistant",
    description: "Methodology rule upserted",
    metadata: { key },
  });
  res.status(200).json({ rule: doc });
});

export const deleteMethodologyRule = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!key) return res.status(400).json({ message: "`key` is required" });
  // Soft-delete via `enabled: false` to preserve audit history. Use a
  // separate "hard delete" path if/when retention rules require it.
  const doc = await MethodologyRule.findOneAndUpdate(
    { key },
    { $set: { enabled: false, deletedAt: new Date() } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ message: "Rule not found" });
  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "delete",
    module: "assistant",
    description: "Methodology rule disabled",
    metadata: { key },
  });
  res.status(200).json({ rule: doc });
});

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

export const listPromptTemplates = asyncHandler(async (req, res) => {
  const rows = await PromptTemplate.find({}).sort({ sceneIndex: 1 }).lean();
  res.status(200).json({ templates: rows, methodologyVersion: METHODOLOGY_VERSION });
});

export const upsertPromptTemplate = asyncHandler(async (req, res) => {
  const {
    key,
    sceneIndex,
    actNumber,
    title,
    tentpoleHint = null,
    enabled = true,
    outputFormatLabels = [],
    template = "",
    coachingPrompt = "",
    subplotReminder = "",
    source = "",
  } = req.body || {};
  if (!Number.isInteger(sceneIndex) || sceneIndex < 1 || sceneIndex > 15) {
    return res
      .status(400)
      .json({ message: "`sceneIndex` must be an integer in [1, 15]" });
  }

  const doc = await PromptTemplate.findOneAndUpdate(
    { sceneIndex },
    {
      $set: stampVersion({
        key,
        sceneIndex,
        actNumber,
        title,
        tentpoleHint,
        enabled,
        outputFormatLabels,
        template,
        coachingPrompt,
        subplotReminder,
        source,
      }),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "update",
    module: "assistant",
    description: "Prompt template upserted",
    metadata: { sceneIndex },
  });
  res.status(200).json({ template: doc });
});

// ---------------------------------------------------------------------------
// Genre overlays
// ---------------------------------------------------------------------------

export const listGenreOverlays = asyncHandler(async (req, res) => {
  const rows = await GenreOverlay.find({})
    .sort({ category: 1, genreKey: 1 })
    .lean();
  res.status(200).json({ overlays: rows, methodologyVersion: METHODOLOGY_VERSION });
});

export const upsertGenreOverlay = asyncHandler(async (req, res) => {
  const {
    genreKey,
    displayName,
    category,
    appliesAs,
    aliases = [],
    beats = [],
    notes = "",
    applicabilityNote = "",
    enabled = true,
    source = "",
  } = req.body || {};
  if (!genreKey) return res.status(400).json({ message: "`genreKey` is required" });
  if (!["base_genre", "additional_overlay"].includes(appliesAs)) {
    return res
      .status(400)
      .json({ message: "`appliesAs` must be 'base_genre' or 'additional_overlay'" });
  }

  const doc = await GenreOverlay.findOneAndUpdate(
    { genreKey },
    {
      $set: stampVersion({
        genreKey,
        displayName,
        category,
        appliesAs,
        aliases,
        beats,
        notes,
        applicabilityNote,
        enabled,
        source,
      }),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "update",
    module: "assistant",
    description: "Genre overlay upserted",
    metadata: { genreKey },
  });
  res.status(200).json({ overlay: doc });
});

export const deleteGenreOverlay = asyncHandler(async (req, res) => {
  const { genreKey } = req.params;
  if (!genreKey) return res.status(400).json({ message: "`genreKey` is required" });
  const doc = await GenreOverlay.findOneAndUpdate(
    { genreKey },
    { $set: { enabled: false } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ message: "Overlay not found" });
  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "delete",
    module: "assistant",
    description: "Genre overlay disabled",
    metadata: { genreKey },
  });
  res.status(200).json({ overlay: doc });
});

// ---------------------------------------------------------------------------
// Audit — surface in admin UI before letting a save land
// ---------------------------------------------------------------------------

export const auditMethodology = asyncHandler(async (req, res) => {
  const result = await auditAgainstCodeConstants({
    codeBlocks: [OLIVIA_LAYERING_AFTER_TABLE_REMINDER, OLIVIA_SCENE_POST_SCENE_CTA],
    minOverlap: 80,
  });
  res.status(200).json({
    methodologyVersion: METHODOLOGY_VERSION,
    collisions: result.collisions,
    ok: result.collisions.length === 0,
  });
});

// ---------------------------------------------------------------------------
// Export / import bundle (full sync on import)
// ---------------------------------------------------------------------------

const emptyTally = () => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  disabled: 0,
  errors: [],
});

const upsertRow = async ({ Model, filter, doc, compareKeys }) => {
  const existing = await Model.findOne(filter).lean();
  const next = stampVersion(doc);
  if (!existing) {
    await Model.create(next);
    return "added";
  }
  const same = equalIgnoringMeta(existing, next, compareKeys);
  const versionDrift =
    existing.methodologyVersion !== METHODOLOGY_VERSION ||
    existing.memoryVersion !== MEMORY_SCHEMA_VERSION;
  if (same && !versionDrift) return "unchanged";
  await Model.updateOne(filter, { $set: next });
  return "updated";
};

export const exportMethodologyBundle = asyncHandler(async (req, res) => {
  const [rules, templates, overlays] = await Promise.all([
    MethodologyRule.find({}).sort({ scope: 1, priority: -1, key: 1 }).lean(),
    PromptTemplate.find({}).sort({ sceneIndex: 1 }).lean(),
    GenreOverlay.find({}).sort({ category: 1, genreKey: 1 }).lean(),
  ]);

  res.status(200).json({
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    methodologyVersion: METHODOLOGY_VERSION,
    rules: rules.map((r) => stripRowForExport(r, RULE_FIELDS)),
    templates: templates.map((t) => stripRowForExport(t, TEMPLATE_FIELDS)),
    overlays: overlays.map((o) => stripRowForExport(o, OVERLAY_FIELDS)),
  });
});

export const importMethodologyBundle = asyncHandler(async (req, res) => {
  let bundle;
  try {
    bundle = normalizeImportBundle(req.body, {
      collectionHint: req.body?.collectionHint,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const rulesTally = emptyTally();
  const templatesTally = emptyTally();
  const overlaysTally = emptyTally();

  const importedRuleKeys = [];
  const importedSceneIndexes = [];
  const importedGenreKeys = [];

  const seenRuleKeys = new Set();
  const seenSceneIndexes = new Set();
  const seenGenreKeys = new Set();

  for (let i = 0; i < bundle.rules.length; i += 1) {
    const row = bundle.rules[i];
    const rowErrors = validateRuleRow(row, i);
    if (rowErrors.length) {
      rulesTally.errors.push(...rowErrors);
      continue;
    }
    if (seenRuleKeys.has(row.key)) {
      rulesTally.errors.push(`rules[${i}]: duplicate key "${row.key}"`);
      continue;
    }
    seenRuleKeys.add(row.key);
    importedRuleKeys.push(row.key);
    try {
      const status = await upsertRow({
        Model: MethodologyRule,
        filter: { key: row.key },
        doc: prepareRuleDoc(row),
        compareKeys: RULE_FIELDS,
      });
      rulesTally[status]++;
    } catch (err) {
      rulesTally.errors.push(`rules[${i}]: ${err.message}`);
    }
  }

  for (let i = 0; i < bundle.templates.length; i += 1) {
    const row = bundle.templates[i];
    const rowErrors = validateTemplateRow(row, i);
    if (rowErrors.length) {
      templatesTally.errors.push(...rowErrors);
      continue;
    }
    if (seenSceneIndexes.has(row.sceneIndex)) {
      templatesTally.errors.push(
        `templates[${i}]: duplicate sceneIndex ${row.sceneIndex}`
      );
      continue;
    }
    seenSceneIndexes.add(row.sceneIndex);
    importedSceneIndexes.push(row.sceneIndex);
    try {
      const status = await upsertRow({
        Model: PromptTemplate,
        filter: { sceneIndex: row.sceneIndex },
        doc: prepareTemplateDoc(row),
        compareKeys: TEMPLATE_FIELDS,
      });
      templatesTally[status]++;
    } catch (err) {
      templatesTally.errors.push(`templates[${i}]: ${err.message}`);
    }
  }

  for (let i = 0; i < bundle.overlays.length; i += 1) {
    const row = bundle.overlays[i];
    const rowErrors = validateOverlayRow(row, i);
    if (rowErrors.length) {
      overlaysTally.errors.push(...rowErrors);
      continue;
    }
    const genreKey = String(row.genreKey).trim().toLowerCase();
    if (seenGenreKeys.has(genreKey)) {
      overlaysTally.errors.push(`overlays[${i}]: duplicate genreKey "${genreKey}"`);
      continue;
    }
    seenGenreKeys.add(genreKey);
    importedGenreKeys.push(genreKey);
    try {
      const status = await upsertRow({
        Model: GenreOverlay,
        filter: { genreKey },
        doc: prepareOverlayDoc(row),
        compareKeys: OVERLAY_FIELDS,
      });
      overlaysTally[status]++;
    } catch (err) {
      overlaysTally.errors.push(`overlays[${i}]: ${err.message}`);
    }
  }

  const ruleDisableFilter =
    importedRuleKeys.length > 0
      ? { key: { $nin: importedRuleKeys } }
      : {};
  const ruleDisableResult = await MethodologyRule.updateMany(ruleDisableFilter, {
    $set: { enabled: false, deletedAt: new Date() },
  });
  rulesTally.disabled = ruleDisableResult.modifiedCount ?? 0;

  const templateDisableFilter =
    importedSceneIndexes.length > 0
      ? { sceneIndex: { $nin: importedSceneIndexes } }
      : {};
  const templateDisableResult = await PromptTemplate.updateMany(
    templateDisableFilter,
    { $set: { enabled: false } }
  );
  templatesTally.disabled = templateDisableResult.modifiedCount ?? 0;

  const overlayDisableFilter =
    importedGenreKeys.length > 0
      ? { genreKey: { $nin: importedGenreKeys } }
      : {};
  const overlayDisableResult = await GenreOverlay.updateMany(overlayDisableFilter, {
    $set: { enabled: false },
  });
  overlaysTally.disabled = overlayDisableResult.modifiedCount ?? 0;

  invalidateMethodologyCache();
  queueActivityLog({
    req,
    userId: req.user?._id,
    action: "update",
    module: "assistant",
    description: "Methodology bundle imported (full sync)",
    metadata: {
      sync: true,
      rules: rulesTally,
      templates: templatesTally,
      overlays: overlaysTally,
    },
  });

  res.status(200).json({
    methodologyVersion: METHODOLOGY_VERSION,
    rules: rulesTally,
    templates: templatesTally,
    overlays: overlaysTally,
  });
});
