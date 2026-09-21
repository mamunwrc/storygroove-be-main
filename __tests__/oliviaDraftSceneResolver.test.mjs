/**
 * Run: node --test storygroove-be/__tests__/oliviaDraftSceneResolver.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveOliviaAvatarDrafts,
  applyOliviaDraftNeedDecision,
  executeOliviaLoadManuscriptScenes,
  buildOliviaDraftIndexRows,
  findLastOliviaLoadedDraftNeed,
} from "../service/oliviaDraftSceneResolver.js";
import {
  buildSceneExtrasBlock,
  buildManuscriptDraftPackBlock,
} from "../service/oliviaDynamicContext.js";
import {
  buildOliviaResponsesTools,
  OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME,
} from "../utils/oliviaResponsesTools.js";

const spine = [
  {
    _id: "s1",
    actNumber: 1,
    sceneIndex: 1,
    sceneTitle: "Arrival",
    userContent: "<p>Chapter one prose.</p>",
  },
  {
    _id: "s2",
    actNumber: 1,
    sceneIndex: 2,
    sceneTitle: "The Letter",
    userContent: "<p>Chapter two prose.</p>",
  },
  {
    _id: "s3",
    actNumber: 1,
    sceneIndex: 3,
    sceneTitle: "The House",
    userContent: "<p>Chapter three prose.</p>",
  },
  {
    _id: "s4",
    actNumber: 1,
    sceneIndex: 4,
    sceneTitle: "Night Watch",
    userContent: "",
  },
  {
    _id: "s5",
    actNumber: 1,
    sceneIndex: 5,
    sceneTitle: "The Gate",
    userContent: "<p>Chapter five prose.</p>",
  },
  {
    _id: "s6",
    actNumber: 2,
    sceneIndex: 1,
    sceneTitle: "The Locked Room",
    userContent: "<p>Chapter six prose.</p>",
  },
];

const idsOf = (resolvedRows) => resolvedRows.map((r) => String(r._id));

test("resolveOliviaAvatarDrafts attaches the open scene and index, not a pack", () => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
  });
  assert.equal(resolved.draftPackScenes, null);
  assert.match(resolved.manuscriptDraft, /Live chapter one/);
  assert.ok(resolved.draftIndexRows.length >= 6);
});

test("writer message does not change which draft is attached", () => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
  });
  assert.match(resolved.manuscriptDraft, /Live chapter one/);
  assert.doesNotMatch(resolved.manuscriptDraft, /Chapter six/);
});

test("applyOliviaDraftNeedDecision maps acts, drops invented globals, keeps holes", () => {
  const act1 = applyOliviaDraftNeedDecision(
    { wholeBook: false, actNumbers: [1], globalSceneNumbers: [] },
    spine
  );
  assert.deepEqual(idsOf(act1.rows), ["s1", "s2", "s3", "s4", "s5"]);

  const invented = applyOliviaDraftNeedDecision(
    { wholeBook: false, actNumbers: [], globalSceneNumbers: [6, 99] },
    spine
  );
  assert.deepEqual(idsOf(invented.rows), ["s6"]);
  assert.deepEqual(invented.missingGlobals, []);

  const holeSpine = spine.filter((row) => row._id !== "s4");
  const hole = applyOliviaDraftNeedDecision(
    { wholeBook: false, actNumbers: [], globalSceneNumbers: [4] },
    holeSpine
  );
  assert.equal(hole.rows.length, 0);
  assert.deepEqual(hole.missingGlobals, [4]);
});

test("executeOliviaLoadManuscriptScenes packs free-text opening globals", () => {
  const pack = executeOliviaLoadManuscriptScenes({
    args: {
      wholeBook: false,
      actNumbers: [],
      globalSceneNumbers: [1, 2, 3, 4, 5, 6],
    },
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
  });
  assert.match(pack, /WRITER'S MANUSCRIPT DRAFT PACK/);
  assert.match(pack, /Live chapter one/);
  assert.match(pack, /Chapter six prose/);
  assert.doesNotMatch(pack, /<p>/);
});

test("executeOliviaLoadManuscriptScenes loads a named scene from tool args", () => {
  const pack = executeOliviaLoadManuscriptScenes({
    args: JSON.stringify({
      wholeBook: false,
      actNumbers: [],
      globalSceneNumbers: [6],
    }),
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
  });
  assert.match(pack, /Chapter six prose/);
  assert.doesNotMatch(pack, /Live chapter one/);
});

test("executeOliviaLoadManuscriptScenes loads the whole book", () => {
  const pack = executeOliviaLoadManuscriptScenes({
    args: { wholeBook: true, actNumbers: [], globalSceneNumbers: [] },
    userContents: spine,
  });
  assert.match(pack, /Chapter one prose/);
  assert.match(pack, /Chapter six prose/);
});

test("executeOliviaLoadManuscriptScenes skips archived scenes", () => {
  const withArchived = spine.map((row) =>
    row._id === "s3"
      ? { ...row, archivedAt: new Date("2026-01-01") }
      : row
  );
  const pack = executeOliviaLoadManuscriptScenes({
    args: {
      wholeBook: false,
      actNumbers: [],
      globalSceneNumbers: [1, 2, 3, 4, 5, 6],
    },
    userContents: withArchived,
  });
  assert.doesNotMatch(pack, /Chapter three prose/);
});

test("empty tool args do not dump the manuscript", () => {
  const pack = executeOliviaLoadManuscriptScenes({
    args: { wholeBook: false, actNumbers: [], globalSceneNumbers: [] },
    userContents: spine,
  });
  assert.match(pack, /No extra manuscript scenes matched/);
});

test("buildOliviaDraftIndexRows marks empty scenes and skips archived", () => {
  const withArchived = spine.map((row) =>
    row._id === "s3"
      ? { ...row, archivedAt: new Date("2026-01-01") }
      : row
  );
  const index = buildOliviaDraftIndexRows(withArchived);
  assert.equal(index.some((r) => r.sceneId === "s3"), false);
  const night = index.find((r) => r.sceneId === "s4");
  assert.equal(night.hasProse, false);
  const arrival = index.find((r) => r.sceneId === "s1");
  assert.equal(arrival.hasProse, true);
  assert.ok(arrival.wordCount > 0);
});

test("extras include index and open draft, not a pre-packed range", () => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
  });
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: resolved.manuscriptDraft,
    draftSceneMeta: resolved.draftSceneMeta,
    draftIndexRows: resolved.draftIndexRows,
  });
  assert.match(extras, /DRAFT INDEX/);
  assert.match(extras, /load_manuscript_scenes/);
  assert.match(extras, /Live chapter one/);
  assert.doesNotMatch(extras, /WRITER'S MANUSCRIPT DRAFT PACK/);
  assert.doesNotMatch(extras, /OFFICE 3 COACHING SCOPE/);
});

test("carried pack keeps live open scene when it is outside the pack", () => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents: spine,
    selectedDraft: "<p>Live scene seven.</p>",
    selectedMeta: { actNumber: 2, sceneIndex: 2, sceneId: "s7" },
    draftNeed: {
      wholeBook: false,
      actNumbers: [],
      globalSceneNumbers: [1, 6],
    },
  });
  assert.match(resolved.openEditorDraft, /Live scene seven/);
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: resolved.manuscriptDraft,
    draftSceneMeta: resolved.draftSceneMeta,
    openEditorDraft: resolved.openEditorDraft,
    openEditorSceneMeta: resolved.openEditorSceneMeta,
    draftPackScenes: resolved.draftPackScenes,
    draftIndexRows: resolved.draftIndexRows,
  });
  assert.match(extras, /MANUSCRIPT DRAFT PACK/);
  assert.match(extras, /CURRENTLY OPEN IN THE EDITOR/);
  assert.match(extras, /Live scene seven/);
  assert.match(extras, /Chapter six prose/);
});

test("carried draftNeed packs scenes for follow-up turns", () => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents: spine,
    selectedDraft: "<p>Live chapter one.</p>",
    selectedMeta: { actNumber: 1, sceneIndex: 1, sceneId: "s1" },
    draftNeed: {
      wholeBook: false,
      actNumbers: [],
      globalSceneNumbers: [1, 2, 3, 4, 5, 6],
    },
  });
  assert.equal(resolved.draftPackScenes.length, 6);
  assert.equal(resolved.openEditorDraft, "");
  assert.match(resolved.draftPackScenes[0].text, /Live chapter one/);
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: resolved.manuscriptDraft,
    openEditorDraft: resolved.openEditorDraft,
    draftPackScenes: resolved.draftPackScenes,
    draftIndexRows: resolved.draftIndexRows,
  });
  assert.match(extras, /MANUSCRIPT DRAFT PACK/);
  assert.match(extras, /Live chapter one/);
  assert.match(extras, /Chapter six prose/);
  assert.doesNotMatch(extras, /CURRENTLY OPEN IN THE EDITOR/);
});

test("findLastOliviaLoadedDraftNeed uses the newest stamped assistant turn", () => {
  const need = findLastOliviaLoadedDraftNeed([
    { role: "assistant", metadata: {} },
    {
      role: "assistant",
      metadata: {
        loadedDraftNeed: {
          wholeBook: false,
          actNumbers: [],
          globalSceneNumbers: [1, 2, 3, 4, 5, 6],
        },
      },
    },
  ]);
  assert.deepEqual(need.globalSceneNumbers, [1, 2, 3, 4, 5, 6]);
});

test("coaching extras ignore pack and index", () => {
  const extras = buildSceneExtrasBlock({
    manuscriptDraft: "Coach this scene only.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 1, sceneTitle: "Arrival" },
    draftPackScenes: [
      { meta: { globalSceneNumber: 1, actNumber: 1 }, text: "<p>One</p>" },
      { meta: { globalSceneNumber: 2, actNumber: 1 }, text: "<p>Two</p>" },
    ],
    draftIndexRows: [{ globalSceneNumber: 1, actNumber: 1, hasProse: true, wordCount: 3 }],
  });
  assert.match(extras, /OFFICE 3 COACHING SCOPE/);
  assert.match(extras, /COACHING TARGET — WRITER'S MANUSCRIPT DRAFT/);
  assert.match(extras, /Coach this scene only/);
  assert.doesNotMatch(extras, /DRAFT INDEX/);
  assert.doesNotMatch(extras, /MANUSCRIPT DRAFT PACK/);
});

test("buildManuscriptDraftPackBlock notes omitted scenes when over budget", () => {
  const block = buildManuscriptDraftPackBlock(
    [
      { meta: { globalSceneNumber: 1, actNumber: 1, sceneTitle: "A" }, text: "aaa ".repeat(40) },
      { meta: { globalSceneNumber: 2, actNumber: 1, sceneTitle: "B" }, text: "bbb ".repeat(40) },
    ],
    { maxChars: 90 }
  );
  assert.match(block, /WRITER'S MANUSCRIPT DRAFT PACK/);
  assert.match(block, /truncated|Omitted/i);
});

test("buildOliviaResponsesTools includes load_manuscript_scenes when requested", () => {
  const withTool = buildOliviaResponsesTools({ loadManuscriptScenes: true });
  assert.equal(withTool[0].name, OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME);
  const without = buildOliviaResponsesTools({ loadManuscriptScenes: false });
  assert.equal(
    without.some((t) => t.name === OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME),
    false
  );
});
