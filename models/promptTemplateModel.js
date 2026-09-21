import mongoose from "mongoose";
import {
  MEMORY_SCHEMA_VERSION,
  METHODOLOGY_VERSION,
} from "../constants/models.js";

/**
 * PromptTemplate — the 15 base scene prompts from v5_MP.pdf
 * (Prompts #3–#17) paired with the matching per-scene coaching beat
 * from Olivia's 15-Scene Novel Blueprint.
 *
 * Looked up by `sceneIndex` so the assembler can inject the right
 * template for the focus scene without scanning the whole table.
 */
const promptTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    sceneIndex: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      max: 15,
    },
    actNumber: { type: Number, required: true, min: 1, max: 3 },
    title: { type: String, required: true },

    /** Prompt #N text with `[Protagonist]` placeholder. */
    template: { type: String, required: true },
    /** Per-scene coaching prose from the 15-Scene Novel Blueprint. */
    coachingPrompt: { type: String, default: "" },
    /** Subplot tie-in reminder, also from the Blueprint. */
    subplotReminder: { type: String, default: "" },

    /**
     * One of:
     *   inciting_incident / first_reversal / midpoint / dark_night /
     *   climax / resolution. `null` when this scene is not a tentpole.
     */
    tentpoleHint: {
      type: String,
      enum: [
        "inciting_incident",
        "first_reversal",
        "midpoint",
        "dark_night",
        "climax",
        "resolution",
        null,
      ],
      default: null,
    },

    /** Bulleted section labels for scene delivery output. */
    outputFormatLabels: { type: [String], default: [] },

    enabled: { type: Boolean, default: true },
    source: { type: String, default: "" },

    methodologyVersion: {
      type: Number,
      default: () => METHODOLOGY_VERSION,
    },
    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },
  },
  { timestamps: true }
);

promptTemplateSchema.index({ enabled: 1, sceneIndex: 1 });

const PromptTemplate = mongoose.model(
  "PromptTemplate",
  promptTemplateSchema
);
export default PromptTemplate;
