import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * StoryState — singleton per novel. Tracks long-arc story shape and the
 * current layering phase so the assembler can inject the right phase
 * rules.
 *
 * The `layeringPhase` enum is the contract between this model and:
 *   - `methodologyService.getRulesForPhase` (Phase 1.5B)
 *   - the phase split of `OLIVIA_EDITOR_LAYERING_RUNTIME_RULES`
 *     (Phase 2 task `phase2-layering-phase`)
 *
 * `outlining` was added in Phase 1.5A to model "pre-spine" work the
 * v5_MP methodology rules cover. New novels default to `outlining` so
 * the assembler has something to dispatch on before any scenes are
 * delivered.
 */
const storyStateSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      unique: true,
    },

    currentArc: { type: String, default: "" },
    sceneGoal: { type: String, default: "" },
    chapterGoal: { type: String, default: "" },
    emotionalState: { type: String, default: "" },

    pacing: {
      type: String,
      enum: ["slow", "medium", "fast"],
      default: "medium",
    },

    layeringPhase: {
      type: String,
      enum: [
        "outlining",
        "phase1_table",
        "phase2_expansion",
        "coaching",
        "drafting",
      ],
      default: "outlining",
    },

    /** Free-form directives the model should not contradict. */
    narrativeDirectives: { type: [String], default: [] },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },
  },
  { timestamps: true }
);

const StoryState = mongoose.model("StoryState", storyStateSchema);
export default StoryState;
