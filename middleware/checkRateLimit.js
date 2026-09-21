import ApiUsageLog from "../models/apiUsageLogModel.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import RateLimitEvent from "../models/rateLimitEventModel.js";
import Subscriber from "../models/subscriberModel.js";

/**
 * Per-user rate-limit middleware.
 *
 * 1. Blocks users with apiUsageStatus === "blocked" (403)
 * 2. Checks RPM / RPD / TPM / TPD per-user (429 with retryAfter)
 * 3. Checks monthly spend limit via priority chain (429 with retryAfter)
 * 4. Attaches X-RateLimit-Warning header when any dimension >= 80%
 *
 * Must be mounted AFTER authenticateUserWithoutOpenAI (needs req.user).
 */

function secondsUntilMidnight(now) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.ceil((midnight - now) / 1000);
}

function secondsUntilNextMonth(now) {
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((nextMonth - now) / 1000);
}

function retryAfterForDimension(dimension, now) {
  if (dimension === "RPM" || dimension === "TPM") return 60;
  if (dimension === "RPD" || dimension === "TPD") return secondsUntilMidnight(now);
  if (dimension === "SPEND") return secondsUntilNextMonth(now);
  return 60;
}

const DIMENSION_LABELS = {
  RPM: "requests per minute",
  RPD: "requests per day",
  TPM: "tokens per minute",
  TPD: "tokens per day",
  SPEND: "monthly spend",
};

