import User from "../models/user.js";
import jwt from "jsonwebtoken";
import Thread from "../models/threadModel.js";
import * as StripeService from "../service/stripeService.js";
function validateToken(token) {
  return typeof token === "string" && token.trim() !== "";
}

function normalizeAgentName(agentName = "simoneai") {
  const normalized = (agentName || "simoneai").toString().trim().toLowerCase();
  if (!normalized) return "simone";
  if (normalized === "simoneai") return "simone";
  return normalized;
}

function parseCsvEnv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function buildEntitlements() {
  const builderPlanIds = [
    process.env.PRICE_BUILDER_MONTHLY,
    process.env.PRICE_BUILDER_YEARLY,
    ...parseCsvEnv(process.env.PRICE_BUILDER_LEGACY_IDS),
  ].filter(Boolean);

  const studioPlanIds = [
    process.env.PRICE_STUDIO_MONTHLY,
    process.env.PRICE_STUDIO_YEARLY,
  ].filter(Boolean);

  return { builderPlanIds, studioPlanIds };
}

function hasPrice(activePriceId, planIds) {
  if (!activePriceId || !Array.isArray(planIds) || planIds.length === 0) return false;
  return planIds.includes(activePriceId);
}

async function hasSimoneOneTimeAccess(user) {
  if (!user) return false;
  if ((user.simoneCreditsRemaining || 0) > 0) return true;
  if (user.simoneOneTimePaid === true) return true;
  const simonePriceId = process.env.SIMONE_ONETIME_PRICE;
  if (!simonePriceId || !user.stripeCustomerId) return false;

  const paidCount = await StripeService.countCompletedOneTimePricePurchases(
    user.stripeCustomerId,
    simonePriceId
  );
  const kitsUsed = Number(user.simoneKitsUsed || 0);
  const remaining = Math.max(0, paidCount - kitsUsed);
  const paid = remaining > 0;

  // Lazy backfill so subsequent checks are O(1).
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        simoneOneTimePaid: paidCount > 0,
        simonePaymentsCount: paidCount,
        simoneCreditsRemaining: remaining,
        ...(paidCount > 0 && !user.simoneOneTimePaidAt
          ? { simoneOneTimePaidAt: new Date() }
          : {}),
      },
    }
  );
  return paid;
}

export async function isSubscribedUser(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (req.user.role === "admin" || req.user.role === "superadmin") {
      return next();
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select("_id role");
    if (!user?._id) {
      return res.status(404).json({ error: "User not found" });
    }

    const { builderPlanIds, studioPlanIds } = buildEntitlements();
    let activePriceId = null;
    let activeSubscription = null;
    if (req.user.stripeCustomerId) {
      activeSubscription = await StripeService.getActiveSubscriptions(
        req.user.stripeCustomerId
      );
      activePriceId = activeSubscription?.items?.data?.[0]?.price?.id || null;
    }

    const hasBuilderSubscription = hasPrice(activePriceId, builderPlanIds);
    const hasStudioSubscription = hasPrice(activePriceId, studioPlanIds);
    const hasPaidAccess = hasBuilderSubscription || hasStudioSubscription;
    const isPausePlanPrice = StripeService.isPauseSubscriptionPriceId(activePriceId);
    // Stripe pause_collection (billing hold) or our pause-plan price both block
    // new agent submissions while keeping read-only dashboard access.
    const subscriptionPaused =
      !!activeSubscription?.pause_collection || isPausePlanPrice;

    const pausedResponse = (agentLabel = "your agents") =>
      res.status(403).json({
        error: `Your subscription is paused. Please update billing to resume ${agentLabel}.`,
        code: "SUBSCRIPTION_PAUSED",
      });

    // Agent-gated access only for /chat and /thread POST routes.
    if (
      req.method === "POST" &&
      (req.path === "/chat" || req.path === "/thread")
    ) {
      let requestedAgent = normalizeAgentName(req.body?.agentName);

      if (req.path === "/chat" && req.body?.threadId) {
        const existingThread = await Thread.findOne({
          threadId: req.body.threadId,
          userId,
          isActive: true,
        }).select("agentName");

        if (!existingThread) {
          return res.status(404).json({
            error: "Thread not found or access denied",
          });
        }
        requestedAgent = normalizeAgentName(existingThread.agentName);
      }

      if (subscriptionPaused) {
        const pauseAgentLabel =
          requestedAgent === "ellis"
            ? "Ellis"
            : requestedAgent === "olivia" || requestedAgent === "olivia_scenes"
              ? "Olivia"
              : requestedAgent === "simone"
                ? "Simone"
                : "your agents";
        return pausedResponse(pauseAgentLabel);
      }

      if (requestedAgent === "ellis") {
        if (hasStudioSubscription) {
          return next();
        }
        return res.status(403).json({
          error: "Ellis requires a Studio subscription.",
        });
      }

      if (requestedAgent === "olivia" || requestedAgent === "olivia_scenes") {
        if (hasBuilderSubscription || hasStudioSubscription) {
          return next();
        }
        return res.status(403).json({
          error: "Olivia requires a Builder or Studio subscription.",
        });
      }

      if (requestedAgent === "simone") {
        const hasSimoneOneTime = await hasSimoneOneTimeAccess(req.user);
        if (!hasPaidAccess && !hasSimoneOneTime) {
          return res.status(403).json({
            error: "Simone credit required. Complete a one-time payment to start a new Story Starter Kit.",
            code: "SIMONE_CREDIT_REQUIRED",
          });
        }
        return next();
      }

      const hasSimoneOneTime = await hasSimoneOneTimeAccess(req.user);
      if (hasPaidAccess) {
        return next();
      }
      if (!hasSimoneOneTime) {
        return res.status(403).json({
          error: "Simone credit required. Complete a one-time payment to start a new Story Starter Kit.",
          code: "SIMONE_CREDIT_REQUIRED",
        });
      }
      return next();
    }

    if (subscriptionPaused) {
      return pausedResponse();
    }

    if (hasPaidAccess) {
      return next();
    }

    return res.status(403).json({
      error: "Subscription required. Please subscribe to continue.",
    });
  } catch (e) {
    return res.status(500).json({
      error: "Error occurred while checking subscription status",
      message: e.message,
    });
  }
}

