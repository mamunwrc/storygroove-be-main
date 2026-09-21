import test from "node:test";
import assert from "node:assert/strict";

import {
  COACHING_INTENT,
  COACHING_CONVERSATIONAL_CTA,
  parseGateFollowUpOption,
  sanitizeCoachingConversationalClose,
} from "../service/oliviaCoachingGate.js";
import {
  buildFullCoachingPassRequestedBlock,
  buildSceneExtrasBlock,
} from "../service/oliviaDynamicContext.js";
import {
  hasDraftChangedSincePriorPass,
  isFullCoachingPass,
} from "../service/oliviaRevisionIntelligence.js";

test("parseGateFollowUpOption maps option 1 phrases to full_coaching_pass", () => {
  const optionOnePhrases = [
    "full coaching pass",
    "option one",
    "option 1",
    "yes, complete",
    "I'm treating this chapter as complete",
    "ready for a full pass",
    "done with this chapter",
  ];
  for (const phrase of optionOnePhrases) {
    assert.equal(
      parseGateFollowUpOption(phrase, ""),
      COACHING_INTENT.FULL_COACHING_PASS,
      `expected option 1 for: ${phrase}`
    );
  }
});

test("parseGateFollowUpOption maps option 2 phrases to revision_review", () => {
  const optionTwoPhrases = [
    "I already revised it",
    "option two",
    "option 2",
    "compare my revision",
    "I made the changes",
    "take another look at my revision",
  ];
  for (const phrase of optionTwoPhrases) {
    assert.equal(
      parseGateFollowUpOption(phrase, ""),
      COACHING_INTENT.REVISION_REVIEW,
      `expected option 2 for: ${phrase}`
    );
  }
});

test("parseGateFollowUpOption maps option 3 phrases to brainstorm", () => {
  const optionThreePhrases = [
    "still drafting",
    "option three",
    "option 3",
    "I'm feeling stuck",
    "let's brainstorm",
  ];
  for (const phrase of optionThreePhrases) {
    assert.equal(
      parseGateFollowUpOption(phrase, ""),
      COACHING_INTENT.BRAINSTORM,
      `expected option 3 for: ${phrase}`
    );
  }
});

test("parseGateFollowUpOption prefers explicit coachingIntent from quick replies", () => {
  assert.equal(
    parseGateFollowUpOption("anything", COACHING_INTENT.FULL_COACHING_PASS),
    COACHING_INTENT.FULL_COACHING_PASS
  );
  assert.equal(
    parseGateFollowUpOption("already revised", COACHING_INTENT.FULL_COACHING_PASS),
    COACHING_INTENT.FULL_COACHING_PASS
  );
});

test("gate option 1 overrides Fix 6 draft-changed revision routing", () => {
  const priorPass = {
    metadata: { draftContentHash: "old-hash" },
  };
  const currentDraftHash = "new-hash";
  const draftChangedSincePass = hasDraftChangedSincePriorPass({
    priorPass,
    currentDraftHash,
  });
  assert.equal(draftChangedSincePass, true);

  const gateFollowUp = parseGateFollowUpOption("full coaching pass", "");
  assert.equal(gateFollowUp, COACHING_INTENT.FULL_COACHING_PASS);

  let revisionReview = draftChangedSincePass;
  let fullCoachingPassRequested = false;
  if (gateFollowUp === COACHING_INTENT.FULL_COACHING_PASS) {
    revisionReview = false;
    fullCoachingPassRequested = true;
  }
  assert.equal(revisionReview, false);
  assert.equal(fullCoachingPassRequested, true);
});

test("buildSceneExtrasBlock with fullCoachingPassRequested injects full-pass block only", () => {
  const block = buildSceneExtrasBlock({
    manuscriptDraft: "Current draft line.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 3, sceneTitle: "Rooftop" },
    revisionReview: true,
    fullCoachingPassRequested: true,
    priorCoachingPass: {
      metadata: {
        primaryOpportunity: "Deepen the turn.",
        manuscriptDraftSnapshot: "Original line.",
      },
    },
  });
  assert.match(block, /FULL PASS \(gate option 1\)/);
  assert.match(block, /full coaching pass structure/);
  assert.doesNotMatch(block, /REVISION REVIEW/);
});

