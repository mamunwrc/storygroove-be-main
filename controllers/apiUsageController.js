import User from "../models/user.js";
import ApiUsageLog from "../models/apiUsageLogModel.js";
import RateLimitEvent from "../models/rateLimitEventModel.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import Subscription from "../models/subscriptionModel.js";
import Subscriber from "../models/subscriberModel.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";
import { recomputeApiUsageCost } from "../utils/recomputeApiUsageCost.js";
import crypto from "crypto";

const ALLOWED_COVER_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5"];

function getMonthRange() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  return { start, end };
}

export async function getSummaryStats(req, res) {
  try {
    const { start, end } = getMonthRange();
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );

    const [
      totalActiveUsers,
      totalBlockedUsers,
      monthlyAgg,
      rateLimitHitsToday,
    ] = await Promise.all([
      User.countDocuments({
        role: { $ne: "superadmin" },
        status: "active",
        apiUsageStatus: { $ne: "blocked" },
      }),
      User.countDocuments({
        role: { $ne: "superadmin" },
        apiUsageStatus: "blocked",
      }),
      ApiUsageLog.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        {
          $group: {
            _id: null,
            totalPrompts: { $sum: 1 },
            totalCost: { $sum: "$cost" },
            totalPromptTokens: { $sum: "$promptTokens" },
            totalCompletionTokens: { $sum: "$completionTokens" },
            totalTokens: { $sum: "$totalTokens" },
          },
        },
      ]),
      RateLimitEvent.countDocuments({ createdAt: { $gte: dayStart } }),
    ]);

    const agg = monthlyAgg[0] || {
      totalPrompts: 0,
      totalCost: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
    };

    return res.status(200).json({
      totalActiveUsers,
      totalBlockedUsers,
      totalPrompts: agg.totalPrompts,
      totalCostThisMonth: agg.totalCost,
      rateLimitHitsToday,
    });
  } catch (e) {
    console.error("getSummaryStats error:", e);
    return res
      .status(500)
      .json({ error: "Failed to fetch summary stats", message: e.message });
  }
}

