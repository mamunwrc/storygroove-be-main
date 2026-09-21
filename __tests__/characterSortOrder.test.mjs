import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCharacterOrderIds,
  sortCharactersByUserOrder,
} from "../utils/characterSortOrder.js";

test("sortCharactersByUserOrder leaves natural order when sortOrder unset", () => {
  const list = [{ name: "B" }, { name: "A" }];
  assert.deepEqual(sortCharactersByUserOrder(list), list);
});

test("sortCharactersByUserOrder sorts by sortOrder then name", () => {
  const sorted = sortCharactersByUserOrder([
    { name: "Zed", sortOrder: 1 },
    { name: "Ann", sortOrder: 0 },
    { name: "Bob", sortOrder: 1 },
  ]);
  assert.deepEqual(
    sorted.map((c) => c.name),
    ["Ann", "Bob", "Zed"]
  );
});

test("buildCharacterOrderIds drops unknown ids and appends missing", () => {
  assert.deepEqual(
    buildCharacterOrderIds(["a", "b", "c"], ["c", "x", "a", "a"]),
    ["c", "a", "b"]
  );
});
