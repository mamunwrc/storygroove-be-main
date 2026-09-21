/**
 * Paginated reads of Olivia chat `Message` rows for a thread.
 * Returns the most recent page by default; `before` walks backward in time.
 */

import mongoose from "mongoose";
import Message from "../models/messageModel.js";
import {
  OLIVIA_HISTORY_DEFAULT_LIMIT,
  parseOliviaHistoryLimit,
} from "../constants/oliviaChatHistory.js";

const sortNewestFirst = { timestamp: -1, _id: -1 };

const normalizeBeforeId = (before) => {
  if (!before) return null;
  const s = String(before).trim();
  if (!s || !mongoose.Types.ObjectId.isValid(s)) return null;
  return s;
};

const buildOlderThanFilter = (threadId, anchor) => {
  const anchorId = anchor._id;
  const anchorTs = anchor.timestamp ? new Date(anchor.timestamp) : new Date(0);
  return {
    threadId,
    $or: [
      { timestamp: { $lt: anchorTs } },
      { timestamp: anchorTs, _id: { $lt: anchorId } },
    ],
  };
};

const probeHasMore = async (threadId, oldestInPage) => {
  if (!oldestInPage?._id) return false;
  const exists = await Message.exists(buildOlderThanFilter(threadId, oldestInPage));
  return Boolean(exists);
};

/**
 * @param {Object} args
 * @param {string} args.threadId
 * @param {number|string=} args.limit
 * @param {string=} args.before Mongo _id of the oldest message the client already has
 * @returns {Promise<{ messages: object[], hasMore: boolean }>}
 */
export const fetchThreadMessagePage = async ({
  threadId,
  limit,
  before = null,
}) => {
  if (!threadId) {
    return { messages: [], hasMore: false };
  }

  const pageLimit = parseOliviaHistoryLimit(limit, OLIVIA_HISTORY_DEFAULT_LIMIT);
  const beforeId = normalizeBeforeId(before);

  let query = { threadId };

  if (beforeId) {
    const anchor = await Message.findOne({ _id: beforeId, threadId }).lean();
    if (!anchor) {
      return { messages: [], hasMore: false };
    }
    query = buildOlderThanFilter(threadId, anchor);
  }

  const pageDesc = await Message.find(query)
    .sort(sortNewestFirst)
    .limit(pageLimit)
    .lean();

  const messages = [...pageDesc].reverse();
  const oldestInPage = messages[0] || null;
  const hasMore =
    pageDesc.length === pageLimit
      ? await probeHasMore(threadId, oldestInPage)
      : false;

  return { messages, hasMore };
};
