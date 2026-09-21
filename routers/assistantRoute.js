import express from "express";
import {
  setupAssistant,
  createThread_old,
  getUserThreads,
  getThreadHistory_old,
  sendMessage_old,
  getSimoneKey,
  upsertSimoneKey,
  getAllAgentPrompts,
  upsertAgentPrompt,
  exportAgentPromptsBundle,
  importAgentPromptsBundle,
} from "../controllers/assistantController.js";
import {
  listMethodologyRules,
  upsertMethodologyRule,
  deleteMethodologyRule,
  listPromptTemplates,
  upsertPromptTemplate,
  listGenreOverlays,
  upsertGenreOverlay,
  deleteGenreOverlay,
  auditMethodology,
  exportMethodologyBundle,
  importMethodologyBundle,
} from "../controllers/methodologyAdminController.js";
import { authenticateUserWithoutOpenAI, requireAdmin, requireSuperAdmin } from "../config/tokenverify.js";

const router = express.Router();

router.post("/setup", authenticateUserWithoutOpenAI, requireAdmin, setupAssistant);
router.get(
  "/simone/key",
  authenticateUserWithoutOpenAI,
  requireSuperAdmin,
  getSimoneKey
);
router.post(
  "/simone/key",
  authenticateUserWithoutOpenAI,
  requireSuperAdmin,
  upsertSimoneKey
);
router.get(
  "/agent/prompts",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  getAllAgentPrompts
);
router.get(
  "/agent/prompts/export",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  exportAgentPromptsBundle
);
router.post(
  "/agent/prompts/import",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  importAgentPromptsBundle
);
router.post(
  "/agent/prompt",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  upsertAgentPrompt
);

// --- Methodology admin CRUD (Phase 1.5C) ---
router.get(
  "/methodology/rules",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  listMethodologyRules
);
router.post(
  "/methodology/rule",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  upsertMethodologyRule
);
router.delete(
  "/methodology/rule/:key",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  deleteMethodologyRule
);
router.get(
  "/methodology/templates",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  listPromptTemplates
);
router.post(
  "/methodology/template",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  upsertPromptTemplate
);
router.get(
  "/methodology/overlays",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  listGenreOverlays
);
router.post(
  "/methodology/overlay",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  upsertGenreOverlay
);
router.delete(
  "/methodology/overlay/:genreKey",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  deleteGenreOverlay
);
router.post(
  "/methodology/audit",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  auditMethodology
);
router.get(
  "/methodology/export",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  exportMethodologyBundle
);
router.post(
  "/methodology/import",
  authenticateUserWithoutOpenAI,
  requireAdmin,
  importMethodologyBundle
);
// LEGACY: These routes remain for backward compatibility
router.post("/thread", authenticateUserWithoutOpenAI, createThread_old);
router.post("/message", authenticateUserWithoutOpenAI, sendMessage_old);
router.get("/threads", authenticateUserWithoutOpenAI, getUserThreads);
router.get("/thread/:threadId", authenticateUserWithoutOpenAI, getThreadHistory_old);

export default router;
