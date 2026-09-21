import mongoose from "mongoose";
import { queueActivityLog } from "../utils/queueActivityLog.js";
import { ACTIVITY_LIMITS } from "../constants/activityLog.js";

const NovelSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    bookIdea: { type: String },
    masterPrompt: { type: String },
    /**
     * Dossier-free Story Bible. Lazy-populated from `masterPrompt` on book
     * load (see `getNovelDetails`) by cutting at the `**👤 CHARACTER
     * DOSSIERS — 17-Point Dossiers**` section heading. Every prompt-assembly
     * path reads this field instead of `masterPrompt` so the writer's
     * Character collection edits are not contradicted by stale dossier
     * prose embedded in the original generation snapshot.
     */
    storyBible: { type: String },
    /**
     * One-shot latch: Character docs were hydrated from masterPrompt dossiers.
     * After this is true, list GET must not re-insert parsed dossiers (that
     * would undo writer deletes on the Characters tab).
     */
    characterDossiersHydrated: { type: Boolean, default: false },
    setting: { type: String },
    narrativeStyle: { type: String },
    genre: { type: String },
    /** Subgenre parsed from an uploaded manuscript's title page (e.g. "Romantic Subplot / Wartime Drama"). */
    subgenre: { type: String },
    storyBibleAuthor: { type: String },
    wordCount: { type: Number },
    protagonist: { type: String },
    protagonistDescription: { type: String },
    antagonist: { type: String },
    antagonistMotivation: { type: String },
    theme: { type: String },
    themeExploration: { type: String },
    supportingCharacters: [
      { name: String, role: String, significance: String },
    ],
    subplot: { type: String },
    worldBuilding: { type: String },
    specialElements: { type: String },
    summary: { type: String },
    compTitles: [String],
    coverImage: { type: String, default: null },
    /**
     * Latest draft cover concept from cover chat (not yet rendered).
     * imagePrompt + typographyPalette + comparables.
     */
    coverWorkingConcept: {
      imagePrompt: { type: String, default: null },
      typographyPalette: { type: [String], default: [] },
      comparables: { type: [String], default: [] },
      /** Exact title string for on-cover rendering; overrides novel.name when set. */
      displayTitle: { type: String, default: null },
    },
    threadId: { type: String, default: null },
    /**
     * Ellis developmental-editor chat thread (scene-by-scene Phase 2). Lazily
     * created on first message; mirrors the Olivia coaching thread pattern.
     */
    ellisEditorThreadId: { type: String, default: null },
    /**
     * Ellis Phase 1 editorial letter refinement chat thread. Separate from the
     * scene-by-scene `ellisEditorThreadId`; used only by the consent/refine modal.
     */
    ellisEditorialLetterThreadId: { type: String, default: null },
    /** Ellis Phase 1 global editorial letter (markdown text) — the saved/accepted version. */
    editorialLetter: { type: String, default: null },
    /**
     * In-progress editorial letter draft (streamed generation + refine turns).
     * Copied to `editorialLetter` only when the writer clicks Save.
     */
    editorialLetterDraft: { type: String, default: null },
    /**
     * Lifecycle for the editorial letter consent/refine workflow:
     * - pending:    uploaded; writer has not consented to generate yet
     * - generating: first draft in progress
     * - draft:      draft ready in the modal; writer can refine via chat
     * - ready:      writer saved/accepted the letter (unlocks scene work)
     * - failed:     generation failed
     */
    editorialLetterStatus: {
      type: String,
      enum: ["pending", "generating", "draft", "ready", "failed"],
      default: "pending",
    },
    /** Last failure reason when editorialLetterStatus is "failed". */
    editorialLetterError: { type: String, default: null },
    /** Timestamp the editorial letter was last successfully saved. */
    editorialLetterGeneratedAt: { type: Date, default: null },
    /**
     * Cover-oriented summary of the saved editorial letter (Ellis uploads).
     * Built once on first cover generate with COVER_CONTEXT_SUMMARY_MODEL;
     * cleared when the letter is re-saved so the next cover request re-summarizes.
     */
    coverEditorialLetterSummary: { type: String, default: null },
    /** Manuscript Map enrichment (chapter summaries + act assignment). */
    manuscriptEnrichmentStatus: {
      type: String,
      enum: ["pending", "generating", "ready", "failed"],
      default: "pending",
    },
    manuscriptEnrichmentError: { type: String, default: null },
    manuscriptEnrichmentGeneratedAt: { type: Date, default: null },
    oliviaEditorThreadId: { type: String, default: null },
    oliviaSceneChatThreadId: { type: String, default: null },
    /** Office 3 scene coaching (draft review) — separate from layering editor chat. */
    oliviaCoachingThreadId: { type: String, default: null },
    /**
     * Per-novel OpenAI hosted vector store id used by the Phase 3
     * retrieval pipeline (`provisionNovelVectorStore`,
     * `syncSceneMemoryToVectorStore`). Created lazily on first scene
     * close; null on novels created before Phase 3 shipped.
     */
    oliviaSceneMemoryVectorStoreId: { type: String, default: null },
    outlineConversationHistory: {
      type: [{ role: String, content: String }],
      default: [],
    },
    /** @deprecated Prefer oliviaLayeredInserts — kept for novels inserted before promptKey linking. */
    oliviaLayeredInsertedStableKeys: { type: [String], default: [] },
    /** Links layering table stableKey → outline promptKey; "done" only if userContents still has that promptKey. */
    oliviaLayeredInserts: {
      type: [
        {
          stableKey: { type: String, required: true },
          promptKey: { type: String, required: true },
        },
      ],
      default: [],
    },
    /** Chat Message ids whose rich scene was already inserted into the outline (hide "Add to outline" on refresh). */
    oliviaSavedOutlineMessageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
      default: [],
    },
    /** Chat Message ids whose chapter review was inserted into Scene Edit. */
    ellisSavedChapterReviewMessageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ["in progress", "completed"],
      default: "in progress",
    },
    acts: [{ actNumber: Number, title: String }],
    pinned: { type: Boolean, default: false },
    uploaded: { type: Boolean, default: false },
    /** Set after lettered chapter rows are merged into one row per chapterNumber. */
    manuscriptChaptersConsolidatedAt: { type: Date, default: null },
    /** True once all layered scenes are expanded + inserted and the drafting transition has been delivered. */
    layeringComplete: { type: Boolean, default: false },
    /** Set when the user "deletes" a novel; related UserContent/Character rows are retained for restore / purge jobs. */
    deletedAt: { type: Date, default: null },
    /** Dashboard Olivia agent chat `Thread.threadId` that produced this outline (multiple drafts per chat allowed). */
    sourceOliviaAgentThreadId: { type: String, default: null },
  },
  { timestamps: true }
);

