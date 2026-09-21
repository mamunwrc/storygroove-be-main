import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * CharacterState — one document per (novel × character).
 *
 * Holds **self-state only** (mood, goal, secrets, location, last seen).
 * Inter-character trust / sentiment lives in `RelationshipEdge` so the
 * graph is queryable without exploding `CharacterState` into a Cartesian
 * product per scene.
 */
const characterStateSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    characterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Character",
      required: true,
    },

    mood: { type: String, default: "" },
    goal: { type: String, default: "" },
    secrets: { type: [String], default: [] },

    currentLocationHint: { type: String, default: "" },
    lastSeenSceneRef: {
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

characterStateSchema.index({ novelId: 1, characterId: 1 }, { unique: true });

const CharacterState = mongoose.model("CharacterState", characterStateSchema);
export default CharacterState;
