import mongoose from "mongoose";
import { ACTIVITY_LIMITS } from "../constants/activityLog.js";

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: ACTIVITY_LIMITS.ACTION_MAX,
    },
    module: {
      type: String,
      required: true,
      trim: true,
      maxlength: ACTIVITY_LIMITS.MODULE_MAX,
    },
    description: {
      type: String,
      required: true,
      maxlength: ACTIVITY_LIMITS.DESCRIPTION_MAX,
    },
    /**
     * Promoted from metadata so admins can filter by it directly and so we
     * can index it. Examples: "api", "model_middleware", "dashboard_projects_list".
     */
    source: {
      type: String,
      default: null,
      maxlength: ACTIVITY_LIMITS.SOURCE_MAX,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: null,
      maxlength: ACTIVITY_LIMITS.IP_MAX,
    },
    userAgent: {
      type: String,
      default: null,
      maxlength: ACTIVITY_LIMITS.USER_AGENT_MAX,
    },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ module: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ source: 1, createdAt: -1 });

/**
 * Optional retention. If `ACTIVITY_LOG_TTL_DAYS` is set (positive integer)
 * MongoDB will automatically expire documents older than that many days.
 * Unset → no expiry (logs are retained indefinitely).
 *
 * NOTE: TTL indexes only take effect on the deployment that creates them.
 * Changing the value later requires dropping and recreating the index.
 */
const ttlDays = Number(process.env.ACTIVITY_LOG_TTL_DAYS);
if (Number.isFinite(ttlDays) && ttlDays > 0) {
  activityLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: Math.floor(ttlDays * 24 * 60 * 60) }
  );
}

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
