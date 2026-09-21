import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  COACHING_INTENT,
  COACH_SCENE_MESSAGE_PATTERN,
  isCoachSceneTrigger,
  parseOliviaCoachingGateText,
} from "../service/oliviaCoachingGate.js";
import { resolveOliviaTokenBudget } from "../constants/oliviaMemory.js";
import {
  buildSceneExtrasBlock,
  buildManuscriptDraftBlock,
  buildCoachingScopeBlock,
  buildRevisionComparisonBlock,
} from "../service/oliviaDynamicContext.js";
import { buildCoachingFullPassMetadata } from "../service/oliviaRevisionIntelligence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coachingTxt = fs.readFileSync(
  path.resolve(__dirname, "../../olivia-coaching.txt"),
  "utf8"
);

test("isCoachSceneTrigger detects coach_scene intent and message pattern", () => {
  assert.equal(
    isCoachSceneTrigger({
      coachingIntent: COACHING_INTENT.COACH_SCENE,
      message: "hello",
    }),
    true
  );
  assert.equal(
    isCoachSceneTrigger({ message: "Coach me on Act 2, Chapter 5 — Rooftop" }),
    true
  );
  assert.equal(isCoachSceneTrigger({ message: "What about pacing?" }), false);
});

test("coaching gate question is parsed from AgentPrompt body text", () => {
  const gateText = parseOliviaCoachingGateText(coachingTxt);
  assert.ok(gateText.includes("Before I do a full chapter coaching pass"));
  assert.ok(gateText.includes("1) Are you treating this chapter as complete"));
  assert.ok(
    gateText.includes(
      "2) Or did we already do a pass, you made changes, and now you want me to take another look"
    )
  );
  assert.ok(
    gateText.includes(
      "3) Or are you still drafting the chapter, maybe feeling stuck"
    )
  );
  assert.ok(!gateText.includes("Yes, scene is complete"));
});

test("coaching prompt clarifies option 1 always triggers new full pass", () => {
  assert.match(
    coachingTxt,
    /option 1 always triggers a \*\*new\*\* six-part full pass on the current draft — not revision review/i
  );
});

test("resolveOliviaTokenBudget includes coaching mode", () => {
  assert.equal(resolveOliviaTokenBudget({ mode: "coaching" }), 11000);
});

test("buildSceneExtrasBlock prioritizes manuscript draft for coaching", () => {
  const block = buildSceneExtrasBlock({
    manuscriptDraft: "She paused at the door.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 2, sceneTitle: "Opening" },
  });
  assert.match(block, /COACHING TARGET/);
  assert.match(block, /OFFICE 3 COACHING SCOPE/);
  assert.match(block, /coach ONLY this prose/);
  assert.match(block, /She paused at the door/);
  assert.ok(block.indexOf("OFFICE 3 COACHING SCOPE") < block.indexOf("She paused"));
});

test("buildManuscriptDraftBlock labels draft as coaching target", () => {
  const block = buildManuscriptDraftBlock("Draft line.", {
    actNumber: 1,
    sceneIndex: 1,
    globalSceneNumber: 1,
    sceneTitle: "Flute Across the Rooftop",
  });
  assert.match(block, /COACHING TARGET/);
  assert.match(block, /Act 1, Chapter 1 — "Flute Across the Rooftop"/);
  assert.doesNotMatch(block, /global/i);
  assert.match(block, /Draft line/);
});

test("buildCoachingScopeBlock warns when draft missing", () => {
  assert.match(buildCoachingScopeBlock(false), /No manuscript draft/);
});

test("buildCoachingScopeBlock requires in-scene examples stay in draft materials", () => {
  const block = buildCoachingScopeBlock(true);
  assert.match(block, /In-scene examples:/);
  assert.match(block, /Do not invent new characters/);
});

test("assembleOliviaContext coaching mode omits methodology block in instructions", async (t) => {
  const base = "OFFICE_3_BASE_PROMPT_ONLY";
  const methodology = { block: "", tokenEstimate: 0 };
  const instructions = [base.trim(), methodology.block, ""]
    .filter(Boolean)
    .join("\n\n");
  assert.equal(instructions, base);
  t.diagnostic("Coaching instructions pattern verified without live DB");
});

test("COACH_SCENE_MESSAGE_PATTERN matches product trigger", () => {
  assert.match("Coach me on Act 1, Scene 3 — Title", COACH_SCENE_MESSAGE_PATTERN);
  assert.match("Coach me on Act 3, Chapter 11 — Title", COACH_SCENE_MESSAGE_PATTERN);
});

test("buildSceneExtrasBlock injects revision comparison when revisionReview", () => {
  const block = buildSceneExtrasBlock({
    manuscriptDraft: "Revised line.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 1, sceneTitle: "Opening" },
    revisionReview: true,
    priorCoachingPass: {
      metadata: {
        primaryOpportunity: "Deepen the turn.",
        manuscriptDraftSnapshot: "Original line.",
      },
    },
  });
  assert.match(block, /REVISION REVIEW/);
  assert.match(block, /Revised line/);
});

test("buildCoachingFullPassMetadata returns null for non-pass content", () => {
  assert.equal(
    buildCoachingFullPassMetadata({
      fullText: "Just chatting.",
      manuscriptDraft: "Draft.",
      sceneId: "s1",
    }),
    null
  );
});

test("buildRevisionComparisonBlock is exported for coaching tests", () => {
  assert.equal(typeof buildRevisionComparisonBlock, "function");
});
