import test from "node:test";
import assert from "node:assert/strict";

import {
  isCoverQuotaExempt,
  getCoverRenderUsage,
  assertCanRender,
} from "../utils/coverRenderQuota.js";

test("isCoverQuotaExempt is true only for superadmin", () => {
  assert.equal(isCoverQuotaExempt("superadmin"), true);
  assert.equal(isCoverQuotaExempt("admin"), false);
  assert.equal(isCoverQuotaExempt("user"), false);
  assert.equal(isCoverQuotaExempt(undefined), false);
});

test("getCoverRenderUsage returns unlimited for superadmin", async () => {
  const usage = await getCoverRenderUsage("fake-user-id", {
    role: "superadmin",
  });
  assert.equal(usage.unlimited, true);
  assert.equal(usage.remaining, null);
});

test("assertCanRender does not throw for superadmin", async () => {
  const usage = await assertCanRender("fake-user-id", { role: "superadmin" });
  assert.equal(usage.unlimited, true);
});
