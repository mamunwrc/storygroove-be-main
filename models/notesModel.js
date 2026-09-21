import mongoose from "mongoose";

const NotesSchema = new mongoose.Schema(
  {
    novelId: { type: mongoose.Schema.Types.ObjectId, ref: "Novel", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, required: true },
    /** null / absent = legacy novel-wide note; set for per-scene notes in Book Editor */
    userContentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserContent",
      default: null,
    },
    promptKey: { type: String, default: null },
  },
  { timestamps: true }
);

NotesSchema.index({ novelId: 1, user: 1, userContentId: 1 }, { unique: true });

const Notes = mongoose.model("Notes", NotesSchema);
export default Notes;