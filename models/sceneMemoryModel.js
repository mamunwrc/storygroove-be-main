import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * SceneMemory — one document per finalized scene (act × sceneIndex).
 * Created by `memoryWorker.summarizeScene` on every scene close and on
 * any invalidation that recomputes from the canonical `StoryResponse`.
 *
 * The assembler reads these instead of the raw scene prose so the
 * prompt stays bounded as outlines fill out.
 *
 * Failure semantics: if extraction fails, the prior row is left intact
 * and `extractionStatus` is flipped to `"failed"` (with `lastFailedAt`)
 * so the assembler can fall back to a raw excerpt with a quality note.
 */
const sceneMemorySchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    sceneRef: {
      actNumber: { type: Number, required: true },
      sceneIndex: { type: Number, required: true },
      promptKey: { type: String, required: true },
    },

    title: { type: String, default: "" },
    pov: { type: String, default: "" },

    /** Tight prose summary ≤ ~200 words, used by the assembler. */
    summary: { type: String, default: "" },

    /** Material state changes extracted from the scene. */
    stateChanges: { type: [String], default: [] },
    /** Open threads / hooks that follow into later scenes. */
    unresolvedThreads: { type: [String], default: [] },
    /** Concrete facts the model must remember (names, dates, items). */
    importantFacts: { type: [String], default: [] },

    wordCount: { type: Number, default: 0 },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },

    extractionStatus: {
      type: String,
      enum: ["ok", "failed", "stale"],
      default: "ok",
    },
    lastFailedAt: { type: Date, default: null },

    /**
     * SHA-1 of the source `StoryResponse.responseText` this row was
     * derived from. The invalidator compares hashes on scene edit to
     * detect drift and mark this row stale.
     */
    sourceHash: { type: String, default: null },
  },
  { timestamps: true }
);

sceneMemorySchema.index(
  { novelId: 1, "sceneRef.actNumber": 1, "sceneRef.sceneIndex": 1 },
  { unique: true }
);

const SceneMemory = mongoose.model("SceneMemory", sceneMemorySchema);
export default SceneMemory;
