import mongoose from "mongoose";

const novelCoverVersionSchema = new mongoose.Schema(
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
      index: true,
    },
    /** S3 key without leading slash, e.g. userData/{userId}/covers/... */
    s3Key: { type: String, required: true },
    versionNumber: { type: Number, required: true },
    typographyPalette: { type: [String], default: [] },
    comparables: { type: [String], default: [] },
    userPrompt: { type: String, default: null },
    assistantNote: { type: String, default: null },
    sourceHint: {
      type: String,
      enum: ["outline", "manuscript"],
      default: "outline",
    },
    parentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NovelCoverVersion",
      default: null,
    },
    operation: {
      type: String,
      enum: ["generate", "edit", "edit_with_mask"],
      default: "generate",
    },
    generatedImageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GeneratedImage",
      default: null,
    },
    promptEnhanced: { type: String, default: null },
    settings: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

novelCoverVersionSchema.index({ novelId: 1, versionNumber: -1 });
novelCoverVersionSchema.index({ userId: 1, createdAt: -1 });

const NovelCoverVersion = mongoose.model(
  "NovelCoverVersion",
  novelCoverVersionSchema
);
export default NovelCoverVersion;
