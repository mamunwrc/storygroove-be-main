import test from "node:test";
import assert from "node:assert/strict";

import {
  isArchivedScene,
  withoutArchivedScenes,
  archivedSceneRefKeySet,
  excludeArchivedSceneRefs,
  pickLastFilledSceneRow,
} from "../utils/archivedScenes.js";

test("isArchivedScene is true only when archivedAt is set", () => {
  assert.equal(isArchivedScene(null), false);
  assert.equal(isArchivedScene({}), false);
  assert.equal(isArchivedScene({ archivedAt: null }), false);
  assert.equal(isArchivedScene({ archivedAt: new Date() }), true);
});

test("withoutArchivedScenes drops archived rows and keeps active ones", () => {
  const rows = [
    { sceneIndex: 1 },
    { sceneIndex: 2, archivedAt: new Date("2026-08-24") },
    { sceneIndex: 3, archivedAt: null },
  ];
  const active = withoutArchivedScenes(rows);
  assert.deepEqual(
    active.map((r) => r.sceneIndex),
    [1, 3]
  );
});

test("excludeArchivedSceneRefs drops SceneMemory and episodic rows for archived slots", () => {
  const archivedKeys = archivedSceneRefKeySet([
    { actNumber: 1, sceneIndex: 2, archivedAt: new Date() },
    { actNumber: 2, sceneIndex: 1 },
  ]);
  const slice = [
    { sceneRef: { actNumber: 1, sceneIndex: 1 }, summary: "keep" },
    { sceneRef: { actNumber: 1, sceneIndex: 2 }, summary: "archived" },
    { sceneRef: { actNumber: 1, sceneIndex: 3 }, summary: "keep-later" },
  ];
  const filtered = excludeArchivedSceneRefs(slice, archivedKeys);
  assert.deepEqual(
    filtered.map((r) => r.summary),
    ["keep", "keep-later"]
  );
});

test("pickLastFilledSceneRow skips archived scenes even if they have prose", () => {
  const pick = pickLastFilledSceneRow([
    {
      actNumber: 1,
      sceneIndex: 1,
      userContent: "older active",
    },
    {
      actNumber: 1,
      sceneIndex: 2,
      userContent: "archived prose",
      archivedAt: new Date(),
    },
  ]);
  assert.equal(pick.sceneIndex, 1);
  assert.equal(pick.userContent, "older active");
});
