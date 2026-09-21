import express from "express";
import {
  // NEW DEFAULT (Responses API)
  generateStory,
  reviewNovel,
  ellisReview,
  generateCharacter,
  createNovelFromOliviaResponse,
  getOutlineSiblingsByThread,
  oliviaScenesReview,
  // LEGACY (Assistants API)
  generateStory_old,
  reviewNovel_old,
  ellisReview_old,
  generateCharacter_old,
  createNovelFromOliviaResponse_old,
  oliviaScenesReview_old,
  // Shared (no AI dependency)
  addNote,
  addScene,
  completeNovel,
  createNovel,
  getEllisSceneReviews,
  getOliviaSceneSuggestions,
  deleteNovel,
  downloadManuscript,
  downloadOutline,
  downloadCharacters,
  downloadStoryBible,
  getMostRecentNovel,
  recordRecentWorkAccess,
  getAllCharacters,
  getCharacterDetails,
  getNote,
  getNovelDetails,
  getNovelReviewDetails,
  downloadManuscriptMap,
  downloadEditorialLetter,
  downloadChapterPlan,
  getUserContent,
  getUserContentById,
  getUserNovels,
  renameScene,
  deleteScene,
  archiveScene,
  unarchiveScene,
  reorderScene,
  addUploadedChapter,
  reorderUploadedChapter,
  deleteUploadedChapter,
  archiveUploadedChapter,
  unarchiveUploadedChapter,
  saveUserContent,
  updateNovel,
  uploadManuscript,
  // Ellis (manuscript editing: editorial letter, scene chat, revision plan)
  getEditorialLetter,
  regenerateEditorialLetter,
  ellisEditorialLetterChat,
  getEditorialLetterChatHistory,
  saveEllisEditorialLetter,
  ellisChat,
  getEllisChatHistory,
  getEllisChapterReview,
  triggerEllisChapterReview,
  getEllisReviewProgress,
  saveEllisChapterReview,
  saveRevisionPlanItem,
  getRevisionPlanItems,
  deleteRevisionPlanItem,
  // Olivia Editor (scene layering)
  oliviaEditorChat,
  getOliviaEditorHistory,
  oliviaCoachingChat,
  getOliviaCoachingHistory,
  getOliviaLayeringState,
  insertLayeredScene,
  generateRichScene,
  generateRichSceneStream,
  updateSceneSuggestion,
  updateCharacter,
  createManualCharacter,
  deleteCharacter,
  reorderCharacters,
  updateMasterPrompt,
  updateStoryBible,
  // Olivia Scene-by-Scene Chat
  oliviaSceneChat,
  getOliviaSceneChatHistory,
  saveOliviaScene,
  generateBlurbAndSynopsis,
} from "../controllers/novelController.js";
import {
  getCoverSession,
  coverChat,
  renderBookCover,
  editBookCover,
  generateBookCover,
  getBookCover,
  listCoverVersionsHandler,
  listCoverMessagesHandler,
} from "../controllers/coverController.js";
import {
  listCheckpoints,
  createManualCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
} from "../controllers/sceneCheckpointController.js";
import { authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis } from "../config/tokenverify.js";
import { checkRateLimit } from "../middleware/checkRateLimit.js";
import { handleMulterError } from "../config/multer.js";
import { getStaticImageConfig } from "../config/openaiImageConfig.js";
import multer from "multer";
import path from "path";

// Multer config for doc files (for Ellis review)
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 50 }, // 50 MB limit
  fileFilter: function (req, file, cb) {
    // Allow doc and docx files
    const allowedTypes = [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const allowedExtensions = ['.doc', '.docx'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Only DOC and DOCX files are allowed.'));
    }
  },
});