NovelSchema.index({ user: 1, deletedAt: 1 });
NovelSchema.index({ user: 1, sourceOliviaAgentThreadId: 1 });

/** Exclude soft-deleted novels from reads/updates unless query has { includeDeleted: true }. */
const QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "countDocuments",
];

NovelSchema.pre(QUERY_HOOKS, function excludeSoftDeleted() {
  const opts = this.getOptions();
  if (opts?.includeDeleted) return;
  this.where({ deletedAt: null });
});

const DELETE_UPDATE_HOOKS = ["findOneAndUpdate", "updateOne", "updateMany"];

function extractDeletedAtFromUpdate(update = {}) {
  if (!update || typeof update !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(update, "deletedAt")) return update.deletedAt;
  if (
    update.$set &&
    typeof update.$set === "object" &&
    Object.prototype.hasOwnProperty.call(update.$set, "deletedAt")
  ) {
    return update.$set.deletedAt;
  }
  return undefined;
}

NovelSchema.pre(DELETE_UPDATE_HOOKS, async function captureDeleteTargets() {
  const opts = this.getOptions?.() || {};
  if (opts.activityLogSkipModel === true) return;

  const deletedAtUpdate = extractDeletedAtFromUpdate(this.getUpdate?.() || {});
  if (!deletedAtUpdate) return;

  const query = { ...(this.getQuery?.() || {}) };
  if (!Object.prototype.hasOwnProperty.call(query, "deletedAt")) {
    query.deletedAt = null;
  }

  // Cap +1 so we know if we're truncating.
  const cap = ACTIVITY_LIMITS.MODEL_MIDDLEWARE_FANOUT_CAP;
  const [targets, total] = await Promise.all([
    this.model
      .find(query, { _id: 1, user: 1 })
      .setOptions({ includeDeleted: true })
      .limit(cap + 1)
      .lean(),
    this.model
      .countDocuments(query)
      .setOptions({ includeDeleted: true }),
  ]);
  this._activityDeleteTargets = Array.isArray(targets) ? targets.slice(0, cap) : [];
  this._activityDeleteTotal = total || 0;
  this._activityDeleteTruncated = total > cap;
});

NovelSchema.post(DELETE_UPDATE_HOOKS, function logSoftDeleteTransition() {
  const opts = this.getOptions?.() || {};
  if (opts.activityLogSkipModel === true) return;

  const targets = this._activityDeleteTargets || [];
  const truncated = this._activityDeleteTruncated === true;
  const total = this._activityDeleteTotal || targets.length;

  if (targets.length > 1) {
    // Bulk delete — write one summary row instead of N per-target logs to
    // keep the audit feed readable. (Per-target rows are still useful for
    // single-novel deletes, which is the common path.)
    queueActivityLog({
      userId: targets[0]?.user || null,
      action: "delete",
      module: "novel",
      description: `Bulk novel soft-delete detected at model level (${total} novels${truncated ? ", truncated" : ""})`,
      metadata: {
        novelIds: targets.map((r) => String(r._id)),
        totalAffected: total,
        truncated,
        source: "model_middleware",
      },
    });
    return;
  }

  for (const row of targets) {
    queueActivityLog({
      userId: row.user || null,
      action: "delete",
      module: "novel",
      description: "Novel soft-delete detected at model level",
      metadata: {
        novelId: String(row._id),
        source: "model_middleware",
      },
    });
  }
});

const Novel = mongoose.model("Novel", NovelSchema);
export default Novel;
