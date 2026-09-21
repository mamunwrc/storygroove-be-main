import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * EpisodicEvent — high-importance moments extracted from finalized
 * scenes (deaths, betrayals, revelations, reunions, promises, losses,
 * transformations, …).
 *
 * The assembler ranks these via `constants/memoryRanking.js` and pulls
 * the top-K per turn so Olivia can keep continuity without re-reading
 * the raw scene prose.
 *
 * Deduplication: `derivedFromHash` is the sha1 of the snippet the
 * extractor was working from; the worker upserts on (novelId, sceneRef,
 * derivedFromHash) so re-extraction is idempotent.
 */
const episodicEventSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },

    sceneRef: {
      actNumber: { type: Number, required: true },
      sceneIndex: { type: Number, required: true },
    },

    eventType: {
      type: String,
      enum: [
        "death",
        "betrayal",
        "revelation",
        "reunion",
        "promise",
        "loss",
        "transformation",
        "other",
      ],
      default: "other",
    },

    summary: { type: String, required: true },

    characterIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Character" }],
      default: [],
    },

    /** 1–10 — used by the ranking formula. */
    importance: { type: Number, default: 5, min: 1, max: 10 },

    tags: { type: [String], default: [] },

    /**
     * Scenes that have later referenced this event (echo / callback).
     * The ranking formula uses this to keep "load-bearing" events at
     * the top of retrieval results.
     */
    referencedAtSceneRefs: {
      type: [
        {
          actNumber: { type: Number },
          sceneIndex: { type: Number },
        },
      ],
      default: [],
    },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },

    extractionStatus: {
      type: String,
      enum: ["ok", "stale", "deleted"],
      default: "ok",
    },

    /**
     * SHA-1 over the snippet the extractor read. Used by both
     * de-duplication (worker upsert key) and invalidation (the
     * invalidator marks rows whose source hash no longer matches the
     * current scene text as `stale`).
     */
    derivedFromHash: { type: String, default: null },
  },
  { timestamps: true }
);

episodicEventSchema.index({ novelId: 1, importance: -1 });
episodicEventSchema.index({ novelId: 1, characterIds: 1 });
episodicEventSchema.index(
  { novelId: 1, "sceneRef.actNumber": 1, "sceneRef.sceneIndex": 1 }
);
episodicEventSchema.index(
  { novelId: 1, "sceneRef.actNumber": 1, "sceneRef.sceneIndex": 1, derivedFromHash: 1 },
  { unique: true, sparse: true }
);

const EpisodicEvent = mongoose.model("EpisodicEvent", episodicEventSchema);
export default EpisodicEvent;