export async function getUserUsageList(req, res) {
  try {
    const {
      page = 1,
      limit = 20,
      sort = "totalCost",
      order = "desc",
      search = "",
      status = "",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const sortOrder = order === "asc" ? 1 : -1;

    const { start, end } = getMonthRange();

    const matchStage = {};
    if (search) {
      matchStage.email = { $regex: search, $options: "i" };
    }
    if (status) {
      matchStage.apiUsageStatus = status;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "apiusagelogs",
          let: { uid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$uid"] },
                    { $gte: ["$createdAt", start] },
                    { $lt: ["$createdAt", end] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalRequests: { $sum: 1 },
                totalCost: { $sum: "$cost" },
                promptTokens: { $sum: "$promptTokens" },
                completionTokens: { $sum: "$completionTokens" },
                totalTokens: { $sum: "$totalTokens" },
              },
            },
          ],
          as: "usageStats",
        },
      },
      {
        $addFields: {
          stats: { $arrayElemAt: ["$usageStats", 0] },
        },
      },
      {
        $project: {
          _id: 1,
          email: 1,
          fname: 1,
          lname: 1,
          role: 1,
          status: 1,
          apiUsageStatus: 1,
          monthlySpendLimit: 1,
          customRpmLimit: 1,
          customRpdLimit: 1,
          customTpmLimit: 1,
          customTpdLimit: 1,
          failedLoginAttempts: 1,
          lockUntil: 1,
          totalRequests: { $ifNull: ["$stats.totalRequests", 0] },
          totalCost: { $ifNull: ["$stats.totalCost", 0] },
          promptTokens: { $ifNull: ["$stats.promptTokens", 0] },
          completionTokens: { $ifNull: ["$stats.completionTokens", 0] },
          totalTokens: { $ifNull: ["$stats.totalTokens", 0] },
        },
      },
      { $sort: { [sort]: sortOrder } },
      {
        $facet: {
          data: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
          count: [{ $count: "total" }],
        },
      },
    ];

    const [result] = await User.aggregate(pipeline);
    const users = result.data || [];
    const total = result.count[0]?.total || 0;

    return res.status(200).json({
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (e) {
    console.error("getUserUsageList error:", e);
    return res
      .status(500)
      .json({ error: "Failed to fetch user usage list", message: e.message });
  }
}

export async function getUserCostHistory(req, res) {
  try {
    const { userId } = req.params;
    const { months = 6 } = req.query;

    const user = await User.findById(userId).select(
      "email fname lname role status apiUsageStatus customRpmLimit customRpdLimit customTpmLimit customTpdLimit monthlySpendLimit failedLoginAttempts lockUntil createdAt"
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();
    const monthsNum = parseInt(months, 10);
    const startDate = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - monthsNum + 1,
        1
      )
    );

    const [costHistory, rateLimitHits, settings, subscriber] =
      await Promise.all([
        ApiUsageLog.aggregate([
          {
            $match: {
              userId: user._id,
              createdAt: { $gte: startDate },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              totalCost: { $sum: "$cost" },
              totalRequests: { $sum: 1 },
              promptTokens: { $sum: "$promptTokens" },
              completionTokens: { $sum: "$completionTokens" },
              totalTokens: { $sum: "$totalTokens" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]),
        RateLimitEvent.find({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean(),
        ApiUsageSettings.getSettings(),
        Subscriber.findOne({
          userid: user._id,
          cycleEndingOn: { $gt: now },
        }).lean(),
      ]);

    const minuteAgo = new Date(now - 60_000);
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );

    const [userRpm, userRpd, userTpmAgg, userTpdAgg] = await Promise.all([
      ApiUsageLog.countDocuments({
        userId: user._id,
        createdAt: { $gte: minuteAgo },
      }),
      ApiUsageLog.countDocuments({
        userId: user._id,
        createdAt: { $gte: dayStart },
      }),
      ApiUsageLog.aggregate([
        { $match: { userId: user._id, createdAt: { $gte: minuteAgo } } },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
      ]),
      ApiUsageLog.aggregate([
        { $match: { userId: user._id, createdAt: { $gte: dayStart } } },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
      ]),
    ]);

    const effectiveRpmLimit = user.customRpmLimit ?? settings.defaultRpmLimit;
    const effectiveRpdLimit = user.customRpdLimit ?? settings.defaultRpdLimit;
    const effectiveTpmLimit = user.customTpmLimit ?? settings.defaultTpmLimit;
    const effectiveTpdLimit = user.customTpdLimit ?? settings.defaultTpdLimit;

    const rateLimitStatus = {
      rpm: {
        current: userRpm,
        limit: effectiveRpmLimit,
        isCustom: user.customRpmLimit != null,
        percentage: effectiveRpmLimit
          ? Math.min(100, Math.round((userRpm / effectiveRpmLimit) * 100))
          : 0,
      },
      rpd: {
        current: userRpd,
        limit: effectiveRpdLimit,
        isCustom: user.customRpdLimit != null,
        percentage: effectiveRpdLimit
          ? Math.min(100, Math.round((userRpd / effectiveRpdLimit) * 100))
          : 0,
      },
      tpm: {
        current: userTpmAgg[0]?.total || 0,
        limit: effectiveTpmLimit,
        isCustom: user.customTpmLimit != null,
        percentage: effectiveTpmLimit
          ? Math.min(
              100,
              Math.round(
                ((userTpmAgg[0]?.total || 0) / effectiveTpmLimit) * 100
              )
            )
          : 0,
      },
      tpd: {
        current: userTpdAgg[0]?.total || 0,
        limit: effectiveTpdLimit,
        isCustom: user.customTpdLimit != null,
        percentage: effectiveTpdLimit
          ? Math.min(
              100,
              Math.round(
                ((userTpdAgg[0]?.total || 0) / effectiveTpdLimit) * 100
              )
            )
          : 0,
      },
    };

    // Resolve effective spend limit through the priority chain
    const { limit: effectiveSpendLimit, source: spendLimitSource } =
      settings.resolveSpendLimit(user, subscriber);

    const effective =
      effectiveSpendLimit != null
        ? Number(effectiveSpendLimit)
        : (settings.trialSpendLimit ?? 20);

    return res.status(200).json({
      user: {
        _id: user._id,
        email: user.email,
        fname: user.fname,
        lname: user.lname,
      },
      costHistory,
      rateLimitHits,
      rateLimitStatus,
      spendLimit: {
        effective,
        source: spendLimitSource || "trial",
        customOverride: user.monthlySpendLimit,
      },
    });
  } catch (e) {
    console.error("getUserCostHistory error:", e);
    return res.status(500).json({
      error: "Failed to fetch user cost history",
      message: e.message,
    });
  }
}

export async function getRateLimitEvents(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));

    const [events, total] = await Promise.all([
      RateLimitEvent.find()
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      RateLimitEvent.countDocuments(),
    ]);

    return res.status(200).json({
      events,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (e) {
    console.error("getRateLimitEvents error:", e);
    return res.status(500).json({
      error: "Failed to fetch rate limit events",
      message: e.message,
    });
  }
}

export async function blockUser(req, res) {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role === "superadmin") {
      return res.status(403).json({ error: "Cannot block a superadmin" });
    }

    user.apiUsageStatus = "blocked";
    await user.save();

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "apiUsage",
      description: "Superadmin blocked user API usage",
      metadata: { targetUserId: String(userId) },
    });
    return res
      .status(200)
      .json({
        message: "User blocked successfully",
        apiUsageStatus: "blocked",
      });
  } catch (e) {
    console.error("blockUser error:", e);
    return res
      .status(500)
      .json({ error: "Failed to block user", message: e.message });
  }
}

