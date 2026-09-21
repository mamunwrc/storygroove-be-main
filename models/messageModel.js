import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    threadId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["system", "user", "assistant", "tool"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Legacy single-file fields — kept for backward compatibility with old messages.
    // null is intentionally allowed so old documents without a file are valid.
    fileUrl: {
      type: String,
      default: null,
    },
    fileKey: {
      type: String,
      default: null,
    },
    fileType: {
      type: String,
      enum: ["image", "pdf", "document", null],
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    // Multi-file attachments (up to 5 per message).
    // Each element must have all three fields; null is not a valid fileType here
    // because objects only exist in the array when a real file was attached.
    attachments: {
      type: [
        {
          fileUrl: { type: String, required: true },
          fileKey: { type: String, default: null },
          fileType: {
            type: String,
            enum: ["image", "pdf", "document"],
            required: true,
          },
          fileName: { type: String, required: true },
        },
      ],
      default: [],
    },
    // Pre-built multi-part content (with base64 data) cached after the first
    // S3 fetch so subsequent requests skip the download entirely.
    cachedContentParts: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

messageSchema.index({ threadId: 1, timestamp: 1 });

const Message = mongoose.model("Message", messageSchema);
export default Message;
