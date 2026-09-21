import mongoose from "mongoose";

const agentPromptSchema = new mongoose.Schema(
  {
    agentName: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
  },
  { timestamps: true }
);

const AgentPrompt = mongoose.model("AgentPrompt", agentPromptSchema);
export default AgentPrompt;

