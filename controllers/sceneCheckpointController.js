/**
 * Phase 3 (optional) — Scene checkpoint endpoints.
 *
 * Only active when `isOliviaSceneCheckpointsEnabled()` (see constants/oliviaMemory.js).
 * Routes are wired in `novelRoute.js` but each endpoint short-circuits
 * with 404 when the flag is off so probing the API surface still
 * looks consistent across envs.
 */

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

import SceneCheckpoint from "../models/sceneCheckpointModel.js";
import StoryState from "../models/storyStateModel.js";
import ActiveSceneState from "../models/activeSceneStateModel.js";
import CharacterState from "../models/characterStateModel.js";
import RelationshipEdge from "../models/relationshipEdgeModel.js";
import ConversationCursor from "../models/conversationCursorModel.js";
import Novel from "../models/novelModel.js";

import { invalidateResponseChain } from "../service/memoryService.js";
import { invalidateAssemblerCache } from "../service/contextAssembler.js";
import { isOliviaSceneCheckpointsEnabled } from "../constants/oliviaMemory.js";

const FLAG_ON = () => isOliviaSceneCheckpointsEnabled();

const MAX_AUTO_CHECKPOINTS_PER_NOVEL = 20;

const ensureOwnedNovel = async (novelId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(novelId)) return null;
  const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id").lean();
  return novel;
};

/**
 * Internal helper — called by `saveOliviaScene` when the flag is on.
 * Snapshots the current story-state surface and the conversation
 * chain head, then trims old auto rows to keep storage bounded.
 *
 * Exposed (rather than living inline in the controller) so the same
 * function can be unit-tested and called by manual-checkpoint
 * endpoints with `createdBy: "manual"`.
 */
export const createCheckpoint = async ({
  novelId,
  userId,
  sceneRef,
  label = "",
  createdBy = "auto",
  threadId = null,
}) => {
  if (!FLAG_ON()) return null;

  const [storyState, activeScene, characterStates, edges, cursor] = await Promise.all([
    StoryState.findOne({ novelId }).lean(),
    ActiveSceneState.findOne({ novelId }).lean(),
    CharacterState.find({ novelId }).lean(),
    RelationshipEdge.find({ novelId }).lean(),
    threadId ? ConversationCursor.findOne({ threadId }).lean() : null,
  ]);

  const stripMeta = (doc) => {
    if (!doc) return null;
    const { _id, createdAt, updatedAt, __v, ...rest } = doc;
    return rest;
  };

  const checkpoint = await SceneCheckpoint.create({
    novelId,
    userId,
    sceneRef,
    label,
    createdBy,
    threadId,
    storyStateSnapshot: stripMeta(storyState),
    activeSceneStateSnapshot: stripMeta(activeScene),
    characterStateSnapshots: characterStates.map(stripMeta).filter(Boolean),
    relationshipEdgeSnapshots: edges.map(stripMeta).filter(Boolean),
    frozenLastResponseId: cursor?.lastResponseId || null,
    rollingSummarySnapshot: cursor?.rollingSummary || "",
  });

  if (createdBy === "auto") {
    // Cap-and-rotate: keep the last K auto rows per novel; never
    // touch manual rows.
    const autoRows = await SceneCheckpoint.find({ novelId, createdBy: "auto" })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();
    if (autoRows.length > MAX_AUTO_CHECKPOINTS_PER_NOVEL) {
      const stale = autoRows
        .slice(MAX_AUTO_CHECKPOINTS_PER_NOVEL)
        .map((r) => r._id);
      await SceneCheckpoint.deleteMany({ _id: { $in: stale } });
    }
  }

  return checkpoint;
};

export const listCheckpoints = asyncHandler(async (req, res) => {
  if (!FLAG_ON()) return res.status(404).json({ message: "Checkpoints not enabled" });
  const { novelId } = req.params;
  const userId = req.user._id;
  const novel = await ensureOwnedNovel(novelId, userId);
  if (!novel) return res.status(404).json({ message: "Novel not found" });

  const rows = await SceneCheckpoint.find({ novelId })
    .sort({ createdAt: -1 })
    .select("-storyStateSnapshot -activeSceneStateSnapshot -characterStateSnapshots -relationshipEdgeSnapshots")
    .lean();
  res.status(200).json({ checkpoints: rows });
});

