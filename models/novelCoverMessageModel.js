import mongoose from "mongoose";

const novelCoverMessageSchema = new mongoose.Schema(
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
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    text: { type: String, required: true },
    kind: {
      type: String,
      enum: ["chat", "render_notice", "welcome"],
      default: "chat",
    },
    coverVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NovelCoverVersion",
      default: null,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

novelCoverMessageSchema.index({ novelId: 1, createdAt: 1 });

const NovelCoverMessage = mongoose.model(
  "NovelCoverMessage",
  novelCoverMessageSchema
);
export default NovelCoverMessage;
