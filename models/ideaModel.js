import mongoose from "mongoose";

const IdeaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, default: "Untitled Idea" },
    /** Quill HTML body for the Capture an Idea notepad */
    content: { type: String, default: "" },
  },
  { timestamps: true }
);

IdeaSchema.index({ user: 1, updatedAt: -1 });

const Idea = mongoose.model("Idea", IdeaSchema);
export default Idea;
