/**
 * Ensure StoryState exists before Olivia V2 assembler runs.
 */

import StoryState from "../models/storyStateModel.js";

/**
 * @param {string} novelId
 * @returns {Promise<import('mongoose').LeanDocument>}
 */
export const ensureStoryStateForNovel = async (novelId) => {
  const existing = await StoryState.findOne({ novelId }).lean();
  if (existing) return existing;

  const created = await StoryState.findOneAndUpdate(
    { novelId },
    { $setOnInsert: { novelId, layeringPhase: "outlining" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return created;
};