export async function unblockUser(req, res) {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.apiUsageStatus = "active";
    await user.save();

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "apiUsage",
      description: "Superadmin unblocked user API usage",
      metadata: { targetUserId: String(userId) },
    });
    return res
      .status(200)
      .json({
        message: "User unblocked successfully",
        apiUsageStatus: "active",
      });
  } catch (e) {
    console.error("unblockUser error:", e);
    return res
      .status(500)
      .json({ error: "Failed to unblock user", message: e.message });
  }
}

export async function updateUserLimit(req, res) {
  try {
    const { userId } = req.params;
    const {
      monthlySpendLimit,
      customRpmLimit,
      customRpdLimit,
      customTpmLimit,
      customTpdLimit,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (monthlySpendLimit !== undefined)
      user.monthlySpendLimit = monthlySpendLimit;
    if (customRpmLimit !== undefined) user.customRpmLimit = customRpmLimit;
    if (customRpdLimit !== undefined) user.customRpdLimit = customRpdLimit;
    if (customTpmLimit !== undefined) user.customTpmLimit = customTpmLimit;
    if (customTpdLimit !== undefined) user.customTpdLimit = customTpdLimit;

    await user.save();

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "apiUsage",
      description: "Superadmin updated per-user API limits",
      metadata: { targetUserId: String(userId) },
    });
    return res.status(200).json({
      message: "User limits updated successfully",
      limits: {
        monthlySpendLimit: user.monthlySpendLimit,
        customRpmLimit: user.customRpmLimit,
        customRpdLimit: user.customRpdLimit,
        customTpmLimit: user.customTpmLimit,
        customTpdLimit: user.customTpdLimit,
      },
    });
  } catch (e) {
    console.error("updateUserLimit error:", e);
    return res
      .status(500)
      .json({ error: "Failed to update user limits", message: e.message });
  }
}

export async function getGlobalSettings(req, res) {
  try {
    const [settings, plans] = await Promise.all([
      ApiUsageSettings.getSettings(),
      Subscription.find({ isdeleted: false, visible: true })
        .select("priceId name amount interval")
        .sort({ amount: 1 })
        .lean(),
    ]);

    return res.status(200).json({
      settings,
      availablePlans: plans.map((p) => ({
        priceId: p.priceId,
        name: p.name,
        amount: p.amount,
        interval: p.interval,
      })),
    });
  } catch (e) {
    console.error("getGlobalSettings error:", e);
    return res
      .status(500)
      .json({ error: "Failed to fetch global settings", message: e.message });
  }
}

