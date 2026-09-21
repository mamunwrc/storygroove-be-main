/**
 * One-time deploy helper: invalidate all Olivia response-id chains so the
 * next chat turn uses cold-start (summary + window + bounded memory block).
 *
 * Usage (from storygroove-be/):
 *   node scripts/resetOliviaResponseChains.js
 *
 * Requires MONGO_URI in the environment (loads ../.env via dotenv if present).
 * Uses MONGODB_NAME when set (same as config/db.js) — required when MONGO_URI
 * has no database path segment (e.g. ends with `/`).
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is required");
    process.exit(1);
  }

  const connectOpts = process.env.MONGODB_NAME
    ? { dbName: process.env.MONGODB_NAME }
    : {};
  await mongoose.connect(uri, connectOpts);

  const { default: ConversationCursor } = await import(
    "../models/conversationCursorModel.js"
  );

  const result = await ConversationCursor.updateMany(
    {},
    {
      $set: {
        lastResponseId: null,
        lastResponseIdExpired: true,
        chainTurnCount: 0,
      },
    }
  );

  console.log(
    JSON.stringify({
      scope: "resetOliviaResponseChains",
      dbName: mongoose.connection.db?.databaseName || process.env.MONGODB_NAME || null,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    })
  );

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
