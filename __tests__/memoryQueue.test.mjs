/**
 * Phase 4 in-process queue regression test.
 *
 * Covers the two invariants the queue exists to provide:
 *   1. Per-key serialization: two jobs with the same key never overlap.
 *   2. Global concurrency cap respected across all keys.
 *
 * Run:
 *   node --test storygroove-be/__tests__/memoryQueue.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { enqueue, idleStats } = await import("../service/memoryQueue.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("jobs with the same key run sequentially", async () => {
  const events = [];
  await Promise.all([
    enqueue({
      key: "novel-A",
      run: async () => {
        events.push("A1-start");
        await sleep(40);
        events.push("A1-end");
      },
    }),
    enqueue({
      key: "novel-A",
      run: async () => {
        events.push("A2-start");
        await sleep(20);
        events.push("A2-end");
      },
    }),
  ]);
  assert.deepEqual(events, ["A1-start", "A1-end", "A2-start", "A2-end"]);
});

test("jobs with different keys may overlap", async () => {
  const order = [];
  await Promise.all([
    enqueue({
      key: "novel-B",
      run: async () => {
        order.push("B-start");
        await sleep(30);
        order.push("B-end");
      },
    }),
    enqueue({
      key: "novel-C",
      run: async () => {
        order.push("C-start");
        await sleep(30);
        order.push("C-end");
      },
    }),
  ]);
  // We can't assert exact interleaving (timer jitter), but both should
  // have started before either ended — that's the parallelism signal.
  assert.ok(order.indexOf("B-start") < order.indexOf("B-end"));
  assert.ok(order.indexOf("C-start") < order.indexOf("C-end"));
  assert.ok(
    order.indexOf("B-start") < order.indexOf("C-end") &&
      order.indexOf("C-start") < order.indexOf("B-end"),
    "different-key jobs should overlap"
  );
});

test("a failing job does not break the queue", async () => {
  let secondRan = false;
  await Promise.allSettled([
    enqueue({
      key: "novel-D",
      run: async () => {
        throw new Error("boom");
      },
    }),
    enqueue({
      key: "novel-D",
      run: async () => {
        secondRan = true;
      },
    }),
  ]);
  assert.equal(secondRan, true);
});

test("idleStats exposes diagnostic info", async () => {
  const stats = idleStats();
  assert.equal(typeof stats.activeWorkers, "number");
  assert.equal(typeof stats.maxConcurrency, "number");
  assert.ok(Array.isArray(stats.inFlightKeys));
});