test("buildFullCoachingPassRequestedBlock excludes revision assessment", () => {
  const block = buildFullCoachingPassRequestedBlock();
  assert.match(block, /Do NOT deliver the Revision Assessment Template/);
  assert.match(block, /fresh full read/);
});

test("sanitizeCoachingConversationalClose strips trailing 'If you want, I can sketch' offer", () => {
  const reply = [
    "That could work very well, but only if it sharpens the scene's power map.",
    "",
    "So yes — I like it if he is part of the party's power structure.",
    "",
    "If you want, I can sketch exactly how Danielle's husband could be threaded into Scene 3 in 3-4 beats without stealing the scene from Sienna and Camila.",
  ].join("\n");
  const out = sanitizeCoachingConversationalClose(reply);
  assert.doesNotMatch(out, /If you want, I can sketch/i);
  assert.match(out, /power structure\./);
  assert.ok(out.trim().endsWith(COACHING_CONVERSATIONAL_CTA));
});

test("sanitizeCoachingConversationalClose strips branching question and 'three versions' offers", () => {
  const a = "Here is my read.\n\nWould you like me to show you A, B, or C?";
  const b = "Here is my read.\n\nI can help you shape three versions of the open.";
  for (const reply of [a, b]) {
    const out = sanitizeCoachingConversationalClose(reply);
    assert.match(out, /Here is my read\./);
    assert.doesNotMatch(out, /Would you like me to/i);
    assert.doesNotMatch(out, /three versions/i);
    assert.ok(out.trim().endsWith(COACHING_CONVERSATIONAL_CTA));
  }
});

test("sanitizeCoachingConversationalClose replaces an existing CTA variant without duplicating", () => {
  const reply =
    "Nico belongs to a different thread.\n\n👉 Let me know if this makes sense, or if you want to dig deeper.";
  const out = sanitizeCoachingConversationalClose(reply);
  const ctaCount = (out.match(/👉/g) || []).length;
  assert.equal(ctaCount, 1);
  assert.ok(out.trim().endsWith(COACHING_CONVERSATIONAL_CTA));
  assert.match(out, /Nico belongs to a different thread\./);
});

test("sanitizeCoachingConversationalClose appends a single CTA to an offer-free reply", () => {
  const reply = "Not in this scene. Camila is the pressure source here.";
  const out = sanitizeCoachingConversationalClose(reply);
  assert.equal((out.match(/👉/g) || []).length, 1);
  assert.ok(out.trim().endsWith(COACHING_CONVERSATIONAL_CTA));
  assert.match(out, /Camila is the pressure source here\./);
});

test("sanitizeCoachingConversationalClose is idempotent", () => {
  const reply =
    "Here is my read.\n\nIf you want, I can draft a beat for this.";
  const once = sanitizeCoachingConversationalClose(reply);
  const twice = sanitizeCoachingConversationalClose(once);
  assert.equal(once, twice);
  assert.equal((twice.match(/👉/g) || []).length, 1);
});

test("sanitizeCoachingConversationalClose returns original when stripping empties the reply", () => {
  const reply = "If you want, I can sketch three versions.";
  const out = sanitizeCoachingConversationalClose(reply);
  assert.equal(out, reply.trim());
});

test("a six-part full pass is detected so the controller leaves it untouched", () => {
  const fullPass = [
    "### 1. What's Working",
    "Strong opening voice.",
    "",
    "### 2. Primary Opportunity",
    "The turn lands too fast.",
    "",
    "### 6. Forward Momentum Close",
    "Keep going — you have the engine.",
  ].join("\n");
  assert.equal(isFullCoachingPass(fullPass), true);
});
