import mongoose from "mongoose";

const rateLimitEventSchema = new mongoose.Schema(
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
    dimension: {
      type: String,
      enum: ["RPM", "RPD", "TPM", "TPD", "SPEND", "BLOCKED"],
      required: true,
    },
    currentValue: {
      type: Number,
      required: true,
    },
    limitValue: {
      type: Number,
      required: true,
    },
    action: {
      type: String,
      enum: ["request_rejected", "user_notified", "auto_blocked", "warning_80_pct"],
      required: true,
    },
  },
  { timestamps: true }
);

rateLimitEventSchema.index({ createdAt: -1 });

const RateLimitEvent = mongoose.model("RateLimitEvent", rateLimitEventSchema);
export default RateLimitEvent;
