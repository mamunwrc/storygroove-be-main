import mongoose from "mongoose";

const EllisSceneReviewSchema = new mongoose.Schema(
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
    chapter_label: {
      type: String,
      default: null,
    },
    pov: {
      type: String,
      default: null,
    },
    scene_status: {
      type: String,
      enum: ["Analyzed", "Not Present in Manuscript"],
      required: true,
    },
    function_in_story: {
      type: String,
      required: true,
    },
    genre_beat_check: {
      type: String,
      required: true,
    },
    structure_evaluation: {
      type: String,
      enum: ["Keep", "Tighten", "Rewrite", "Move", "Cut"],
      required: true,
    },
    character_evaluation: {
      type: String,
      enum: ["Keep", "Deepen", "Rework"],
      required: true,
    },
    scene_analysis: {
      type: String,
      required: true,
    },
    creative_suggestions: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

// Compound index for efficient queries
EllisSceneReviewSchema.index({ novel: 1, scene_index: 1 }, { unique: true });
EllisSceneReviewSchema.index({ novel: 1, user: 1 });

const EllisSceneReview = mongoose.model("EllisSceneReview", EllisSceneReviewSchema);
export default EllisSceneReview;

