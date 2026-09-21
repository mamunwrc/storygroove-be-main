import test from "node:test";
import assert from "node:assert/strict";

import {
  STALE_CONTENT_CODE,
  parseExpectedUpdatedAt,
  buildUserContentSaveFilter,
  classifyUserContentSaveMiss,
} from "../utils/userContentSave.js";

test("parseExpectedUpdatedAt returns null when omitted", () => {
  assert.equal(parseExpectedUpdatedAt(null), null);
  assert.equal(parseExpectedUpdatedAt(""), null);
  assert.equal(parseExpectedUpdatedAt(undefined), null);
});

test("parseExpectedUpdatedAt returns undefined for invalid values", () => {
  assert.equal(parseExpectedUpdatedAt("not-a-date"), undefined);
});

test("parseExpectedUpdatedAt returns a Date for ISO strings", () => {
  const iso = "2026-09-21T10:30:00.123Z";
  const parsed = parseExpectedUpdatedAt(iso);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), iso);
});

test("buildUserContentSaveFilter omits updatedAt without a token or when forced", () => {
  const id = "scene1";
  const userId = "user1";
  const expectedUpdatedAt = new Date("2026-09-21T10:30:00.123Z");

  assert.deepEqual(buildUserContentSaveFilter({ id, userId }), {
    _id: id,
    user: userId,
  });
  assert.deepEqual(
    buildUserContentSaveFilter({
      id,
      userId,
      expectedUpdatedAt,
      force: true,
    }),
    { _id: id, user: userId }
  );
});

test("buildUserContentSaveFilter pins updatedAt for optimistic lock", () => {
  const id = "scene1";
  const userId = "user1";
  const expectedUpdatedAt = new Date("2026-09-21T10:30:00.123Z");
  assert.deepEqual(
    buildUserContentSaveFilter({ id, userId, expectedUpdatedAt }),
    { _id: id, user: userId, updatedAt: expectedUpdatedAt }
  );
});

test("classifyUserContentSaveMiss is stale only when a token was required", () => {
  const current = { userContent: "from other device" };
  assert.equal(classifyUserContentSaveMiss({ current: null }), "not_found");
  assert.equal(
    classifyUserContentSaveMiss({
      current,
      expectedUpdatedAt: new Date(),
    }),
    "stale"
  );
  assert.equal(
    classifyUserContentSaveMiss({
      current,
      expectedUpdatedAt: new Date(),
      force: true,
    }),
    "not_found"
  );
  assert.equal(STALE_CONTENT_CODE, "STALE_CONTENT");
});
