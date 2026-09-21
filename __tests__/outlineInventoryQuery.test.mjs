import test from "node:test";
import assert from "node:assert/strict";

import { isOutlineInventoryQuery } from "../service/characterCanonContext.js";

test("isOutlineInventoryQuery matches outline list phrasing", () => {
  assert.equal(
    isOutlineInventoryQuery("list of my all current outlines"),
    true
  );
  assert.equal(isOutlineInventoryQuery("list all my current outlines"), true);
  assert.equal(isOutlineInventoryQuery("what scenes do you have"), true);
  assert.equal(isOutlineInventoryQuery("show me my scenes"), true);
});

test("isOutlineInventoryQuery does not match unrelated messages", () => {
  assert.equal(isOutlineInventoryQuery("help me write scene 2"), false);
  assert.equal(isOutlineInventoryQuery("who are the characters"), false);
  assert.equal(isOutlineInventoryQuery(""), false);
});
