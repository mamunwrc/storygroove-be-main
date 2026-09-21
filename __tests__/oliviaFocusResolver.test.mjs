/**
 * Run: node --test storygroove-be/__tests__/oliviaFocusResolver.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveFocusScene } = await import("../service/oliviaFocusResolver.js");

test("resolveFocusScene prefers explicit targetScene", async () => {
  const focus = await resolveFocusScene({
    novelId: "507f1f77bcf86cd799439011",
    userId: "507f1f77bcf86cd799439012",
    explicitTargetScene: { actNumber: 2, sceneIndex: 3 },
    activeSceneState: { currentScene: { actNumber: 1, sceneIndex: 1 } },
  });
  assert.deepEqual(focus, { actNumber: 2, sceneIndex: 3 });
});

test("resolveFocusScene keeps globalSceneNumber from the explicit target", async () => {
  const focus = await resolveFocusScene({
    novelId: "507f1f77bcf86cd799439011",
    userId: "507f1f77bcf86cd799439012",
    explicitTargetScene: {
      actNumber: 2,
      sceneIndex: 7,
      globalSceneNumber: 15,
    },
  });
  assert.deepEqual(focus, {
    actNumber: 2,
    sceneIndex: 7,
    globalSceneNumber: 15,
  });
});

test("resolveFocusScene uses activeSceneState when no explicit target", async () => {
  const focus = await resolveFocusScene({
    novelId: "507f1f77bcf86cd799439011",
    userId: "507f1f77bcf86cd799439012",
    explicitTargetScene: null,
    activeSceneState: { currentScene: { actNumber: 1, sceneIndex: 4 } },
  });
  assert.deepEqual(focus, { actNumber: 1, sceneIndex: 4 });
});
