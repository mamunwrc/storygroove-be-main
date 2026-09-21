import mongoose from "mongoose";
import { MEMORY_SCHEMA_VERSION } from "../constants/models.js";

/**
 * SceneCheckpoint (Phase 3, optional) — snapshots story-state +
 * Olivia's conversation chain at a scene boundary so a writer can
 * later "rewind" to that moment without losing chat history.
 *
 * Auto-created on every `saveOliviaScene` when
 * `isOliviaSceneCheckpointsEnabled()` (constants/oliviaMemory.js). Writers also create
 * named checkpoints manually via `POST .../olivia-checkpoint`.
 *
 * Restore semantics: re-hydrate `StoryState` / `ActiveSceneState` /
 * `CharacterState` / `RelationshipEdge` from the frozen snapshots,
 * and reset `ConversationCursor.lastResponseId` to
 * `frozenLastResponseId` (after first calling
 * `memoryService.invalidateResponseChain` so OpenAI sees a fresh
 * chain root). The raw `Message` history is **not** rolled back —
 * checkpoints are story-state-only.
 *
 * Storage scales with `(scenes × novels)`. The plan suggests either
 * a TTL on `auto` rows or a cap-and-rotate per novel; we ship
 * cap-and-rotate (keep the last K=20 `auto` rows per novel; `manual`
 * rows are always retained).
 */
const sceneCheckpointSchema = new mongoose.Schema(
  {
    novelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Novel",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /** Scene boundary this checkpoint represents. */
    sceneRef: {
      actNumber: { type: Number, required: true },
      sceneIndex: { type: Number, required: true },
    },

    /** Optional human label (manual checkpoints). */
    label: { type: String, default: "" },

    /** Frozen copies of the relevant memory rows. Plain JS objects. */
    storyStateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    activeSceneStateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    characterStateSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
    relationshipEdgeSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },

    /** Olivia conversation chain state at the boundary. */
    frozenLastResponseId: { type: String, default: null },
    rollingSummarySnapshot: { type: String, default: "" },
    /** ConversationCursor.threadId this snapshot is paired with. */
    threadId: { type: String, default: null, index: true },

    memoryVersion: {
      type: Number,
      default: () => MEMORY_SCHEMA_VERSION,
    },

    createdBy: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
  },
  { timestamps: true }
);

sceneCheckpointSchema.index({
  novelId: 1,
  "sceneRef.actNumber": 1,
  "sceneRef.sceneIndex": 1,
  createdAt: -1,
});

const SceneCheckpoint = mongoose.model("SceneCheckpoint", sceneCheckpointSchema);
export default SceneCheckpoint;
