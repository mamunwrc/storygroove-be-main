import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * ConversationCursor — one document per `threadId`. Tracks how much of the
 * raw `Message` history has been compressed into a rolling summary, the most
 * recent OpenAI Responses API `response.id` (so we can chain via
 * `previous_response_id`), and cumulative token/cost accounting for the
 * thread.
 *
 * Created lazily by `memoryService.getOrCreateCursor` on the first turn that
 * hits the new memory path. Existing threads keep working without a cursor
 * (the service falls back to the legacy "send full history" path), so this
 * model is safe to ship without a backfill.
 */
const conversationCursorSchema = new mongoose.Schema(
  {
    threadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** Nullable — dashboard Simone/Olivia threads have no novel until outline exists. */
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: false,
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /**
     * Stamped at creation; the assembler uses this to decide whether a row
     * is current with the latest extraction-prompt schema. Bumping
     * `MEMORY_SCHEMA_VERSION` does NOT invalidate existing cursors — it
     * just lets the backfill script identify which rows to refresh.
     */
    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },

    // -----------------------------------------------------------------
    // Rolling summary (post-stream compressor in memoryService)
    // -----------------------------------------------------------------
    /**
     * Plain-text running summary of all messages up to
     * `summarizedThroughMessageId` (exclusive). Injected as a synthetic
     * `system` message in the cold-start fallback path.
     */
    rollingSummary: {
      type: String,
      default: "",
    },
    /**
     * Highest `Message._id` that has already been folded into
     * `rollingSummary`. The compressor looks for messages with `_id`
     * greater than this and `timestamp` greater than
     * `summarizedThroughTimestamp` to find new content to summarize.
     */
    summarizedThroughMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    summarizedThroughTimestamp: {
      type: Date,
      default: null,
    },
    /**
     * Size of the trailing raw window the stream service passes to OpenAI
     * when the chain is cold (no `previous_response_id`). Configurable per
     * thread so admins can experiment without code changes.
     */
    recentWindowSize: {
      type: Number,
      default: 10,
    },
    lastCompressedAt: {
      type: Date,
      default: null,
    },
    /**
     * Guard against two concurrent stream completions racing the
     * compressor on the same thread. Set to `true` when a compressor is
     * running; cleared when it finishes (success or failure).
     */
    pendingCompression: {
      type: Boolean,
      default: false,
    },

    // -----------------------------------------------------------------
    // OpenAI Responses API chain
    // -----------------------------------------------------------------
    /**
     * Most recent OpenAI `response.id` for this thread. The next turn
     * passes this as `previous_response_id` to skip resending the prior
     * input/output. OpenAI retains response IDs for ~30 days; the stream
     * service flips `lastResponseIdExpired = true` on a 4xx referencing
     * the id and falls back to the cold-start path.
     */
    lastResponseId: {
      type: String,
      default: null,
    },
    lastResponseIdAt: {
      type: Date,
      default: null,
    },
    lastResponseIdExpired: {
      type: Boolean,
      default: false,
    },

    // -----------------------------------------------------------------
    // Cumulative token accounting (lifetime of the thread)
    // -----------------------------------------------------------------
    totalPromptTokens: { type: Number, default: 0 },
    totalCachedInputTokens: { type: Number, default: 0 },
    totalCompletionTokens: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },

    // -----------------------------------------------------------------
    // Last-turn snapshot (for diagnostics + admin dashboards)
    // -----------------------------------------------------------------
    lastPromptTokens: { type: Number, default: 0 },
    lastCompletionTokens: { type: Number, default: 0 },
    lastTurnAt: {
      type: Date,
      default: null,
    },

    /**
     * Running estimate of tokens saved versus the legacy "send full
     * history" path. Computed per turn as
     * `legacyFullHistoryTokens - actualPromptTokens` and summed. Lets
     * the admin dashboard show "we saved $X by switching to V2".
     */
    estimatedTokensSaved: {
      type: Number,
      default: 0,
    },
    chainTurnCount: { type: Number, default: 0 },
    lastMutationTsAtAssembly: { type: Date, default: null },
    lastMemoryBlockChars: { type: Number, default: 0 },
    lastChainUsed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

conversationCursorSchema.index({ novelId: 1, lastTurnAt: -1 });

const ConversationCursor = mongoose.model(
  "ConversationCursor",
  conversationCursorSchema
);

export default ConversationCursor;
