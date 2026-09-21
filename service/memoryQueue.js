// Olivia memory pipeline — Phase 4 in-process queue.
//
// Tiny zero-dep queue that fronts the memory worker so a burst of
// scene saves (or a mass invalidation cascade) does not stampede
// OpenAI with parallel extractor calls.
//
// Properties:
//   - Per-key serialization: jobs with the same `key` (we use the
//     novelId) run one at a time, in FIFO order. This is what stops
//     two near-simultaneous scene closes on the same novel from
//     overwriting each other's StoryState.
//   - Global concurrency cap (`MAX_CONCURRENCY`, default 4) across
//     all keys so the box never holds dozens of LLM connections.
//   - Crash-safe semantics: every job is wrapped so a thrown error
//     never breaks the queue. The job's failure log is the caller's
//     responsibility.
//   - No persistence: pending jobs are lost on process restart. This
//     is acceptable because every worker is idempotent and the
//     backfill script can replay any missed extraction.
//
// If we need durability later, swap this module's exports for a
// BullMQ adapter — the public surface is intentionally minimal:
//   - `enqueue({ key, run, label? })` → schedules a job
//   - `enqueueFireAndForget(...)`     → same, never returns a Promise
//   - `idleStats()`                   → admin-only diagnostics

import { OLIVIA_MEMORY_QUEUE_CONCURRENCY } from "../constants/oliviaMemory.js";

const MAX_CONCURRENCY = OLIVIA_MEMORY_QUEUE_CONCURRENCY;

/** Map<key, Array<{ run, resolve, reject, label }>> */
const queues = new Map();
/** Map<key, true> while a worker for that key is in-flight. */
const inFlight = new Set();
let activeWorkers = 0;

const wakeNextKey = () => {
  if (activeWorkers >= MAX_CONCURRENCY) return;
  for (const [key, jobs] of queues.entries()) {
    if (inFlight.has(key) || jobs.length === 0) continue;
    activeWorkers++;
    inFlight.add(key);
    const job = jobs.shift();
    if (jobs.length === 0) queues.delete(key);
    runJob(key, job);
    if (activeWorkers >= MAX_CONCURRENCY) return;
  }
};

const runJob = async (key, job) => {
  try {
    const value = await job.run();
    job.resolve(value);
  } catch (err) {
    console.error(
      "memoryQueue: job failed (non-blocking)",
      JSON.stringify({ key: String(key), label: job.label, error: err?.message || String(err) })
    );
    job.reject(err);
  } finally {
    activeWorkers--;
    inFlight.delete(key);
    // Drain the next slot on the same key first (preserves FIFO per key).
    setImmediate(wakeNextKey);
  }
};

/**
 * Enqueue a job; returns a Promise that resolves / rejects with the
 * job's result. Use the `key` to opt jobs into per-key serialization
 * (we pass `String(novelId)` so all jobs touching a single novel
 * serialize against each other).
 */
export const enqueue = ({ key, run, label = "" }) => {
  if (typeof run !== "function") {
    return Promise.reject(new Error("memoryQueue.enqueue: run must be a function"));
  }
  const k = String(key || "default");

  return new Promise((resolve, reject) => {
    const list = queues.get(k) || [];
    list.push({ run, resolve, reject, label });
    queues.set(k, list);
    setImmediate(wakeNextKey);
  });
};

/**
 * Convenience for the common case: the caller doesn't care about the
 * Promise (memory work is fire-and-forget by design). Any rejection
 * is swallowed after logging — `enqueue` already logs.
 */
export const enqueueFireAndForget = (opts) => {
  enqueue(opts).catch(() => {});
};

export const idleStats = () => ({
  activeWorkers,
  inFlightKeys: Array.from(inFlight),
  pending: Object.fromEntries(
    Array.from(queues.entries()).map(([k, list]) => [k, list.length])
  ),
  maxConcurrency: MAX_CONCURRENCY,
});
