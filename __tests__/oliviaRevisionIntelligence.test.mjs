import test from "node:test";
import assert from "node:assert/strict";

import { COACHING_INTENT } from "../service/oliviaCoachingGate.js";
import { OLIVIA_METADATA_KIND_COACHING_FULL_PASS } from "../constants/oliviaUiMessages.js";
import {
  buildCoachingFullPassMetadata,
  hashManuscriptDraft,
  hasDraftChangedSincePriorPass,
  isDraftUnchangedSinceFullPass,
  isFullCoachingPass,
  isRevisionReviewTrigger,
  parsePrimaryOpportunity,
  shouldRunRevisionReview,
} from "../service/oliviaRevisionIntelligence.js";
import {
  MANUSCRIPT_DRAFT_MAX_CHARS,
  buildDraftUnchangedSinceFullPassBlock,
  buildManuscriptDraftMissingBlock,
  buildRevisionComparisonBlock,
  buildSceneExtrasBlock,
} from "../service/oliviaDynamicContext.js";

const SAMPLE_FULL_PASS = `### 1. What's Working
Strong opening voice.

### 2. Primary Opportunity
The emotional turn lands too fast for the outline beat.

### 3. Coaching Guidance
Give the reaction one more beat of room.`;

test("isFullCoachingPass detects six-part headings", () => {
  assert.equal(isFullCoachingPass(SAMPLE_FULL_PASS), true);
  assert.equal(isFullCoachingPass("Here is some casual feedback."), false);
});

test("parsePrimaryOpportunity extracts section 2", () => {
  const text = parsePrimaryOpportunity(SAMPLE_FULL_PASS);
  assert.match(text, /emotional turn lands too fast/i);
});

test("hashManuscriptDraft is stable for same text", () => {
  const a = hashManuscriptDraft("  Draft line.  ");
  const b = hashManuscriptDraft("Draft line.");
  assert.equal(a, b);
  assert.notEqual(a, hashManuscriptDraft("Other draft."));
});

test("buildCoachingFullPassMetadata stores snapshot and primary opportunity", () => {
  const meta = buildCoachingFullPassMetadata({
    fullText: SAMPLE_FULL_PASS,
    manuscriptDraft: "She paused at the door.",
    sceneId: "scene-1",
    coachSceneMeta: { actNumber: 1, sceneIndex: 2, sceneTitle: "Opening" },
  });
  assert.ok(meta);
  assert.equal(meta.kind, OLIVIA_METADATA_KIND_COACHING_FULL_PASS);
  assert.equal(meta.sceneId, "scene-1");
  assert.match(meta.manuscriptDraftSnapshot, /paused at the door/);
  assert.match(meta.primaryOpportunity, /emotional turn/i);
  assert.equal(meta.draftContentHash, hashManuscriptDraft("She paused at the door."));
});

test("buildCoachingFullPassMetadata hashes full draft while snapshot is capped", () => {
  const fullDraft = `${"word ".repeat(9000)}tail change marker`;
  assert.ok(fullDraft.length > MANUSCRIPT_DRAFT_MAX_CHARS);
  const meta = buildCoachingFullPassMetadata({
    fullText: SAMPLE_FULL_PASS,
    manuscriptDraft: fullDraft,
    sceneId: "scene-long",
    coachSceneMeta: { actNumber: 1, sceneIndex: 1 },
  });
  assert.ok(meta);
  assert.ok(meta.manuscriptDraftSnapshot.length < fullDraft.length);
  assert.ok(meta.manuscriptDraftSnapshot.length <= MANUSCRIPT_DRAFT_MAX_CHARS);
  assert.equal(meta.draftContentHash, hashManuscriptDraft(fullDraft));
  assert.notEqual(meta.draftContentHash, hashManuscriptDraft(meta.manuscriptDraftSnapshot));
  const revisedTail = `${"word ".repeat(9000)}different tail`;
  assert.notEqual(meta.draftContentHash, hashManuscriptDraft(revisedTail));
});

test("isRevisionReviewTrigger for coach re-click and chat phrases", () => {
  assert.equal(
    isRevisionReviewTrigger({
      coachTrigger: true,
      gateAlreadyAsked: true,
      message: "Coach me on Act 1, Scene 1 — Title",
    }),
    true
  );
  assert.equal(
    isRevisionReviewTrigger({ message: "I've revised, ready for another pass" }),
    true
  );
  assert.equal(
    isRevisionReviewTrigger({
      coachingIntent: COACHING_INTENT.REVISION_REVIEW,
      message: "hello",
    }),
    true
  );
  assert.equal(
    isRevisionReviewTrigger({
      coachTrigger: true,
      gateAlreadyAsked: false,
      message: "Coach me on Act 1, Scene 1",
    }),
    false
  );
});

