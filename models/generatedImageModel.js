import mongoose from "mongoose";

const generatedImageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rootId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GeneratedImage",
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GeneratedImage",
      default: null,
      index: true,
    },
    versionNumber: { type: Number, required: true, default: 1 },
    operation: {
      type: String,
      enum: ["generate", "edit", "edit_with_mask"],
      required: true,
    },
    promptOriginal: { type: String, required: true },
    promptEnhanced: { type: String, default: null },
    promptSent: { type: String, required: true },
    model: { type: String, required: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceImageKey: { type: String, default: null },
    maskKey: { type: String, default: null },
    outputImageKey: { type: String, required: true },
    outputImageKeys: { type: [String], default: [] },
    openaiUsage: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["completed", "failed"],
      default: "completed",
    },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

generatedImageSchema.index({ userId: 1, createdAt: -1 });
generatedImageSchema.index({ rootId: 1, versionNumber: 1 });

const GeneratedImage = mongoose.model("GeneratedImage", generatedImageSchema);
export default GeneratedImage;
