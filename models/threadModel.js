import mongoose from "mongoose";

const threadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    threadId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: "New Chat",
    },
    assistantId: {
      type: String,
      required: true,
    },
    assistantName: {
      type: String,
    },
    agentName: {
      type: String,
      default: "simone",
      lowercase: true,
      trim: true,
    },
    simoneThreadId: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    sessionCost: {
      type: Number,
      default: 0,
    },
    simonePaused: {
      type: Boolean,
      default: false,
    },
    /** Primary Novel from "Outline with OliviaAI®" for this dashboard Olivia thread; never overwritten for additional drafts. */
    outlineNovelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      default: null,
    },
  },
  { timestamps: true }
);

const Thread = mongoose.model("Thread", threadSchema);

/**
 * Historical: a partial unique index on (userId, simoneThreadId) used to enforce
 * "one active Olivia thread per Simone starter kit". Since users can now create
 * multiple versioned Olivia chats from the same Story Starter Kit, the index is
 * obsolete. Drop it idempotently on boot so live deployments converge without
 * a manual migration step. Ignore "IndexNotFound" so re-runs and fresh DBs are
 * no-ops.
 */
const dropLegacyUniqueIndex = async () => {
  try {
    await Thread.collection.dropIndex("userId_1_simoneThreadId_1");
  } catch (err) {
    const code = err?.code || err?.codeName;
    if (code === 27 || code === "IndexNotFound") return;
    console.warn("[threadModel] Could not drop legacy unique index:", err?.message || err);
  }
};

mongoose.connection.once("open", () => {
  dropLegacyUniqueIndex();
});
if (mongoose.connection.readyState === 1) {
  dropLegacyUniqueIndex();
}

export default Thread;