test("isRevisionReviewTrigger matches natural revision phrasing", () => {
  const phrases = [
    "I'm done revising the chapter, can you take another look?",
    "I made the changes you suggested",
    "I made the edits",
    "okay I updated it",
    "take another look please",
    "look again at the scene",
    "read the chapter again",
    "done editing",
  ];
  for (const message of phrases) {
    assert.equal(
      isRevisionReviewTrigger({ message }),
      true,
      `expected revision trigger for: ${message}`
    );
  }
  // A plain follow-up question should not trigger revision review on its own.
  assert.equal(
    isRevisionReviewTrigger({ message: "what did you mean by the second point?" }),
    false
  );
});

test("hasDraftChangedSincePriorPass detects revised draft via hash diff", () => {
  const priorHash = hashManuscriptDraft("Old draft.");
  const priorPass = { metadata: { draftContentHash: priorHash } };
  assert.equal(
    hasDraftChangedSincePriorPass({
      priorPass,
      currentDraftHash: hashManuscriptDraft("New draft."),
    }),
    true
  );
  assert.equal(
    hasDraftChangedSincePriorPass({
      priorPass,
      currentDraftHash: priorHash,
    }),
    false
  );
  // No prior pass or no current hash → not a revision turn.
  assert.equal(
    hasDraftChangedSincePriorPass({ priorPass: null, currentDraftHash: priorHash }),
    false
  );
  assert.equal(
    hasDraftChangedSincePriorPass({ priorPass, currentDraftHash: "" }),
    false
  );
});

test("shouldRunRevisionReview requires hash change and prior pass", () => {
  const priorHash = hashManuscriptDraft("Old draft.");
  const priorPass = { metadata: { draftContentHash: priorHash } };
  assert.equal(
    shouldRunRevisionReview({
      priorPass,
      currentDraftHash: hashManuscriptDraft("New draft."),
      trigger: true,
    }),
    true
  );
  assert.equal(
    shouldRunRevisionReview({
      priorPass,
      currentDraftHash: priorHash,
      trigger: true,
    }),
    false
  );
  assert.equal(
    isDraftUnchangedSinceFullPass({
      priorPass,
      currentDraftHash: priorHash,
      trigger: true,
    }),
    true
  );
});

test("buildRevisionComparisonBlock includes prior opportunity and snapshot only", () => {
  const block = buildRevisionComparisonBlock({
    priorPass: {
      metadata: {
        primaryOpportunity: "Slow the emotional turn.",
        manuscriptDraftSnapshot: "Old prose here.",
        actNumber: 1,
        sceneIndex: 1,
        sceneTitle: "Opening",
      },
    },
    currentDraft: "Revised prose here.",
    coachSceneMeta: { actNumber: 1, sceneIndex: 1, sceneTitle: "Opening" },
  });
  assert.match(block, /REVISION REVIEW/);
  assert.match(block, /Slow the emotional turn/);
  assert.match(block, /Old prose here/);
  assert.match(block, /WRITER'S MANUSCRIPT DRAFT block below/i);
  assert.doesNotMatch(block, /Revised prose here/);
});

test("buildSceneExtrasBlock revision mode includes current draft once", () => {
  const coachSceneMeta = { actNumber: 1, sceneIndex: 1, sceneTitle: "Opening" };
  const block = buildSceneExtrasBlock({
    coachSceneMeta,
    manuscriptDraft: "Revised prose here.",
    revisionReview: true,
    priorCoachingPass: {
      metadata: {
        primaryOpportunity: "Slow the emotional turn.",
        manuscriptDraftSnapshot: "Old prose here.",
      },
    },
  });
  const occurrences = (block.match(/Revised prose here/g) || []).length;
  assert.equal(occurrences, 1);
  assert.match(block, /Old prose here/);
});

test("buildDraftUnchangedSinceFullPassBlock instructs no revision pass", () => {
  const block = buildDraftUnchangedSinceFullPassBlock();
  assert.match(block, /unchanged since the last full coaching pass/i);
});

test("buildManuscriptDraftMissingBlock tells Olivia not to ask for a paste", () => {
  const block = buildManuscriptDraftMissingBlock();
  assert.match(block, /no manuscript draft|no draft prose/i);
  assert.match(block, /do not ask the writer to paste/i);
  assert.match(block, /open or add the draft/i);
});

test("buildSceneExtrasBlock emits missing-draft note only when no draft", () => {
  const coachSceneMeta = { actNumber: 1, sceneIndex: 1, sceneTitle: "Opening" };
  const withMissing = buildSceneExtrasBlock({
    coachSceneMeta,
    manuscriptDraft: "",
    manuscriptDraftMissing: true,
  });
  assert.match(withMissing, /do not ask the writer to paste/i);

  // When a draft is present, the missing-draft note must not appear.
  const withDraft = buildSceneExtrasBlock({
    coachSceneMeta,
    manuscriptDraft: "She paused at the door.",
    manuscriptDraftMissing: true,
  });
  assert.doesNotMatch(withDraft, /do not ask the writer to paste/i);
});
