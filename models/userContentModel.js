import mongoose from "mongoose";

const UserContentSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    promptKey: { type: String },
    userContent: { type: String },
    sceneTitle: { type: String },
    sceneIndex: { type: Number },
    actNumber: { type: Number },
    /** Uploaded-manuscript chapter metadata (parsed on upload). */
    chapterNumber: { type: Number, default: null },
    /** Optional letter part for headers like "Chapter Seven A" (stored uppercase). */
    chapterSuffix: { type: String, default: null },
    chapterLabel: { type: String, default: null },
    pov: { type: String, default: null },
    timeline: { type: String, default: null },
    /** Functional beat summary for Manuscript Map (Ellis enrichment). */
    chapterSummary: { type: String, default: null },
    isUserAdded: { type: Boolean, default: false },
    /** Set when a scene is "deleted"; the row is retained for restore / purge jobs. */
    deletedAt: { type: Date, default: null },
    /** Set when a scene/chapter is archived to visit later; Olivia and Ellis cannot read it. */
    archivedAt: { type: Date, default: null },
    /** Slot to restore into on unarchive (set when archiving; active outline is renumbered). */
    archivedFromActNumber: { type: Number, default: null },
    archivedFromSceneIndex: { type: Number, default: null },
  },
  { timestamps: true }
);

UserContentSchema.index({ novelId: 1, user: 1, deletedAt: 1 });

/** Exclude soft-deleted UserContent rows unless query opts pass { includeDeleted: true }. */
const SOFT_DELETE_QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "countDocuments",
];

UserContentSchema.pre(SOFT_DELETE_QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

const UserContent = mongoose.model("UserContent", UserContentSchema);
export default UserContent;