export async function updateGlobalSettings(req, res) {
  try {
    const {
      planSpendLimits,
      trialSpendLimit,
      fallbackSpendLimit,
      defaultRpmLimit,
      defaultRpdLimit,
      defaultTpmLimit,
      defaultTpdLimit,
      simoneSessionSpendCap,
      coverImageModel,
      coverImagePartialImages,
      coverRendersPerBillingPeriod,
    } = req.body;

    const settings = await ApiUsageSettings.getSettings();

    if (planSpendLimits !== undefined)
      settings.planSpendLimits = planSpendLimits;
    if (trialSpendLimit !== undefined)
      settings.trialSpendLimit = trialSpendLimit;
    if (fallbackSpendLimit !== undefined)
      settings.fallbackSpendLimit = fallbackSpendLimit;
    if (defaultRpmLimit !== undefined)
      settings.defaultRpmLimit = defaultRpmLimit;
    if (defaultRpdLimit !== undefined)
      settings.defaultRpdLimit = defaultRpdLimit;
    if (defaultTpmLimit !== undefined)
      settings.defaultTpmLimit = defaultTpmLimit;
    if (defaultTpdLimit !== undefined)
      settings.defaultTpdLimit = defaultTpdLimit;
    if (simoneSessionSpendCap !== undefined) {
      const n = Number(simoneSessionSpendCap);
      settings.simoneSessionSpendCap = Number.isFinite(n) && n >= 0 ? n : 3;
    }
    if (coverImageModel !== undefined) {
      settings.coverImageModel = ALLOWED_COVER_IMAGE_MODELS.includes(
        coverImageModel
      )
        ? coverImageModel
        : "gpt-image-2";
    }
    if (coverImagePartialImages !== undefined) {
      const n = Number(coverImagePartialImages);
      settings.coverImagePartialImages =
        Number.isFinite(n) ? Math.min(3, Math.max(0, Math.floor(n))) : 0;
    }
    if (coverRendersPerBillingPeriod !== undefined) {
      const n = Number(coverRendersPerBillingPeriod);
      settings.coverRendersPerBillingPeriod =
        Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
    }
    settings.updatedBy = req.user._id;

    await settings.save();

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "apiUsage",
      description: "Superadmin updated global API usage settings",
      metadata: {},
    });
    return res
      .status(200)
      .json({ message: "Settings updated successfully", settings });
  } catch (e) {
    console.error("updateGlobalSettings error:", e);
    return res.status(500).json({
      error: "Failed to update global settings",
      message: e.message,
    });
  }
}

/**
 * In-memory recompute-job tracker. Each entry:
 *   { status: "running" | "completed" | "failed",
 *     startedAt, finishedAt, scanned, updated, error }
 * Jobs are kept for 1h after completion so the dashboard can poll for
 * status; node process restart drops them, which is fine — the run is
 * idempotent and can be re-triggered.
 */
const RECOMPUTE_JOBS = new Map();
const RECOMPUTE_JOB_TTL_MS = 60 * 60 * 1000;

const pruneRecomputeJobs = () => {
  const now = Date.now();
  for (const [id, job] of RECOMPUTE_JOBS.entries()) {
    if (job.finishedAt && now - job.finishedAt > RECOMPUTE_JOB_TTL_MS) {
      RECOMPUTE_JOBS.delete(id);
    }
  }
};

/**
 * POST /api/api-usage/recompute-costs
 * Kicks off an async recompute of `cost` on every ApiUsageLog row using the
 * current pricing constants. Returns a job id immediately; poll via
 * GET /api/api-usage/recompute-costs/:jobId for progress.
 */
export async function recomputeCosts(req, res) {
  try {
    pruneRecomputeJobs();
    const jobId = crypto.randomUUID();
    const job = {
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      scanned: 0,
      updated: 0,
      error: null,
    };
    RECOMPUTE_JOBS.set(jobId, job);

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "apiUsage",
      description: "Superadmin triggered ApiUsageLog cost recompute",
      metadata: { jobId },
    });

    (async () => {
      try {
        const result = await recomputeApiUsageCost({
          batchSize: 1000,
          onProgress: ({ scanned, updated }) => {
            job.scanned = scanned;
            job.updated = updated;
          },
        });
        job.scanned = result.scanned;
        job.updated = result.updated;
        job.status = "completed";
      } catch (err) {
        console.error("recomputeCosts job failed:", err);
        job.status = "failed";
        job.error = err.message || "Unknown error";
      } finally {
        job.finishedAt = Date.now();
      }
    })();

    return res.status(202).json({
      jobId,
      status: job.status,
      message: "Recompute job started. Poll /recompute-costs/:jobId for progress.",
    });
  } catch (e) {
    console.error("recomputeCosts error:", e);
    return res
      .status(500)
      .json({ error: "Failed to start recompute job", message: e.message });
  }
}

/**
 * GET /api/api-usage/recompute-costs/:jobId
 * Returns progress / completion status for a job started via recomputeCosts.
 */
export async function getRecomputeJob(req, res) {
  pruneRecomputeJobs();
  const job = RECOMPUTE_JOBS.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found or expired" });
  }
  return res.status(200).json({ jobId: req.params.jobId, ...job });
}