function formatRetryWait(seconds) {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)} hours`;
  return `${Math.ceil(seconds / 86400)} days`;
}

export async function checkRateLimit(req, res, next) {
  try {
    const user = req.user;
    if (!user) return next();

    // Superadmins should not be rate-limited or blocked by usage controls.
    if (user.role === "superadmin") return next();

    const userId = user._id;
    const now = new Date();

    // --- Blocked user ---
    if (user.apiUsageStatus === "blocked") {
      RateLimitEvent.create({
        userId,
        userEmail: user.email,
        dimension: "BLOCKED",
        currentValue: 0,
        limitValue: 0,
        action: "request_rejected",
      }).catch((err) =>
        console.error("Failed to log blocked event:", err.message)
      );

      return res.status(403).json({
        error: "Your API access has been blocked. Please contact the administrator.",
        dimension: "BLOCKED",
        current: 0,
        limit: 0,
        retryAfter: null,
        message: "Your API access has been blocked by an administrator. Please contact support for assistance.",
      });
    }

    const settings = await ApiUsageSettings.getSettings();

    const rpmLimit = user.customRpmLimit ?? settings.defaultRpmLimit;
    const rpdLimit = user.customRpdLimit ?? settings.defaultRpdLimit;
    const tpmLimit = user.customTpmLimit ?? settings.defaultTpmLimit;
    const tpdLimit = user.customTpdLimit ?? settings.defaultTpdLimit;

    const minuteAgo = new Date(now - 60_000);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [rpmCount, rpdCount, tpmAgg, tpdAgg] = await Promise.all([
      ApiUsageLog.countDocuments({ userId, createdAt: { $gte: minuteAgo } }),
      ApiUsageLog.countDocuments({ userId, createdAt: { $gte: dayStart } }),
      ApiUsageLog.aggregate([
        { $match: { userId, createdAt: { $gte: minuteAgo } } },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
      ]),
      ApiUsageLog.aggregate([
        { $match: { userId, createdAt: { $gte: dayStart } } },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
      ]),
    ]);

    const tpmVal = tpmAgg[0]?.total || 0;
    const tpdVal = tpdAgg[0]?.total || 0;

    const checks = [
      { dimension: "RPM", current: rpmCount, limit: rpmLimit },
      { dimension: "RPD", current: rpdCount, limit: rpdLimit },
      { dimension: "TPM", current: tpmVal, limit: tpmLimit },
      { dimension: "TPD", current: tpdVal, limit: tpdLimit },
    ];

    // --- Hard limit checks (reject at 100%) ---
    for (const { dimension, current, limit } of checks) {
      if (limit && current >= limit) {
        const retryAfter = retryAfterForDimension(dimension, now);

        RateLimitEvent.create({
          userId,
          userEmail: user.email,
          dimension,
          currentValue: current,
          limitValue: limit,
          action: "request_rejected",
        }).catch((err) =>
          console.error("Failed to log rate limit event:", err.message)
        );

        return res.status(429).json({
          error: `Rate limit exceeded: ${dimension}`,
          dimension,
          current,
          limit,
          retryAfter,
          message: `You've reached your ${DIMENSION_LABELS[dimension]} limit (${current.toLocaleString()}/${limit.toLocaleString()}). Please wait ${formatRetryWait(retryAfter)} before trying again.`,
        });
      }
    }

    // --- Monthly spend limit ---
    const subscriber = await Subscriber.findOne({
      userid: userId,
      cycleEndingOn: { $gt: now },
    });

    const { limit: spendLimit } = settings.resolveSpendLimit(user, subscriber);

    let currentCost = 0;
    if (spendLimit && spendLimit > 0) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const [costAgg] = await ApiUsageLog.aggregate([
        { $match: { userId, createdAt: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, total: { $sum: "$cost" } } },
      ]);
      currentCost = costAgg?.total || 0;

      if (currentCost >= spendLimit) {
        const retryAfter = secondsUntilNextMonth(now);

        RateLimitEvent.create({
          userId,
          userEmail: user.email,
          dimension: "SPEND",
          currentValue: Math.round(currentCost * 100),
          limitValue: Math.round(spendLimit * 100),
          action: "request_rejected",
        }).catch((err) =>
          console.error("Failed to log spend limit event:", err.message)
        );

        return res.status(429).json({
          error: "Monthly spend limit reached",
          dimension: "SPEND",
          current: currentCost,
          limit: spendLimit,
          retryAfter,
          message: `You've reached your monthly spend limit ($${currentCost.toFixed(2)}/$${spendLimit.toFixed(2)}). The limit resets in ${formatRetryWait(retryAfter)}.`,
        });
      }
    }

    // --- 80% warning checks (request still allowed) ---
    const warnings = [];

    for (const { dimension, current, limit } of checks) {
      if (limit && limit > 0) {
        const pct = Math.round((current / limit) * 100);
        if (pct >= 80) {
          warnings.push({ dimension, current, limit, percentage: pct });
        }
      }
    }

    if (spendLimit && spendLimit > 0 && currentCost > 0) {
      const spendPct = Math.round((currentCost / spendLimit) * 100);
      if (spendPct >= 80) {
        warnings.push({
          dimension: "SPEND",
          current: currentCost,
          limit: spendLimit,
          percentage: spendPct,
        });
      }
    }

    if (warnings.length > 0) {
      res.setHeader("X-RateLimit-Warning", JSON.stringify(warnings));

      // Throttled logging: only log if no warning_80_pct for this user+dimension in the current window
      for (const w of warnings) {
        const windowStart =
          w.dimension === "RPM" || w.dimension === "TPM"
            ? minuteAgo
            : w.dimension === "SPEND"
              ? new Date(now.getFullYear(), now.getMonth(), 1)
              : dayStart;

        RateLimitEvent.countDocuments({
          userId,
          dimension: w.dimension,
          action: "warning_80_pct",
          createdAt: { $gte: windowStart },
        })
          .then((count) => {
            if (count === 0) {
              return RateLimitEvent.create({
                userId,
                userEmail: user.email,
                dimension: w.dimension,
                currentValue: w.dimension === "SPEND" ? Math.round(w.current * 100) : w.current,
                limitValue: w.dimension === "SPEND" ? Math.round(w.limit * 100) : w.limit,
                action: "warning_80_pct",
              });
            }
          })
          .catch((err) =>
            console.error("Failed to log 80% warning event:", err.message)
          );
      }
    }

    next();
  } catch (err) {
    console.error("checkRateLimit error (allowing request):", err.message);
    next();
  }
}
