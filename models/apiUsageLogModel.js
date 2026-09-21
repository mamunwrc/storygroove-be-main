import mongoose from "mongoose";

const apiUsageLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    model: {
      type: String,
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    /** Subset of promptTokens served from the OpenAI prompt cache (billed at the cachedInput rate). */
    cachedInputTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    /** Image-modality input tokens (reference images uploaded to gpt-image-*). */
    imageInputTokens: {
      type: Number,
      default: 0,
    },
    imageCachedInputTokens: {
      type: Number,
      default: 0,
    },
    /** Image-modality output tokens (generated image bytes converted into the model's image-token unit). */
    imageOutputTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    /** Number of generated images (informational; cost is computed from imageOutputTokens). */
    imageCount: {
      type: Number,
      default: 0,
    },
    cost: {
      type: Number,
      default: 0,
    },
    rateLimitDimension: {
      type: String,
      enum: ["RPM", "RPD", "TPM", "TPD", null],
      default: null,
    },
    wasRateLimited: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

apiUsageLogSchema.index({ createdAt: -1 });
apiUsageLogSchema.index({ userId: 1, createdAt: -1 });

const ApiUsageLog = mongoose.model("ApiUsageLog", apiUsageLogSchema);
export default ApiUsageLog;
