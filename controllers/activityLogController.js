import mongoose from "mongoose";
import ActivityLog from "../models/activityLogModel.js";
import User from "../models/user.js";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_MODULES,
  ACTIVITY_SOURCES,
} from "../constants/activityLog.js";

const MAX_EMAIL_USER_MATCHES = 100;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listActivityLogs(req, res) {
  try {
    const {
      module: moduleFilter,
      action: actionFilter,
      userId: userIdFilter,
      email: emailFilter,
      source: sourceFilter,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    const filter = {};

    if (moduleFilter && typeof moduleFilter === "string" && moduleFilter.trim()) {
      filter.module = moduleFilter.trim();
    }
    if (actionFilter && typeof actionFilter === "string" && actionFilter.trim()) {
      filter.action = actionFilter.trim();
    }
    if (sourceFilter && typeof sourceFilter === "string" && sourceFilter.trim()) {
      filter.source = sourceFilter.trim();
    }

    // userId — only accept valid 24-char hex ObjectIds. (Mongoose's isValid
    // also matches 12-byte strings which produces false positives in URLs.)
    if (userIdFilter && typeof userIdFilter === "string") {
      const uid = userIdFilter.trim();
      if (/^[a-f0-9]{24}$/i.test(uid)) {
        filter.userId = new mongoose.Types.ObjectId(uid);
      }
    }

    // email — resolve to a set of userIds via a partial, case-insensitive match.
    // Capped to prevent unbounded $in clauses on huge tenants.
    if (emailFilter && typeof emailFilter === "string" && emailFilter.trim()) {
      const needle = escapeRegex(emailFilter.trim());
      const users = await User.find(
        { email: { $regex: needle, $options: "i" } },
        { _id: 1 }
      )
        .limit(MAX_EMAIL_USER_MATCHES)
        .lean();
      const ids = users.map((u) => u._id);
      if (ids.length === 0) {
        return res.status(200).json({
          logs: [],
          pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 1 },
          facets: getFacets(),
        });
      }
      // Compose with an existing userId filter if one was passed.
      if (filter.userId) {
        const matchesExisting = ids.some((id) => id.equals(filter.userId));
        if (!matchesExisting) {
          return res.status(200).json({
            logs: [],
            pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 1 },
            facets: getFacets(),
          });
        }
      } else {
        filter.userId = { $in: ids };
      }
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const d = new Date(startDate);
        if (!Number.isNaN(d.getTime())) filter.createdAt.$gte = d;
      }
      if (endDate) {
        const d = new Date(endDate);
        if (!Number.isNaN(d.getTime())) {
          const end = new Date(d);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    const [total, logs] = await Promise.all([
      ActivityLog.countDocuments(filter),
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("userId", "fname lname email username")
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    return res.status(200).json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
      facets: getFacets(),
    });
  } catch (e) {
    console.error("listActivityLogs error:", e);
    return res.status(500).json({
      error: "Failed to fetch activity logs",
      message: e.message,
    });
  }
}

function getFacets() {
  return {
    modules: ACTIVITY_MODULES,
    actions: ACTIVITY_ACTIONS,
    sources: ACTIVITY_SOURCES,
  };
}
