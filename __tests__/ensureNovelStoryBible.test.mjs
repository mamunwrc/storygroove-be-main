/**
 * Verifies `ensureNovelStoryBible` lazy-populates `Novel.storyBible` from
 * `Novel.masterPrompt` for the chat controllers (which load the novel
 * directly and skip getNovelDetails). The util mutates the passed doc in
 * place and best-effort persists via `Novel.findByIdAndUpdate(...).catch()`.
 *
 * We disable mongoose command buffering so the (un-connected) persist call
 * rejects immediately and is swallowed by the util's `.catch`, keeping the
 * test fast and focused on the synchronous mutation behavior.
 *
 * Run:
 *   node --test storygroove-be/__tests__/ensureNovelStoryBible.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

mongoose.set("bufferCommands", false);

const { ensureNovelStoryBible } = await import(
  "../utils/ensureNovelStoryBible.js"
);

const SAMPLE_MASTER_PROMPT = [
  "✨ Here is your Story Bible — the heartbeat of your novel.",
  "",
  "**📘 Story Bible**",
  "",
  "**1. Genre**",
  "Contemporary Women's Fiction",
  "",
  "**13. Structure**",
  "Three-act with rotating POV.",
  "",
  "**👤 CHARACTER DOSSIERS — 17-Point Dossiers**",
  "",
  "**👤 Lola Reyes: 17-Point Dossier**",
  "Age: 40",
].join("\n");

test("derives storyBible from masterPrompt when empty", async () => {
  const novel = {
    _id: "507f1f77bcf86cd799439011",
    masterPrompt: SAMPLE_MASTER_PROMPT,
    storyBible: "",
  };
  await ensureNovelStoryBible(novel);
  assert.match(novel.storyBible, /Story Bible/);
  assert.match(novel.storyBible, /Contemporary Women's Fiction/);
  assert.doesNotMatch(novel.storyBible, /Lola Reyes/);
});

test("no-op when storyBible already set", async () => {
  const existing = "**📘 Story Bible**\n\n**1. Genre**\nThriller";
  const novel = {
    _id: "507f1f77bcf86cd799439011",
    masterPrompt: SAMPLE_MASTER_PROMPT,
    storyBible: existing,
  };
  await ensureNovelStoryBible(novel);
  assert.equal(novel.storyBible, existing);
});

test("no-op when masterPrompt is missing", async () => {
  const novel = {
    _id: "507f1f77bcf86cd799439011",
    masterPrompt: "",
    storyBible: "",
  };
  await ensureNovelStoryBible(novel);
  assert.equal(novel.storyBible, "");
});

test("returns the novel unchanged when null", async () => {
  assert.equal(await ensureNovelStoryBible(null), null);
});
