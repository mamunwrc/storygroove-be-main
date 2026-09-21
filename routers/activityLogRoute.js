import express from "express";
import {
  authenticateUserWithoutOpenAI,
  requireSuperAdmin,
} from "../config/tokenverify.js";
import { listActivityLogs } from "../controllers/activityLogController.js";

const activityLogRouter = express.Router();

activityLogRouter.use(authenticateUserWithoutOpenAI, requireSuperAdmin);

activityLogRouter.get("/", listActivityLogs);

export default activityLogRouter;
