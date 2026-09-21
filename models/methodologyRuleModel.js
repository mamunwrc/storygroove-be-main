import mongoose from "mongoose";
import {
  MEMORY_SCHEMA_VERSION,
  METHODOLOGY_VERSION,
} from "../constants/models.js";

/**
 * MethodologyRule — universal and phase-scoped craft rules sourced
 * from the two methodology PDFs (`olivia-brain.pdf`, `v5_MP.pdf`).
 *
 * The assembler queries:
 *   { (scope: "universal") OR (scope: "phase", phase: <currentPhase>) }
 *   AND enabled: true
 *   sorted by priority desc
 *
 * Seeded by `scripts/seedMethodologyFromJson.js` from
 * `seed/olivia-methodology/methodology-rules.json`. Admin CRUD
 * (optional Phase 1.5C) mirrors the existing `AgentPrompt` admin
 * pattern.
 */
const methodologyRuleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true },

    /** Rule prose — kept ≤ ~2KB; longer rules should be split. */
    text: { type: String, required: true },
    /** One-line fallback used when the token budget is tight. */
    summary: { type: String, default: "" },

    scope: {
      type: String,
      enum: ["universal", "phase"],
      required: true,
    },
    /**
     * Required when scope === "phase". Multi-valued because a single
     * rule can apply across more than one phase (e.g. "scene format"
     * applies in both `phase2_expansion` and `drafting`).
     */
    phase: {
      type: [
        {
          type: String,
          enum: [
            "outlining",
            "phase1_table",
            "phase2_expansion",
            "coaching",
            "drafting",
          ],
        },
      ],
      default: [],
    },

    /** 1–100; higher = injected earlier; demoted first on budget pressure. */
    priority: { type: Number, default: 50, min: 1, max: 100 },

    enabled: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },

    /** Provenance: e.g. "olivia-brain.pdf#scene_layering_quality_gate". */
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

methodologyRuleSchema.index({ scope: 1, phase: 1, enabled: 1, priority: -1 });

const MethodologyRule = mongoose.model(
  "MethodologyRule",
  methodologyRuleSchema
);
export default MethodologyRule;
