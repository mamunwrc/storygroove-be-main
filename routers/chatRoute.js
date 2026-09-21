import express from "express";
import { authenticateUserWithoutOpenAI, isSubscribedUser } from "../config/tokenverify.js";
import { checkRateLimit } from "../middleware/checkRateLimit.js";
import { uploadChatFile as uploadChatFileMiddleware, handleMulterError } from "../config/multer.js";

// NEW DEFAULT: Responses API handlers
import {
  createThread,
  sendMessage,
  getThreadHistory,
  deleteThread,
  renameThread,
  pinThread,
  uploadChatFile,
  getOliviaThreadsBySimone,
} from "../controllers/chatController.js";

// LEGACY: Assistants API handlers
import {
  createThread_old,
  sendMessage_old,
  getThreadHistory_old,
  getUserThreads,
} from "../controllers/assistantController.js";

const router = express.Router();

// =========================================================================
// DEFAULT (Responses API)
// =========================================================================
router.post(
  "/chat/upload",
  authenticateUserWithoutOpenAI,
  uploadChatFileMiddleware.array("files", 5),
  handleMulterError,
  uploadChatFile
);
router.post("/chat", authenticateUserWithoutOpenAI, isSubscribedUser, checkRateLimit, sendMessage);
router.post("/thread", authenticateUserWithoutOpenAI, isSubscribedUser, createThread);
router.get(
  "/thread/by-simone/:simoneThreadId/olivia",
  authenticateUserWithoutOpenAI,
  getOliviaThreadsBySimone
);
router.get("/thread/:threadId", authenticateUserWithoutOpenAI, getThreadHistory);
router.get("/threads", authenticateUserWithoutOpenAI, getUserThreads);
router.delete("/thread/:id", authenticateUserWithoutOpenAI, deleteThread);
router.patch("/thread/:id/rename", authenticateUserWithoutOpenAI, renameThread);
router.patch("/thread/:id/pin", authenticateUserWithoutOpenAI, pinThread);

// =========================================================================
// LEGACY (Assistants API) -- preserved for explicit access via -old suffix
// =========================================================================
router.post("/chat-old", authenticateUserWithoutOpenAI, isSubscribedUser, sendMessage_old);
router.post("/thread-old", authenticateUserWithoutOpenAI, isSubscribedUser, createThread_old);
router.get(
  "/thread-old/:threadId",
  authenticateUserWithoutOpenAI,
  getThreadHistory_old
);

export default router;
