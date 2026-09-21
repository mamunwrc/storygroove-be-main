/**
 * Verifies the `getNovelDetails` lazy-populate branch that derives
 * `Novel.storyBible` from `Novel.masterPrompt` on first read.
 *
 * The controller logic is:
 *
 *   if (!String(novel.storyBible || "").trim() && hasMaster) {
 *     const derived = stripDossierBlocksFromMasterPrompt(novel.masterPrompt);
 *     if (derived) {
 *       await Novel.findByIdAndUpdate(novelId, { storyBible: derived });
 *       novel = { ...novel, storyBible: derived };
 *     }
 *   }
 *
 * These assertions cover the predicate (when to fire) and the
 * derivation (what gets persisted), without booting Mongoose.
 *
 * Run:
 *   node --test storygroove-be/__tests__/storyBibleLazyPopulate.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { stripDossierBlocksFromMasterPrompt } = await import(
  "../service/characterCanonContext.js"
);

const shouldLazyPopulate = (novel) => {
  const hasMaster = Boolean(String(novel?.masterPrompt || "").trim());
  return !String(novel?.storyBible || "").trim() && hasMaster;
};

const SAMPLE_MASTER_PROMPT = [
  "✨ Here is your Story Bible — the heartbeat of your novel.",
  "",
  "**📘 Story Bible**",
  "",
  "**1. Genre**",
  "Contemporary Women's Fiction",
  "",
  "**13. Structure**",
  "Three-act with rotating POV.",
  "",
  "**👤 CHARACTER DOSSIERS — 17-Point Dossiers**",
  "",
  "**👤 Lola Reyes: 17-Point Dossier**",
  "Age: 40",
  "",
  "**👤 Marcus Reyes: 17-Point Dossier**",
  "Age: 45",
  "",
  "🎭 Here are your full 17-point character dossiers — keep them as a reference.",
].join("\n");

test("predicate fires when storyBible empty and masterPrompt present", () => {
  assert.equal(
    shouldLazyPopulate({ masterPrompt: SAMPLE_MASTER_PROMPT, storyBible: "" }),
    true
  );
  assert.equal(
    shouldLazyPopulate({ masterPrompt: SAMPLE_MASTER_PROMPT, storyBible: "   " }),
    true
  );
  assert.equal(
    shouldLazyPopulate({ masterPrompt: SAMPLE_MASTER_PROMPT }),
    true
  );
});

test("predicate does NOT fire when storyBible already populated", () => {
  assert.equal(
    shouldLazyPopulate({
      masterPrompt: SAMPLE_MASTER_PROMPT,
      storyBible: "**📘 Story Bible**\n\n**1. Genre**\nContemporary Women's Fiction",
    }),
    false
  );
});

test("predicate does NOT fire when masterPrompt is empty", () => {
  assert.equal(shouldLazyPopulate({ masterPrompt: "", storyBible: "" }), false);
  assert.equal(shouldLazyPopulate({}), false);
});

test("derivation yields the dossier-free Story Bible that gets persisted", () => {
  const derived = stripDossierBlocksFromMasterPrompt(SAMPLE_MASTER_PROMPT);
  assert.match(derived, /Story Bible/);
  assert.match(derived, /Contemporary Women's Fiction/);
  assert.match(derived, /Three-act with rotating POV/);
  // The dossier section heading, the per-character dossiers, and the
  // closing chat footer all disappear in the persisted `storyBible`.
  assert.doesNotMatch(derived, /CHARACTER DOSSIERS/);
  assert.doesNotMatch(derived, /Lola Reyes/);
  assert.doesNotMatch(derived, /Marcus Reyes/);
  assert.doesNotMatch(derived, /Age:\s*45/);
  assert.doesNotMatch(derived, /Here are your full/);
});

test("derivation is idempotent — second pass on the already-derived text is a no-op", () => {
  const first = stripDossierBlocksFromMasterPrompt(SAMPLE_MASTER_PROMPT);
  const second = stripDossierBlocksFromMasterPrompt(first);
  assert.equal(second, first);
});
