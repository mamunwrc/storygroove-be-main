import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * RelationshipEdge — directed edge from one character to another that
 * captures sentiment + trust + edge type. Promoted from Phase 3 to
 * Phase 2 so the trust/sentiment graph lives in one place from day
 * one. Phase 2 ships direct edge queries (assembler's relevant-
 * relationships block); Phase 3 layers in multi-hop traversal.
 *
 * `evidenceSceneRefs` lets the worker undo / recompute the edge when
 * a contributing scene is deleted or rewritten — the invalidator
 * filters them out and triggers re-extraction over the remaining
 * evidence.
 *
 * Edge writes are `lastUpdatedSceneRef`-gated so older scenes can't
 * overwrite newer state when a backfill or out-of-order re-extraction
 * runs.
 */
const sceneRefSubschema = {
  actNumber: { type: Number },
  sceneIndex: { type: Number },
  episodicEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EpisodicEvent",
  },
};

const relationshipEdgeSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    srcCharacterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Character",
      required: true,
    },
    dstCharacterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Character",
      required: true,
    },

    type: {
      type: String,
      enum: [
        "trust",
        "affection",
        "enmity",
        "family",
        "professional",
        "romantic",
        "unknown",
      ],
      default: "unknown",
    },

    /** Range: -100..100. Used by the ranking formula. */
    sentiment: { type: Number, default: 0, min: -100, max: 100 },
    /** Range: 0..100. Used by the ranking formula. */
    trust: { type: Number, default: 50, min: 0, max: 100 },

    evidenceSceneRefs: {
      type: [sceneRefSubschema],
      default: [],
    },

    lastUpdatedSceneRef: {
      type: {
        actNumber: { type: Number },
        sceneIndex: { type: Number },
      },
      default: null,
    },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },
  },
  { timestamps: true }
);

relationshipEdgeSchema.index(
  { novelId: 1, srcCharacterId: 1, dstCharacterId: 1, type: 1 },
  { unique: true }
);
relationshipEdgeSchema.index({ novelId: 1, srcCharacterId: 1 });
relationshipEdgeSchema.index({ novelId: 1, dstCharacterId: 1 });

const RelationshipEdge = mongoose.model(
  "RelationshipEdge",
  relationshipEdgeSchema
);
export default RelationshipEdge;
