import test from "node:test";
import assert from "node:assert/strict";

import {
  isOutlineInventoryQuery,
  isOutlineTableQuery,
} from "../service/characterCanonContext.js";

test("isOutlineTableQuery includes all inventory list phrasing", () => {
  assert.equal(isOutlineTableQuery("list all my current outlines"), true);
  assert.equal(isOutlineTableQuery("what scenes do you have"), true);
});

test("isOutlineTableQuery matches layering and table phrasing", () => {
  assert.equal(isOutlineTableQuery("show the spine table"), true);
  assert.equal(isOutlineTableQuery("let's revise the plan"), true);
  assert.equal(isOutlineTableQuery("add a new scene between 2 and 3"), true);
  assert.equal(isOutlineTableQuery("expand the outline with layering"), true);
});

test("isOutlineTableQuery rejects unrelated creative turns", () => {
  assert.equal(isOutlineTableQuery("write scene 3 with more tension"), false);
  assert.equal(isOutlineTableQuery("who are the characters"), false);
  assert.equal(isOutlineTableQuery("this layer of the story feels thin"), false);
  assert.equal(isOutlineTableQuery("let's talk on the table about pacing"), false);
  assert.equal(
    isOutlineTableQuery("can you review my manuscript of Act 1 Scene 3"),
    false
  );
  assert.equal(isOutlineTableQuery("review my scene 3"), false);
  assert.equal(isOutlineTableQuery(""), false);
});

test("isOutlineTableQuery matches explicit layering table phrasing", () => {
  assert.equal(isOutlineTableQuery("show the layering table"), true);
});

test("isOutlineInventoryQuery is subset of isOutlineTableQuery", () => {
  const inventoryCases = [
    "list of my all current outlines",
    "show me my scenes",
    "what scenes are there in my outline",
  ];
  for (const msg of inventoryCases) {
    assert.equal(isOutlineInventoryQuery(msg), true);
    assert.equal(isOutlineTableQuery(msg), true);
  }
});