// Multer config for uploaded manuscripts (Ellis workflow): Word, PDF, or TXT
// up to 50 MB. Broader than docUpload because writers may submit PDFs/TXT.
const manuscriptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 50 }, // 50 MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
      'text/plain',
      'text/markdown',
    ];
    const allowedExtensions = ['.doc', '.docx', '.pdf', '.txt', '.md'];
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Upload a Word, PDF, or TXT file.'));
    }
  },
});

const coverMaskUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getStaticImageConfig().maxMaskBytes },
  fileFilter(_req, file, cb) {
    if (file.fieldname === "mask" && file.mimetype !== "image/png") {
      return cb(new Error("Mask must be a PNG file."));
    }
    cb(null, true);
  },
});

const novelRoute = express.Router();

novelRoute.post("/generate", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateStory);
novelRoute.post("/review", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, reviewNovel);
novelRoute.post("/create", authenticateUserWithoutOpenAI, isSubscribedUser, createNovel);
novelRoute.post("/create-from-olivia", authenticateUserWithoutOpenAI, isSubscribedUser, createNovelFromOliviaResponse);
novelRoute.get(
  "/by-thread/:threadId/outlines",
  authenticateUserWithoutOpenAI,
  getOutlineSiblingsByThread
);
novelRoute.post(
  "/ellis/review",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  docUpload.single('document'),
  checkRateLimit,
  ellisReview
);
novelRoute.get(
  "/ellis/reviews/:novelId",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  getEllisSceneReviews
);
novelRoute.post(
  "/olivia/scenes",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  docUpload.single('document'),
  checkRateLimit,
  oliviaScenesReview
);
novelRoute.get(
  "/olivia/suggestions/:novelId",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  getOliviaSceneSuggestions
);
novelRoute.post("/update", authenticateUserWithoutOpenAI, isSubscribedUser, updateNovel);
novelRoute.get("/list", authenticateUserWithoutOpenAI, getUserNovels);
novelRoute.post("/character", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateCharacter);
novelRoute.post("/usercontent", authenticateUserWithoutOpenAI, isSubscribedUser, saveUserContent);
novelRoute.post("/scene/rename", authenticateUserWithoutOpenAI, isSubscribedUser, renameScene);
novelRoute.delete("/scene/:id", authenticateUserWithoutOpenAI, isSubscribedUser, deleteScene);
novelRoute.post("/scene/:id/archive", authenticateUserWithoutOpenAI, isSubscribedUser, archiveScene);
novelRoute.post("/scene/:id/unarchive", authenticateUserWithoutOpenAI, isSubscribedUser, unarchiveScene);
novelRoute.get("/usercontent/id/:id", authenticateUserWithoutOpenAI, isSubscribedUser, getUserContentById);
novelRoute.get("/usercontent/:novelId/:promptKey", authenticateUserWithoutOpenAI, isSubscribedUser, getUserContent);
novelRoute.get("/character/list/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, getAllCharacters);
novelRoute.get("/character/:characterId", authenticateUserWithoutOpenAI, isSubscribedUser, getCharacterDetails);
novelRoute.put("/character/:characterId", authenticateUserWithoutOpenAI, isSubscribedUser, updateCharacter);
novelRoute.delete("/character/:characterId", authenticateUserWithoutOpenAI, isSubscribedUser, deleteCharacter);
novelRoute.post("/character/reorder", authenticateUserWithoutOpenAI, isSubscribedUser, reorderCharacters);
novelRoute.post("/:novelId/character/manual", authenticateUserWithoutOpenAI, isSubscribedUser, createManualCharacter);
novelRoute.put("/:novelId/master-prompt", authenticateUserWithoutOpenAI, isSubscribedUser, updateMasterPrompt);
novelRoute.put("/:novelId/story-bible", authenticateUserWithoutOpenAI, isSubscribedUser, updateStoryBible);
// IMPORTANT: must precede the "/:novelId" GET route — otherwise "/recent" would
// be swallowed as a novelId param and resolve to getNovelDetails.
novelRoute.post("/recent-access", authenticateUserWithoutOpenAI, recordRecentWorkAccess);
novelRoute.get("/recent", authenticateUserWithoutOpenAI, getMostRecentNovel);
novelRoute.get("/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, getNovelDetails);
novelRoute.get("/review/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, getNovelReviewDetails);
novelRoute.post("/note", authenticateUserWithoutOpenAI, isSubscribedUser, addNote);
novelRoute.get("/note/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, getNote);
novelRoute.post("/scene/add", authenticateUserWithoutOpenAI, isSubscribedUser, addScene);
novelRoute.post("/scene/reorder", authenticateUserWithoutOpenAI, isSubscribedUser, reorderScene);
novelRoute.post("/chapter/add", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, addUploadedChapter);
novelRoute.post("/chapter/reorder", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, reorderUploadedChapter);
novelRoute.post("/chapter/:id/archive", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, archiveUploadedChapter);
novelRoute.post("/chapter/:id/unarchive", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, unarchiveUploadedChapter);
novelRoute.delete("/chapter/:id", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, deleteUploadedChapter);
novelRoute.post("/scene/insert", authenticateUserWithoutOpenAI, isSubscribedUser, insertLayeredScene);
novelRoute.post("/scene/generate-rich", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateRichScene);
novelRoute.post("/scene/generate-rich-stream", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateRichSceneStream);
novelRoute.put("/scene/suggestion", authenticateUserWithoutOpenAI, isSubscribedUser, updateSceneSuggestion);
novelRoute.post('/uploadmanuscript', authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, manuscriptUpload.single('document'), uploadManuscript);
novelRoute.post("/:novelId/olivia-scene-chat", authenticateUserWithoutOpenAI, isSubscribedUser, oliviaSceneChat);
novelRoute.get("/:novelId/olivia-scene-chat/history", authenticateUserWithoutOpenAI, isSubscribedUser, getOliviaSceneChatHistory);
novelRoute.post("/:novelId/olivia-save-scene", authenticateUserWithoutOpenAI, isSubscribedUser, saveOliviaScene);
novelRoute.post("/generate-extras", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateBlurbAndSynopsis);
novelRoute.post("/:novelId/olivia-chat", authenticateUserWithoutOpenAI, isSubscribedUser, oliviaEditorChat);
novelRoute.get("/:novelId/olivia-chat/history", authenticateUserWithoutOpenAI, isSubscribedUser, getOliviaEditorHistory);
novelRoute.post("/:novelId/olivia-coaching-chat", authenticateUserWithoutOpenAI, isSubscribedUser, oliviaCoachingChat);
novelRoute.get("/:novelId/olivia-coaching-chat/history", authenticateUserWithoutOpenAI, isSubscribedUser, getOliviaCoachingHistory);
// --- Ellis manuscript editing (Phase 2) — Studio tier ---
novelRoute.get("/:novelId/editorial-letter", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getEditorialLetter);
novelRoute.post("/:novelId/editorial-letter/regenerate", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, regenerateEditorialLetter);
novelRoute.get("/:novelId/editorial-letter/chat/history", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getEditorialLetterChatHistory);
novelRoute.post("/:novelId/editorial-letter/chat", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, ellisEditorialLetterChat);
novelRoute.post("/:novelId/editorial-letter/save", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, saveEllisEditorialLetter);
novelRoute.post("/:novelId/ellis-chat", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, ellisChat);
novelRoute.get("/:novelId/ellis-chat/history", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getEllisChatHistory);
novelRoute.post("/:novelId/ellis-save-chapter-review", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, saveEllisChapterReview);
novelRoute.get("/:novelId/ellis-review-progress", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getEllisReviewProgress);
novelRoute.get("/:novelId/ellis-chapter-review/:chapterNumber", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getEllisChapterReview);
novelRoute.post("/:novelId/ellis-chapter-review/:chapterNumber/generate", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, triggerEllisChapterReview);
novelRoute.post("/:novelId/revision-plan", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, saveRevisionPlanItem);
novelRoute.get("/:novelId/revision-plan", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, getRevisionPlanItems);
novelRoute.delete("/:novelId/revision-plan/:itemId", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, deleteRevisionPlanItem);
novelRoute.get("/:novelId/olivia-layering/next-target", authenticateUserWithoutOpenAI, isSubscribedUser, getOliviaLayeringState);
novelRoute.delete("/:novelId", authenticateUserWithoutOpenAI, deleteNovel);
novelRoute.patch("/complete/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, completeNovel);
novelRoute.get("/download/:novelId", authenticateUserWithoutOpenAI, downloadManuscript);
novelRoute.get("/download-outline/:novelId", authenticateUserWithoutOpenAI, downloadOutline);
novelRoute.get("/download-characters/:novelId", authenticateUserWithoutOpenAI, downloadCharacters);
novelRoute.get("/download-story-bible/:novelId", authenticateUserWithoutOpenAI, downloadStoryBible);
novelRoute.get("/download-manuscript-map/:novelId", authenticateUserWithoutOpenAI, requireStudioForEllis, downloadManuscriptMap);
novelRoute.get("/download-editorial-letter/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, downloadEditorialLetter);
novelRoute.get("/download-chapter-plan/:novelId", authenticateUserWithoutOpenAI, isSubscribedUser, requireStudioForEllis, downloadChapterPlan);
novelRoute.get("/:novelId/cover/session", authenticateUserWithoutOpenAI, isSubscribedUser, getCoverSession);
novelRoute.get("/:novelId/cover/messages", authenticateUserWithoutOpenAI, isSubscribedUser, listCoverMessagesHandler);
novelRoute.get("/:novelId/cover/versions", authenticateUserWithoutOpenAI, isSubscribedUser, listCoverVersionsHandler);
novelRoute.post("/:novelId/cover/chat", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, coverChat);
novelRoute.post("/:novelId/cover/render", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, renderBookCover);
novelRoute.post(
  "/:novelId/cover/edit",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  checkRateLimit,
  coverMaskUpload.single("mask"),
  handleMulterError,
  editBookCover
);
novelRoute.post("/:novelId/generate-cover", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, generateBookCover);
novelRoute.get("/:novelId/cover", authenticateUserWithoutOpenAI, isSubscribedUser, getBookCover);

// =========================================================================
// LEGACY (Assistants API) -- preserved for explicit access via -old suffix
// =========================================================================
novelRoute.post("/generate-old", authenticateUserWithoutOpenAI, isSubscribedUser, generateStory_old);
novelRoute.post("/review-old", authenticateUserWithoutOpenAI, isSubscribedUser, reviewNovel_old);
novelRoute.post("/create-from-olivia-old", authenticateUserWithoutOpenAI, isSubscribedUser, createNovelFromOliviaResponse_old);
novelRoute.post(
  "/ellis/review-old",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  docUpload.single('document'),
  ellisReview_old
);
novelRoute.post(
  "/olivia/scenes-old",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  docUpload.single('document'),
  oliviaScenesReview_old
);
novelRoute.post("/character-old", authenticateUserWithoutOpenAI, isSubscribedUser, generateCharacter_old);

// --- Scene checkpoints (Phase 3 optional; gated by constants/oliviaMemory.js) ---
novelRoute.get(
  "/:novelId/olivia-checkpoints",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  listCheckpoints
);
novelRoute.post(
  "/:novelId/olivia-checkpoint",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  createManualCheckpoint
);
novelRoute.post(
  "/:novelId/olivia-checkpoint/:checkpointId/restore",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  restoreCheckpoint
);
novelRoute.delete(
  "/:novelId/olivia-checkpoint/:checkpointId",
  authenticateUserWithoutOpenAI,
  isSubscribedUser,
  deleteCheckpoint
);

export default novelRoute;
