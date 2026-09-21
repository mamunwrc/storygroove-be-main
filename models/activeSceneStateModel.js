import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * ActiveSceneState — singleton per novel. Tracks what scene the writer
 * is currently working on, who's on stage, the current goal/tone, and
 * any open threads carried in from prior scenes.
 *
 * Updated by:
 *   - `memoryWorker.extractStateUpdates` on chat-turn completion (lightweight)
 *   - `saveOliviaScene` hook on scene close (authoritative)
 *   - `memoryInvalidator.onSceneEdit/Delete/Restore` on outline mutations
 */
const activeSceneStateSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      unique: true,
    },

    currentScene: {
      type: {
        actNumber: { type: Number },
        sceneIndex: { type: Number },
      },
      default: null,
    },

    location: { type: String, default: "" },
    activeCharacterIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Character" }],
      default: [],
    },
    sceneGoal: { type: String, default: "" },
    emotionalTone: { type: String, default: "" },
    openThreads: { type: [String], default: [] },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },

    lastUpdatedSource: {
      type: String,
      enum: ["scene_close", "chat_turn", "manual", "restore"],
      default: "manual",
    },
  },
  { timestamps: true }
);

const ActiveSceneState = mongoose.model(
  "ActiveSceneState",
  activeSceneStateSchema
);
export default ActiveSceneState;
