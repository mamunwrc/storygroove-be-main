import mongoose from "mongoose";

const StoryResponseSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: "Novel", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    promptKey: { type: String, required: true },
    responseText: { type: String, required: true },
    /** Set when the response is "deleted"; retained for restore / purge jobs. */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

StoryResponseSchema.index({ novel: 1, user: 1, deletedAt: 1 });

/** Exclude soft-deleted StoryResponse rows unless query opts pass { includeDeleted: true }. */
const SOFT_DELETE_QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "countDocuments",
];

StoryResponseSchema.pre(SOFT_DELETE_QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

const StoryResponse = mongoose.model("StoryResponse", StoryResponseSchema);
export default StoryResponse;
