import mongoose from "mongoose";

/**
 * Ellis Scene Architect (Phase 2) — structured, per-chapter developmental
 * review for an uploaded manuscript.
 *
 * Unlike the legacy one-shot `EllisSceneReview` (whole-manuscript JSON keyed by
 * a flat scene_index), this model stores ONE document per chapter. Ellis splits
 * the chapter into scenes (1A, 1B, ...), reviews each against the client's
 * Scene Architect template, and adds a cumulative chapter note. Generated
 * asynchronously and polled by the viewer, mirroring the editorial-letter
 * lifecycle on the Novel.
 */
const CreativeSuggestionSchema = new mongoose.Schema(
  {
    /** Which weakness this addresses. */
    category: {
      type: String,
      enum: ["structure", "character"],
      required: true,
    },
    /** Short name of the weakness (e.g. "The corporate engine arrives late"). */
    weakness: { type: String, default: "" },
    /** Memorable title of the suggestion (e.g. "Let the Cell Smell Like Silicon Valley"). */
    suggestionName: { type: String, default: "" },
    /** What to change and why. */
    description: { type: String, default: "" },
    /** 1-2 mini-rewrite examples shown to the writer. */
    examples: { type: [String], default: [] },
  },
  { _id: false }
);

const SceneReviewSchema = new mongoose.Schema(
  {
    /** Scene label within the chapter, e.g. "1A". */
    label: { type: String, required: true },
    /** Short scene title, e.g. "Holding-Cell Frame / Darien's Comic Rock Bottom". */
    title: { type: String, default: "" },
    /** The scene's opening line, quoted from the manuscript. */
    firstLine: { type: String, default: "" },
    /** Function in Story (e.g. "Opening Image / Comic Disaster Hook"). */
    functionInStory: { type: String, default: "" },
    /** Genre Beat Check paragraph. */
    genreBeatCheck: { type: String, default: "" },
    /** Structure verdict. */
    structureVerdict: {
      type: String,
      enum: ["Keep", "Tighten", "Rewrite", "Move", "Cut"],
      default: "Keep",
    },
    /** Character verdict. */
    characterVerdict: {
      type: String,
      enum: ["Keep", "Keep as-is", "Deepen", "Rework"],
      default: "Keep",
    },
    /** 1-2 editorial-review paragraphs. */
    sceneAnalysis: { type: String, default: "" },
    /** Named creative suggestions with example rewrites. */
    creativeSuggestions: { type: [CreativeSuggestionSchema], default: [] },
  },
  { _id: false }
);

const EllisChapterReviewSchema = new mongoose.Schema(
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
    /** Chapter number this review covers (matches UserContent.chapterNumber). */
    chapterNumber: { type: Number, required: true },
    /** Stable manuscript-map row this review belongs to (survives add/renumber). */
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserContent",
      default: null,
    },
    /** Optional letter suffix (e.g. "A" for Chapter Seven A); "" when absent. */
    chapterSuffix: { type: String, default: "" },
    /** Display label for the chapter (e.g. "Chapter One"). */
    chapterLabel: { type: String, default: null },
    /** POV parsed for the chapter, surfaced in the review header. */
    pov: { type: String, default: null },
    /** Generation lifecycle. */
    status: {
      type: String,
      enum: ["pending", "generating", "ready", "failed"],
      default: "pending",
    },
    /** Failure reason when status is "failed". */
    error: { type: String, default: null },
    /** Full chapter review as markdown prose (primary storage). */
    reviewMarkdown: { type: String, default: "" },
    /** Latest revision-history evaluation (never overwrites reviewMarkdown). */
    revisionMarkdown: { type: String, default: "" },
    /** Timestamp the latest revision-history evaluation was inserted. */
    revisionGeneratedAt: { type: Date, default: null },
    /** Chat message id last inserted into Revision Review. */
    revisionMessageId: { type: String, default: null },
    /** @deprecated Legacy structured reviews — no longer written. */
    scenes: { type: [SceneReviewSchema], default: [] },
    /** @deprecated Legacy cumulative note — no longer written. */
    cumulativeNote: { type: String, default: "" },
    /** Timestamp the review was last successfully generated. */
    generatedAt: { type: Date, default: null },
    /** SHA-1 of stripped chapter draft at generation/insert time. */
    draftContentHash: { type: String, default: null },
  },
  { timestamps: true }
);

EllisChapterReviewSchema.index(
  { novel: 1, chapterNumber: 1, chapterSuffix: 1 },
  { unique: true }
);
EllisChapterReviewSchema.index({ novel: 1, chapterId: 1 });
EllisChapterReviewSchema.index({ novel: 1, user: 1 });

const EllisChapterReview = mongoose.model(
  "EllisChapterReview",
  EllisChapterReviewSchema
);

/**
 * Pre-suffix schema used a unique index on (novel, chapterNumber) only.
 * Lettered chapters (Seven vs Seven A) need (novel, chapterNumber, chapterSuffix).
 * Drop the legacy index and backfill missing chapterSuffix to "" so upserts work.
 */
const migrateEllisChapterReviewIndexes = async () => {
  try {
    await EllisChapterReview.collection.dropIndex("novel_1_chapterNumber_1");
    console.log(
      "[ellisChapterReviewModel] Dropped legacy unique index novel_1_chapterNumber_1"
    );
  } catch (err) {
    const code = err?.code || err?.codeName;
    if (code !== 27 && code !== "IndexNotFound") {
      console.warn(
        "[ellisChapterReviewModel] Could not drop legacy unique index:",
        err?.message || err
      );
    }
  }

  try {
    await EllisChapterReview.updateMany(
      {
        $or: [
          { chapterSuffix: { $exists: false } },
          { chapterSuffix: null },
        ],
      },
      { $set: { chapterSuffix: "" } }
    );
  } catch (err) {
    console.warn(
      "[ellisChapterReviewModel] chapterSuffix backfill failed:",
      err?.message || err
    );
  }

  try {
    await EllisChapterReview.syncIndexes();
  } catch (err) {
    console.warn(
      "[ellisChapterReviewModel] syncIndexes failed:",
      err?.message || err
    );
  }
};

mongoose.connection.once("open", () => {
  migrateEllisChapterReviewIndexes();
});
if (mongoose.connection.readyState === 1) {
  migrateEllisChapterReviewIndexes();
}

export default EllisChapterReview;
