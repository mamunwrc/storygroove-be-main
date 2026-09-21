/**
 * Phase 1 regression test for the Olivia memory pipeline.
 *
 * Why this exists
 *   The new `OLIVIA_MEMORY_V2` path replaces "send the full Message
 *   history to OpenAI" with a windowed-history + rolling-summary +
 *   `previous_response_id` chain. The FE's auto-insert UI depends on
 *   being able to:
 *     a) replay the entire thread via `GET /olivia-chat/history`
 *        (unchanged),
 *     b) reference the *most recent layering table* even after many
 *        turns scroll past the window,
 *     c) save / insert a scene from that table after a long thread is
 *        reopened.
 *
 *   This test exercises the memoryService internals that those
 *   invariants depend on, using fake mongoose models. No DB or OpenAI
 *   network calls.
 *
 * Run:
 *   node --test storygroove-be/__tests__/oliviaMemoryPipeline.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { _internal } = await import("../service/memoryService.js");

// ---------------------------------------------------------------------------
// Sanity checks on exported internals
// ---------------------------------------------------------------------------

test("memoryService exports the expected internals", () => {
  assert.equal(typeof _internal.LAYERING_TABLE_HEADER_RE, "object");
  assert.ok(_internal.LAYERING_TABLE_HEADER_RE instanceof RegExp);
  assert.equal(typeof _internal.isLayeringTablePinContent, "function");
  assert.equal(_internal.DEFAULT_RECENT_WINDOW, 10);
  assert.equal(_internal.MAX_COLD_START_PINS, 3);
  assert.equal(_internal.COMPRESSION_TRIGGER_COUNT, 10);
  assert.equal(_internal.RESPONSE_ID_MAX_AGE_DAYS, 25);
  assert.equal(typeof _internal.isModelEligible, "function");
});

// ---------------------------------------------------------------------------
// Pin-rule regex matches the FE-detected layering table header
// ---------------------------------------------------------------------------

test("layering-table regex detects markdown table headers used by the FE", () => {
  const tableMessage = [
    "Here is your scene layering table:",
    "",
    "| Scene # | Act | Title | POV | Scene Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| Scene 1 | 1 | Open | Eli | Setup | A quiet morning |",
    "| NEW Scene 2.5 | 1 | Spark | Eli | Tension | New |",
    "",
  ].join("\n");

  assert.ok(_internal.LAYERING_TABLE_HEADER_RE.test(tableMessage));
});

test("layering-table regex ignores ordinary chat messages", () => {
  const chatty = "Sure, let's talk about how Eli reacts in scene 2.";
  assert.equal(_internal.LAYERING_TABLE_HEADER_RE.test(chatty), false);
});

test("layering pin ignores 15-spine recap without NEW Scene rows", () => {
  const spine = [
    "Here's your current 15-scene spine:",
    "",
    "| Scene # | Act | Title | POV | Scene Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| Scene 1 | 1 | Open | Eli | Setup | A quiet morning |",
    "| Scene 2 | 1 | Spark | Eli | Tension | Next beat |",
    "",
  ].join("\n");
  assert.equal(_internal.LAYERING_TABLE_HEADER_RE.test(spine), true);
  assert.equal(_internal.isLayeringTablePinContent(spine), false);
});

test("layering pin matches a NEW Scene table row", () => {
  const tableMessage = [
    "Here is your scene layering table:",
    "",
    "| Scene # | Act | Title | POV | Scene Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| Scene 1 | 1 | Open | Eli | Setup | A quiet morning |",
    "| NEW Scene 2.5 | 1 | Spark | Eli | Tension | New |",
    "",
  ].join("\n");
  assert.equal(_internal.isLayeringTablePinContent(tableMessage), true);
});

// ---------------------------------------------------------------------------
// isModelEligible reflects the same rule used by the streaming service
// ---------------------------------------------------------------------------

test("isModelEligible excludes UI-only welcome / confirmation messages", () => {
  const welcome = { metadata: { excludeFromModelInput: true } };
  const real = { metadata: {} };
  const noMetadata = {};
  assert.equal(_internal.isModelEligible(welcome), false);
  assert.equal(_internal.isModelEligible(real), true);
  assert.equal(_internal.isModelEligible(noMetadata), true);
});

// ---------------------------------------------------------------------------
// resolveChainHeadResponseId handles missing / expired / aged-out cases
// ---------------------------------------------------------------------------

test("resolveChainHeadResponseId returns null when chain is unset", async () => {
  const { resolveChainHeadResponseId } = await import("../service/memoryService.js");
  assert.equal(resolveChainHeadResponseId(null), null);
  assert.equal(resolveChainHeadResponseId({}), null);
  assert.equal(resolveChainHeadResponseId({ lastResponseId: null }), null);
});

test("resolveChainHeadResponseId returns null when chain is marked expired", async () => {
  const { resolveChainHeadResponseId } = await import("../service/memoryService.js");
  const cursor = {
    lastResponseId: "resp_123",
    lastResponseIdAt: new Date(),
    lastResponseIdExpired: true,
  };
  assert.equal(resolveChainHeadResponseId(cursor), null);
});

test("resolveChainHeadResponseId returns null when chain head is too old", async () => {
  const { resolveChainHeadResponseId } = await import("../service/memoryService.js");
  const days = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const fresh = {
    lastResponseId: "resp_fresh",
    lastResponseIdAt: days(1),
    lastResponseIdExpired: false,
  };
  const stale = {
    lastResponseId: "resp_stale",
    lastResponseIdAt: days(30),
    lastResponseIdExpired: false,
  };
  assert.equal(resolveChainHeadResponseId(fresh), "resp_fresh");
  assert.equal(resolveChainHeadResponseId(stale), null);
});

// ---------------------------------------------------------------------------
// isPreviousResponseIdError pattern-matches the OpenAI error surface we
// actually catch and recover from
// ---------------------------------------------------------------------------

test("isPreviousResponseIdError matches messages referencing previous_response_id", async () => {
  const { isPreviousResponseIdError } = await import("../service/memoryService.js");
  const responseId = "resp_abc";

  const byParamName = {
    status: 400,
    message: "previous_response_id is invalid or expired.",
  };
  const byId = {
    status: 404,
    error: { message: "Response resp_abc not found." },
  };
  const byPhrase = {
    status: 400,
    message: "Previous response could not be located.",
  };
  const serverError = {
    status: 500,
    message: "previous_response_id failed (server side)",
  };
  const unrelated = { status: 400, message: "Tool call argument invalid." };

  assert.equal(isPreviousResponseIdError(byParamName, responseId), true);
  assert.equal(isPreviousResponseIdError(byId, responseId), true);
  assert.equal(isPreviousResponseIdError(byPhrase, responseId), true);
  // 5xx is not classified as a chain error — we want a real retry, not a
  // chain invalidation.
  assert.equal(isPreviousResponseIdError(serverError, responseId), false);
  assert.equal(isPreviousResponseIdError(unrelated, responseId), false);
});

// ---------------------------------------------------------------------------
// FE round-trip invariant: the "Insert into outline" message is the most
// recent assistant message whose content contains a markdown layering
// table. If a writer reopens a long thread, that table message MUST
// still be findable on the backend even though the model never sees the
// full history.
// ---------------------------------------------------------------------------

test("after a long thread, the layering-table message stays detectable in the trailing history", () => {
  const TABLE_MSG = [
    "Updated layering plan:",
    "",
    "| Scene # | Act | Title | POV | Scene Purpose | Summary |",
    "|---------|-----|-------|-----|---------------|----------|",
    "| Scene 1 | 1 | Open | Eli | Setup | A quiet morning |",
    "| NEW Scene 2.5 | 1 | Spark | Eli | Tension | New |",
    "",
  ].join("\n");

  // Simulate 30 user/assistant turns after the layering table.
  const history = [
    {
      _id: "m1",
      role: "assistant",
      content: TABLE_MSG,
      metadata: {},
      timestamp: new Date(Date.now() - 60 * 60_000),
    },
  ];
  for (let i = 0; i < 30; i++) {
    history.push({
      _id: `u${i}`,
      role: "user",
      content: `follow up question ${i}`,
      metadata: {},
      timestamp: new Date(Date.now() - (30 - i) * 60_000),
    });
    history.push({
      _id: `a${i}`,
      role: "assistant",
      content: `coaching reply ${i}`,
      metadata: {},
      timestamp: new Date(Date.now() - (30 - i) * 60_000 + 1000),
    });
  }

  // The FE's "find latest table message" boils down to this regex scan
  // over the full /history response. The new pipeline does not change
  // history storage, only what gets sent to OpenAI, so this scan must
  // still succeed after long sessions.
  const latestTable = [...history]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        _internal.LAYERING_TABLE_HEADER_RE.test(m.content || "")
    );

  assert.ok(latestTable, "FE-detectable layering table must remain in history");
  assert.equal(latestTable._id, "m1");
});
