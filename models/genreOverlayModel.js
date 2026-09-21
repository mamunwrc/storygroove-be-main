import mongoose from "mongoose";
import {
  MEMORY_SCHEMA_VERSION,
  METHODOLOGY_VERSION,
} from "../constants/models.js";

/**
 * GenreOverlay — genre, audience, and structural overlays from
 * v5_MP.pdf. Each row holds an array of `beats[]` keyed by scene
 * index (or scene range) describing genre-specific layering on top
 * of the base 15-scene spine.
 *
 * Composition: a "YA Urban Fantasy" novel applies both the
 * `ya_audience` row (additional_overlay) AND the `urban_fantasy` row
 * (base_genre). The assembler renders them in order so beats
 * collide deterministically.
 *
 * Fuzzy lookup uses `genreKey` exact match first, then `aliases`
 * (lowercased + whitespace-stripped + token overlap). Falls back to
 * a category match. Never returns "unsupported" — the methodology
 * mandates closest-match routing.
 */
const beatSchema = new mongoose.Schema(
  {
    sceneIndex: { type: Number, min: 1, max: 15, default: null },
    sceneRange: {
      from: { type: Number, min: 1, max: 15 },
      to: { type: Number, min: 1, max: 15 },
    },
    label: { type: String, default: "" },
    beat: { type: String, required: true },
  },
  { _id: false }
);

const genreOverlaySchema = new mongoose.Schema(
  {
    genreKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: { type: String, required: true },

    category: {
      type: String,
      enum: [
        "romance",
        "mystery",
        "speculative",
        "realistic",
        "audience",
        "structural",
      ],
      required: true,
    },

    /**
     * `base_genre` — replaces no scene, layers beats over the spine.
     * `additional_overlay` — composes with a base_genre (e.g. YA on top of
     * Urban Fantasy).
     */
    appliesAs: {
      type: String,
      enum: ["base_genre", "additional_overlay"],
      required: true,
    },

    beats: { type: [beatSchema], default: [] },
    notes: { type: String, default: "" },

    /**
     * Variant spellings + plain-English labels for fuzzy lookup.
     * The methodology service lowercases + strips whitespace before
     * matching.
     */
    aliases: { type: [String], default: [] },

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

genreOverlaySchema.index({ category: 1, enabled: 1 });
genreOverlaySchema.index({ aliases: 1 });

const GenreOverlay = mongoose.model("GenreOverlay", genreOverlaySchema);
export default GenreOverlay;
