/**
 * Unit tests for Olivia thread history pagination (no Mongo).
 *
 * Run:
 *   node --test storygroove-be/__tests__/oliviaThreadHistory.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

test("fetchThreadMessagePage returns empty when threadId is missing", async () => {
  const { fetchThreadMessagePage } = await import("../service/oliviaThreadHistory.js");
  const result = await fetchThreadMessagePage({ threadId: null, limit: 10 });
  assert.deepEqual(result, { messages: [], hasMore: false });
});
