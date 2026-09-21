/**
 * Olivia chat history pagination helpers.
 *
 * Run:
 *   node --test storygroove-be/__tests__/oliviaChatHistory.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OLIVIA_HISTORY_DEFAULT_LIMIT,
  OLIVIA_HISTORY_PAGE_SIZE,
  parseOliviaHistoryLimit,
} from "../constants/oliviaChatHistory.js";

test("history constants match FE batch sizes", () => {
  assert.equal(OLIVIA_HISTORY_DEFAULT_LIMIT, 50);
  assert.equal(OLIVIA_HISTORY_PAGE_SIZE, 30);
});

test("parseOliviaHistoryLimit falls back for invalid input", () => {
  assert.equal(parseOliviaHistoryLimit(undefined, 50), 50);
  assert.equal(parseOliviaHistoryLimit("", 50), 50);
  assert.equal(parseOliviaHistoryLimit("abc", 50), 50);
  assert.equal(parseOliviaHistoryLimit(0, 50), 50);
});

test("parseOliviaHistoryLimit parses and clamps", () => {
  assert.equal(parseOliviaHistoryLimit("10", 50), 10);
  assert.equal(parseOliviaHistoryLimit(75.9, 50), 75);
  assert.equal(parseOliviaHistoryLimit("999", 50), 200);
});

/**
 * Mirrors the gate in `updateSceneSuggestion` before calling `onSceneEdit`.
 */
const shouldEnqueueSceneDesignMemory = (v2Enabled, responseText, slot) =>
  Boolean(
    v2Enabled &&
      String(responseText || "").trim() &&
      slot?.actNumber != null &&
      slot?.sceneIndex != null &&
      slot?.promptKey
  );

test("scene design save enqueues memory when V2 on and slot resolves", () => {
  const slot = { actNumber: 1, sceneIndex: 2, promptKey: "act1scene2" };
  assert.equal(
    shouldEnqueueSceneDesignMemory(true, "Outline coaching text", slot),
    true
  );
});

test("scene design save skips memory when slot row is missing", () => {
  assert.equal(shouldEnqueueSceneDesignMemory(true, "text", null), false);
  assert.equal(
    shouldEnqueueSceneDesignMemory(true, "text", { promptKey: "pk" }),
    false
  );
});

test("scene design save skips memory when V2 off or text empty", () => {
  const slot = { actNumber: 1, sceneIndex: 1, promptKey: "pk" };
  assert.equal(shouldEnqueueSceneDesignMemory(false, "text", slot), false);
  assert.equal(shouldEnqueueSceneDesignMemory(true, "   ", slot), false);
});