export async function requireStudioForEllis(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (req.user.role === "admin" || req.user.role === "superadmin") {
      return next();
    }

    const { studioPlanIds } = buildEntitlements();
    let activePriceId = null;
    let activeSubscription = null;
    if (req.user.stripeCustomerId) {
      activeSubscription = await StripeService.getActiveSubscriptions(
        req.user.stripeCustomerId
      );
      activePriceId = activeSubscription?.items?.data?.[0]?.price?.id || null;
    }

    const isPausePlanPrice = StripeService.isPauseSubscriptionPriceId(activePriceId);
    const subscriptionPaused =
      !!activeSubscription?.pause_collection || isPausePlanPrice;
    if (subscriptionPaused) {
      return res.status(403).json({
        error: "Your subscription is paused. Please update billing to resume Ellis.",
        code: "SUBSCRIPTION_PAUSED",
      });
    }

    if (hasPrice(activePriceId, studioPlanIds)) {
      return next();
    }

    return res.status(403).json({
      error: "Ellis requires a Studio subscription.",
    });
  } catch (e) {
    return res.status(500).json({
      error: "Error occurred while checking Ellis access",
      message: e.message,
    });
  }
}

export async function authenticateUserWithoutOpenAI (req, res, next) {
  try {
    if (!req.headers["authorization"]) {
      return res.status(401).json({ error: "No authorization headers sent" });
    }

    const token = req.headers["authorization"].split(" ")[1];
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    const curTime = new Date().getTime() / 1000;
    if (decodedToken.exp < curTime) {
      return res.status(401).json({ error: "Token expired" });
    }

    const user = await User.findOne({ _id: decodedToken.userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", message: "jwt expired" });
    }
    if (e.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    console.error(e);
    return res.status(500).json({ error: "Authentication error" });
  }
}

// Middleware function to validate header tokens
async function authenticateUser(req, res, next) {
  try {
    if (!req.headers["authorization"]) {
      return res.status(401).json({ error: "No authorization headers sent" });
    }

    const token = req.headers["authorization"].split(" ")[1];
    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    const curTime = new Date().getTime() / 1000;
    if (decodedToken.exp < curTime) {
      return res.status(401).json({ error: "Token expired" });
    }

    const user = await User.findOne({ _id: decodedToken.userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.openaiKey) {
      return res.status(403).json({ error: "OpenAI key not found for user" });
    }

    req.user = user;
    req.openaiKey = user.openaiKey;
    req.assistantId = user.assistantId;
    next();
  } catch (e) {
    if (e.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", message: "jwt expired" });
    }
    if (e.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    console.error(e);
    return res.status(500).json({ error: "Authentication error" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "superadmin")) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Superadmin access required" });
  }
  next();
}

export default authenticateUser;
