import mongoose from "mongoose";

/**
 * Ellis Editing Plan ("Revision Plan") item.
 *
 * A writer-curated piece of Ellis feedback (from the editorial letter or a
 * scene-by-scene chat message) that the user explicitly chose to keep while
 * revising an uploaded manuscript. Scoped per novel + user.
 */
const RevisionPlanItemSchema = new mongoose.Schema(
  {
    novel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Where the saved feedback originated. */
    source: {
      type: String,
      enum: [
        "editorial_letter",
        "ellis_chat",
        "scene_review",
        "creative_suggestion",
        "manual",
      ],
      default: "ellis_chat",
    },
    /** Chapter the feedback relates to (e.g. "Chapter Eight"), when known. */
    chapterLabel: { type: String, default: null },
    /** Scene label within the chapter (e.g. "1A"), for scene/suggestion saves. */
    sceneLabel: { type: String, default: null },
    /** Optional short heading for the saved item. */
    title: { type: String, default: null },
    /** The saved feedback content (markdown/plain text). */
    content: { type: String, required: true },
    /** Originating chat Message id, when saved from an Ellis chat reply. */
    sourceMessageId: { type: String, default: null },
  },
  { timestamps: true }
);

RevisionPlanItemSchema.index({ novel: 1, user: 1, createdAt: -1 });

const RevisionPlanItem = mongoose.model(
  "RevisionPlanItem",
  RevisionPlanItemSchema
);

export default RevisionPlanItem;
