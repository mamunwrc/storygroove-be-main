/**
 * Run: node --test storygroove-be/__tests__/oliviaChainPolicy.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  shouldUseResponseChain,
  shouldSkipMemoryBlockOnChain,
  _internal,
} = await import("../service/memoryService.js");

const {
  OLIVIA_CHAIN_MAX_TURNS,
  OLIVIA_CHAIN_MAX_INPUT_TOKENS,
} = await import("../constants/oliviaMemory.js");

test("shouldUseResponseChain returns false when turn count exceeded", () => {
  const cursor = {
    lastResponseId: "resp_abc",
    lastResponseIdExpired: false,
    chainTurnCount: OLIVIA_CHAIN_MAX_TURNS,
    lastPromptTokens: 1000,
    lastResponseIdAt: new Date(),
  };
  assert.equal(shouldUseResponseChain(cursor), false);
});

test("shouldUseResponseChain returns false when input tokens exceeded", () => {
  const cursor = {
    lastResponseId: "resp_abc",
    lastResponseIdExpired: false,
    chainTurnCount: 1,
    lastPromptTokens: OLIVIA_CHAIN_MAX_INPUT_TOKENS + 1,
    lastResponseIdAt: new Date(),
  };
  assert.equal(shouldUseResponseChain(cursor), false);
});

test("shouldUseResponseChain returns true for healthy cursor", () => {
  const cursor = {
    lastResponseId: "resp_abc",
    lastResponseIdExpired: false,
    chainTurnCount: 2,
    lastPromptTokens: 5000,
    lastResponseIdAt: new Date(),
  };
  assert.equal(shouldUseResponseChain(cursor), true);
});

test("shouldSkipMemoryBlockOnChain when novel unchanged since assembly", () => {
  const ts = new Date("2026-01-01T12:00:00Z");
  const cursor = { lastMutationTsAtAssembly: ts };
  assert.equal(shouldSkipMemoryBlockOnChain(cursor, ts), true);
  assert.equal(
    shouldSkipMemoryBlockOnChain(cursor, new Date("2026-01-02T12:00:00Z")),
    false
  );
});

test("shouldSkipMemoryBlockOnChain returns false when requiresCanonExpansion", () => {
  const ts = new Date("2026-01-01T12:00:00Z");
  const cursor = { lastMutationTsAtAssembly: ts };
  assert.equal(
    shouldSkipMemoryBlockOnChain(cursor, ts, { requiresCanonExpansion: true }),
    false
  );
});

test("memoryService exports shouldUseResponseChain in _internal", () => {
  assert.equal(typeof _internal.shouldUseResponseChain, "function");
});
