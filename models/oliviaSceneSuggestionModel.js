import mongoose from "mongoose";

const OliviaSceneSuggestionSchema = new mongoose.Schema(
  {
    novel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scene_index: {
      type: Number,
      required: true,
    },
    book_coaching: {
      type: String,
      default: null,
    },
    subplot_reminder: {
      type: String,
      default: null,
    },
    genre_specific_coaching: {
      type: String,
      default: null,
    },
    target_word_count: {
      type: Number,
      default: null,
    },
    structural_role: {
      type: String,
      required: true,
    },
    what_happens: {
      type: String,
      required: true,
    },
    setting: {
      type: String,
      default: null,
    },
    significant_actions: {
      type: String,
      default: null,
    },
    protagonist_emotional_shift: {
      type: String,
      required: true,
    },
    emotional_reactions: {
      type: String,
      default: null,
    },
    plot_advancement: {
      type: String,
      required: true,
    },
    subplot_integration: {
      type: String,
      default: null,
    },
    character_arc_movement: {
      type: String,
      default: null,
    },
    craft_or_coaching_note: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index for efficient queries
OliviaSceneSuggestionSchema.index({ novel: 1, scene_index: 1 }, { unique: true });
OliviaSceneSuggestionSchema.index({ novel: 1, user: 1 });

const OliviaSceneSuggestion = mongoose.model("OliviaSceneSuggestion", OliviaSceneSuggestionSchema);
export default OliviaSceneSuggestion;

