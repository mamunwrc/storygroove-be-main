import mongoose from "mongoose";

const userAgentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    agentName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    assistantId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

userAgentSchema.index({ userId: 1, agentName: 1 }, { unique: true });

const UserAgent = mongoose.model("UserAgent", userAgentSchema);
export default UserAgent;