export const createManualCheckpoint = asyncHandler(async (req, res) => {
  if (!FLAG_ON()) return res.status(404).json({ message: "Checkpoints not enabled" });
  const { novelId } = req.params;
  const { sceneRef, label = "", threadId = null } = req.body || {};
  const userId = req.user._id;
  const novel = await ensureOwnedNovel(novelId, userId);
  if (!novel) return res.status(404).json({ message: "Novel not found" });
  if (!sceneRef?.actNumber || !sceneRef?.sceneIndex) {
    return res.status(400).json({ message: "sceneRef.actNumber + sceneIndex required" });
  }

  const checkpoint = await createCheckpoint({
    novelId,
    userId,
    sceneRef,
    label,
    createdBy: "manual",
    threadId,
  });
  res.status(201).json({ checkpoint });
});

export const restoreCheckpoint = asyncHandler(async (req, res) => {
  if (!FLAG_ON()) return res.status(404).json({ message: "Checkpoints not enabled" });
  const { novelId, checkpointId } = req.params;
  const userId = req.user._id;
  const novel = await ensureOwnedNovel(novelId, userId);
  if (!novel) return res.status(404).json({ message: "Novel not found" });

  const cp = await SceneCheckpoint.findOne({ _id: checkpointId, novelId }).lean();
  if (!cp) return res.status(404).json({ message: "Checkpoint not found" });

  // Re-hydrate the four memory surfaces. Each restore is `findOneAndUpdate`
  // upsert (single-doc) or `bulkWrite` (multi-doc) so partial failures
  // are recoverable — log + continue rather than abort.
  const ops = [];
  if (cp.storyStateSnapshot) {
    ops.push(
      StoryState.findOneAndUpdate(
        { novelId },
        { $set: cp.storyStateSnapshot },
        { upsert: true, new: true }
      )
    );
  }
  if (cp.activeSceneStateSnapshot) {
    ops.push(
      ActiveSceneState.findOneAndUpdate(
        { novelId },
        { $set: cp.activeSceneStateSnapshot },
        { upsert: true, new: true }
      )
    );
  }

  // CharacterState: clear current + insert frozen.
  ops.push(
    (async () => {
      await CharacterState.deleteMany({ novelId });
      if (cp.characterStateSnapshots?.length) {
        await CharacterState.insertMany(cp.characterStateSnapshots, {
          ordered: false,
        }).catch((err) => {
          console.warn("restoreCheckpoint: insertMany(CharacterState) partial failure:", err?.message || err);
        });
      }
    })()
  );

  ops.push(
    (async () => {
      await RelationshipEdge.deleteMany({ novelId });
      if (cp.relationshipEdgeSnapshots?.length) {
        await RelationshipEdge.insertMany(cp.relationshipEdgeSnapshots, {
          ordered: false,
        }).catch((err) => {
          console.warn(
            "restoreCheckpoint: insertMany(RelationshipEdge) partial failure:",
            err?.message || err
          );
        });
      }
    })()
  );

  await Promise.all(ops);

  // Reset the Olivia conversation chain to the frozen response id.
  // First invalidate any in-flight chain so the next turn doesn't
  // accidentally extend the old chain.
  if (cp.threadId) {
    await invalidateResponseChain(cp.threadId);
    await ConversationCursor.updateOne(
      { threadId: cp.threadId },
      {
        $set: {
          lastResponseId: cp.frozenLastResponseId || null,
          lastResponseIdAt: cp.frozenLastResponseId ? new Date() : null,
          lastResponseIdExpired: false,
          rollingSummary: cp.rollingSummarySnapshot || "",
        },
      }
    );
  }

  // Drop the in-process assembler cache so the next turn re-reads.
  invalidateAssemblerCache((key) => key.startsWith(`${String(novelId)}|`));

  res.status(200).json({
    message: "Checkpoint restored",
    sceneRef: cp.sceneRef,
    restoredAt: new Date().toISOString(),
  });
});

export const deleteCheckpoint = asyncHandler(async (req, res) => {
  if (!FLAG_ON()) return res.status(404).json({ message: "Checkpoints not enabled" });
  const { novelId, checkpointId } = req.params;
  const userId = req.user._id;
  const novel = await ensureOwnedNovel(novelId, userId);
  if (!novel) return res.status(404).json({ message: "Novel not found" });

  const result = await SceneCheckpoint.deleteOne({ _id: checkpointId, novelId });
  if (result.deletedCount === 0) {
    return res.status(404).json({ message: "Checkpoint not found" });
  }
  res.status(200).json({ message: "Checkpoint deleted" });
});
