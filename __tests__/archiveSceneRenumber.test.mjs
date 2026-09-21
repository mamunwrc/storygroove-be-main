/**
 * Pure helpers for archive gap-close / restore insert math (no Mongo).
 * Mirrors novelController archiveScene / unarchiveScene index rules.
 */
import test from "node:test";
import assert from "node:assert/strict";

const isArchived = (row) => Boolean(row?.archivedAt);

/** Close gap after archiving scene at `archivedIndex` within one act. */
const closeGapAfterArchive = (rows, archivedId, archivedIndex) =>
  rows.map((row) => {
    if (String(row._id) === String(archivedId)) {
      return {
        ...row,
        archivedAt: new Date("2026-09-07"),
        archivedFromActNumber: row.actNumber,
        archivedFromSceneIndex: archivedIndex,
      };
    }
    if (
      !isArchived(row) &&
      Number(row.sceneIndex) > archivedIndex &&
      String(row._id) !== String(archivedId)
    ) {
      return { ...row, sceneIndex: Number(row.sceneIndex) - 1 };
    }
    return row;
  });

const nextActiveIndex = (rows, actNumber) => {
  let max = 0;
  for (const row of rows) {
    if (isArchived(row)) continue;
    if (Number(row.actNumber) !== Number(actNumber)) continue;
    const si = Number(row.sceneIndex);
    if (Number.isFinite(si) && si > max) max = si;
  }
  return max > 0 ? max + 1 : 1;
};

/** Restore archived row to original slot (append if past end). */
const restoreToOriginalSlot = (rows, archivedId) => {
  const parked = rows.find((r) => String(r._id) === String(archivedId));
  assert.ok(parked?.archivedAt);
  const targetAct =
    Number(parked.archivedFromActNumber) || Number(parked.actNumber) || 1;
  const fromStash = parked.archivedFromSceneIndex;
  const fromLive = parked.sceneIndex;
  const savedIndex =
    fromStash != null && Number.isFinite(Number(fromStash))
      ? Number(fromStash)
      : fromLive != null && Number.isFinite(Number(fromLive))
        ? Number(fromLive)
        : NaN;
  const appendIndex = nextActiveIndex(rows, targetAct);
  let targetIndex = Number.isFinite(savedIndex) ? savedIndex : appendIndex;
  if (targetIndex < 1 || targetIndex > appendIndex) targetIndex = appendIndex;

  return rows.map((row) => {
    if (String(row._id) === String(archivedId)) {
      return {
        ...row,
        actNumber: targetAct,
        sceneIndex: targetIndex,
        archivedAt: null,
        archivedFromActNumber: null,
        archivedFromSceneIndex: null,
      };
    }
    if (
      !isArchived(row) &&
      Number(row.actNumber) === targetAct &&
      Number(row.sceneIndex) >= targetIndex
    ) {
      return { ...row, sceneIndex: Number(row.sceneIndex) + 1 };
    }
    return row;
  });
};

/** Contiguous 1..N by sceneIndex order (mirrors healActSceneIndices). */
const healGaps = (rows, act = 1) => {
  const active = rows
    .filter((r) => !isArchived(r) && Number(r.actNumber) === act)
    .sort((a, b) => Number(a.sceneIndex) - Number(b.sceneIndex));
  const indexById = new Map();
  active.forEach((r, i) => indexById.set(r._id, i + 1));
  return rows.map((r) =>
    indexById.has(r._id) ? { ...r, sceneIndex: indexById.get(r._id) } : r
  );
};

const activeIndices = (rows, act = 1) =>
  rows
    .filter((r) => !isArchived(r) && Number(r.actNumber) === act)
    .map((r) => Number(r.sceneIndex))
    .sort((a, b) => a - b);

test("archive closes gap among active scenes", () => {
  const rows = [
    { _id: "a", actNumber: 1, sceneIndex: 1 },
    { _id: "b", actNumber: 1, sceneIndex: 2 },
    { _id: "c", actNumber: 1, sceneIndex: 3 },
    { _id: "d", actNumber: 1, sceneIndex: 4 },
  ];
  const after = closeGapAfterArchive(rows, "b", 2);
  assert.deepEqual(activeIndices(after), [1, 2, 3]);
  const parked = after.find((r) => r._id === "b");
  assert.ok(parked.archivedAt);
  assert.equal(parked.archivedFromActNumber, 1);
  assert.equal(parked.archivedFromSceneIndex, 2);
  assert.equal(after.find((r) => r._id === "c").sceneIndex, 2);
  assert.equal(after.find((r) => r._id === "d").sceneIndex, 3);
});

test("unarchive restores to original slot and shifts others", () => {
  const rows = closeGapAfterArchive(
    [
      { _id: "a", actNumber: 1, sceneIndex: 1 },
      { _id: "b", actNumber: 1, sceneIndex: 2 },
      { _id: "c", actNumber: 1, sceneIndex: 3 },
    ],
    "b",
    2
  );
  const restored = restoreToOriginalSlot(rows, "b");
  assert.deepEqual(activeIndices(restored), [1, 2, 3]);
  assert.equal(restored.find((r) => r._id === "b").sceneIndex, 2);
  assert.equal(restored.find((r) => r._id === "c").sceneIndex, 3);
  assert.equal(restored.find((r) => r._id === "b").archivedAt, null);
});

test("unarchive appends when original slot is past end of act", () => {
  // Archive middle, then delete later actives until original slot is past end.
  let rows = closeGapAfterArchive(
    [
      { _id: "a", actNumber: 1, sceneIndex: 1 },
      { _id: "b", actNumber: 1, sceneIndex: 2 },
      { _id: "c", actNumber: 1, sceneIndex: 3 },
    ],
    "c",
    3
  );
  // Only one active left; archivedFromSceneIndex is 3 → append at 2
  rows = rows.filter((r) => r._id !== "b");
  const restored = restoreToOriginalSlot(rows, "c");
  assert.equal(restored.find((r) => r._id === "c").sceneIndex, 2);
  assert.deepEqual(activeIndices(restored), [1, 2]);
});

test("legacy archive (no archivedFrom*) restores using live sceneIndex", () => {
  // Old archive kept the slot on the parked row; actives still have a gap.
  const rows = [
    { _id: "a", actNumber: 1, sceneIndex: 1 },
    {
      _id: "b",
      actNumber: 1,
      sceneIndex: 2,
      archivedAt: new Date("2026-08-24"),
      archivedFromActNumber: null,
      archivedFromSceneIndex: null,
    },
    { _id: "c", actNumber: 1, sceneIndex: 3 },
    { _id: "d", actNumber: 1, sceneIndex: 4 },
  ];
  const restored = healGaps(restoreToOriginalSlot(rows, "b"));
  assert.equal(restored.find((r) => r._id === "b").sceneIndex, 2);
  assert.equal(restored.find((r) => r._id === "b").archivedAt, null);
  assert.deepEqual(activeIndices(restored), [1, 2, 3, 4]);
  assert.equal(restored.find((r) => r._id === "c").sceneIndex, 3);
  assert.equal(restored.find((r) => r._id === "d").sceneIndex, 4);
});
