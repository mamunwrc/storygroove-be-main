/**
 * Dashboard Simone/Olivia memory pipeline — unit tests (no DB / OpenAI).
 *
 * Run:
 *   node --test storygroove-be/__tests__/dashboardChatMemory.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isDashboardStoryBibleArtifact,
  DASHBOARD_ARTIFACT_KIND_STORY_BIBLE,
} from "../constants/dashboardChatArtifacts.js";
import {
  DASHBOARD_CHAT_MEMORY_V2_ENABLED,
  SIMONE_RECENT_WINDOW_SIZE,
  isDashboardChatMemoryV2Enabled,
} from "../constants/oliviaMemory.js";

test("dashboard memory flag is off (full history for intake quality)", () => {
  assert.equal(DASHBOARD_CHAT_MEMORY_V2_ENABLED, false);
  assert.equal(isDashboardChatMemoryV2Enabled(), false);
});

test("Simone cold-start window fits full intake", () => {
  assert.ok(SIMONE_RECENT_WINDOW_SIZE >= 22);
});

test("isDashboardStoryBibleArtifact detects Story Bible deliverables", () => {
  assert.equal(
    isDashboardStoryBibleArtifact("Here is your **📘 Story Bible**\n\nGenre: Thriller"),
    true
  );
  assert.equal(
    isDashboardStoryBibleArtifact(
      "👤 CHARACTER DOSSIERS — 17-Point Dossiers\n\nEli..."
    ),
    true
  );
  assert.equal(isDashboardStoryBibleArtifact("Let's refine scene 2."), false);
});

test("story bible artifact kind constant is stable for pinning queries", () => {
  assert.equal(DASHBOARD_ARTIFACT_KIND_STORY_BIBLE, "story_bible");
});
