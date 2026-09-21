import express from "express";
import { authenticateUserWithoutOpenAI } from "../config/tokenverify.js";
import { requireSuperAdmin } from "../config/tokenverify.js";
import {
  getSummaryStats,
  getUserUsageList,
  getUserCostHistory,
  getRateLimitEvents,
  blockUser,
  unblockUser,
  updateUserLimit,
  getGlobalSettings,
  updateGlobalSettings,
  recomputeCosts,
  getRecomputeJob,
} from "../controllers/apiUsageController.js";

const apiUsageRoute = express.Router();

apiUsageRoute.use(authenticateUserWithoutOpenAI, requireSuperAdmin);

apiUsageRoute.get("/summary", getSummaryStats);
apiUsageRoute.get("/users", getUserUsageList);
apiUsageRoute.get("/users/:userId/history", getUserCostHistory);
apiUsageRoute.get("/rate-limit-events", getRateLimitEvents);
apiUsageRoute.post("/users/:userId/block", blockUser);
apiUsageRoute.post("/users/:userId/unblock", unblockUser);
apiUsageRoute.patch("/users/:userId/limit", updateUserLimit);
apiUsageRoute.get("/settings", getGlobalSettings);
apiUsageRoute.patch("/settings", updateGlobalSettings);
apiUsageRoute.post("/recompute-costs", recomputeCosts);
apiUsageRoute.get("/recompute-costs/:jobId", getRecomputeJob);

export default apiUsageRoute;
