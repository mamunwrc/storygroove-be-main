import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import NovelCoverVersion from "../models/novelCoverVersionModel.js";
import Subscriber from "../models/subscriberModel.js";

export const isCoverQuotaExempt = (role) => role === "superadmin";

/**
 * Resolve the billing period for cover render quota counting.
 * Active subscriber: period ends at cycleEndingOn, starts one calendar month prior.
 * Fallback: calendar month (trial / no subscriber).
 */
export async function resolveBillingPeriod(userId) {
  const now = new Date();

  const subscriber = await Subscriber.findOne({
    userid: userId,
    cycleEndingOn: { $gt: now },
    subscription_status: { $in: ["active", "trialing", "past_due"] },
  })
    .select("cycleEndingOn")
    .lean();

  if (subscriber?.cycleEndingOn) {
    const periodEnd = new Date(subscriber.cycleEndingOn);
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);
    return {
      periodStart,
      periodEnd,
      resetsAt: periodEnd,
      source: "billing",
    };
  }

  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    periodStart,
    periodEnd,
    resetsAt: periodEnd,
    source: "calendar",
  };
}

/**
 * @returns {{ used: number, limit: number, remaining: number, resetsAt: Date, periodStart: Date, periodEnd: Date, unlimited: boolean }}
 */
export async function getCoverRenderUsage(userId, { role } = {}) {
  if (isCoverQuotaExempt(role)) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      used: 0,
      limit: null,
      remaining: null,
      resetsAt: periodEnd,
      periodStart,
      periodEnd,
      unlimited: true,
    };
  }

  const { periodStart, periodEnd, resetsAt } = await resolveBillingPeriod(userId);

  const settings = await ApiUsageSettings.getSettings();
  const limit = settings.coverRendersPerBillingPeriod ?? 10;
  const unlimited = limit === 0;

  const used = await NovelCoverVersion.countDocuments({
    userId,
    createdAt: { $gte: periodStart, $lt: periodEnd },
  });

  return {
    used,
    limit: unlimited ? null : limit,
    remaining: unlimited ? null : Math.max(0, limit - used),
    resetsAt,
    periodStart,
    periodEnd,
    unlimited,
  };
}

export class CoverRenderQuotaError extends Error {
  constructor({ used, limit, resetsAt }) {
    super("Cover render quota exceeded");
    this.name = "CoverRenderQuotaError";
    this.statusCode = 429;
    this.used = used;
    this.limit = limit;
    this.resetsAt = resetsAt;
  }
}

/**
 * @throws {CoverRenderQuotaError}
 */
export async function assertCanRender(userId, { role } = {}) {
  if (isCoverQuotaExempt(role)) {
    return getCoverRenderUsage(userId, { role });
  }
  const usage = await getCoverRenderUsage(userId, { role });
  if (usage.unlimited) return usage;
  if (usage.used >= usage.limit) {
    throw new CoverRenderQuotaError({
      used: usage.used,
      limit: usage.limit,
      resetsAt: usage.resetsAt,
    });
  }
  return usage;
}
