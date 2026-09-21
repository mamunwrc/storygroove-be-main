import test from "node:test";
import assert from "node:assert/strict";
import {
  isEllisDevelopmentalReviewText,
  isEllisConversationalCloseText,
  isEllisRevisionCheckFeedbackText,
  resolveEllisAssistantTurnKind,
  resolveEllisDeliveredReviewChapter,
} from "../service/ellisChapterReviewService.js";
import {
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_CONVERSATIONAL,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
} from "../constants/ellisUiMessages.js";

const SAMPLE_REVIEW = `
Chapter One — POV: Darien

Function in Story: Opening Image / Comic-Disaster Hook

Genre Beat Check: This scene establishes the humorous fiction promise.

Scene Analysis
This scene opens with strong comic energy but delays the corporate satire engine.

Creative Suggestions
Structural Weakness: Late corporate engine
Creative Suggestion Name: "Let the Cell Smell Like Silicon Valley"

Chapter Cumulative Editorial Note
As a whole, this chapter establishes the comic-disaster frame.
The reader should leave this chapter feeling amused but uneasy, because the opening promises disruption.
`.repeat(2);

test("isEllisDevelopmentalReviewText detects a review glued onto a long custom opener", () => {
  const jammed = `
Epilogue - September- 1936 - California – POV: Myla Function in Story: This chapter closes the occult cost in Myla's body after the school collapse.
Genre Beat Check: The horror ending must land as earned consequence, not a leftover scare.
Scene Analysis: The California close still talks more than it costs, and the last image does not yet force a choice.
Creative Suggestions
Structural Weakness: The last turn explains instead of charging
Creative Suggestion Name: Make the last hallway cost her
`.repeat(2);
  assert.equal(isEllisDevelopmentalReviewText(jammed), true);
});

test("isEllisDevelopmentalReviewText detects a truncated kickoff missing the cumulative note", () => {
  const truncated = `
Emon Work - September 1936 - California – POV: Myla

Function in Story
This chapter's job is to make the supernatural cost something in Myla's body.

Genre Beat Check
The occult pressure is no longer theoretical.

Scene Analysis
School becomes the stage where grief and paranoia collapse into each other.

Creative Suggestions
Structural Weakness: The reveal still talks more than it costs
Creative Suggestion Name: Make the hallway cost her
`.repeat(2);
  assert.equal(isEllisDevelopmentalReviewText(truncated), true);
});

test("isEllisDevelopmentalReviewText rejects agentic meta-discussion on backend", () => {
  const agenticMeta = `Your Scene Analysis was stronger. The Creative Suggestion about Betty was sharper.
Function in Story framing was better in your earlier note.
We've pressure-tested this chapter/issue well.`;
  assert.equal(isEllisDevelopmentalReviewText(agenticMeta), false);
});

test("isEllisDevelopmentalReviewText rejects prose that name-drops the labels inline", () => {
  // Long enough, no containment-close, and mentions every section label — but
  // only mid-sentence, never as a line-leading header. The old substring gate
  // accepted this; the structural gate must reject it.
  const chatty =
    "Great question — let me walk you through my thinking without redoing the pass. " +
    "In terms of Function in Story, this chapter is really about establishing dread, " +
    "and the Genre Beat Check I'd apply is the horror midpoint promise where the threat " +
    "stops being theoretical and starts costing the protagonist something real. " +
    "Your earlier Scene Analysis already nailed the pacing beats, and the Creative Suggestions " +
    "you drafted about the hallway confrontation were genuinely sharp and worth keeping. " +
    "So I don't think you need a fresh review here — your instincts on this chapter are good.";
  assert.ok(chatty.length >= 400);
  assert.equal(isEllisDevelopmentalReviewText(chatty), false);
});

test("isEllisConversationalCloseText detects containment close on backend", () => {
  assert.equal(
    isEllisConversationalCloseText("We've pressure-tested this chapter/issue well."),
    true
  );
});

test("isEllisRevisionCheckFeedbackText requires the revision-check close, not length", () => {
  const apology =
    "Yes — that was my miss. You asked for a revision pass on **Chapter 6.5**, and I answered **Chapter Eight** because that was the chapter in front of me. The right target was 6.5.";
  assert.equal(isEllisRevisionCheckFeedbackText(apology), false);
  assert.equal(
    isEllisRevisionCheckFeedbackText(
      "Lucille's emotional clarity is stronger now. ".repeat(20)
    ),
    false
  );
  assert.equal(
    isEllisRevisionCheckFeedbackText(
      "The revised opening is stronger.\n\n*👉 Chapter feedback complete.* Do you have any questions for me? If I missed something important, tell me and we can talk it through.\n\n📌 To save anything you want to revisit, highlight the feedback and add it to Chapter Notes."
    ),
    true
  );
});

test("resolveEllisAssistantTurnKind prefers revision review when a first-pass already exists", () => {
  assert.equal(isEllisDevelopmentalReviewText(SAMPLE_REVIEW), true);
  assert.equal(
    resolveEllisAssistantTurnKind({
      text: SAMPLE_REVIEW,
      hasOriginalPlan: true,
    }),
    ELLIS_METADATA_KIND_REVISION_REVIEW
  );
  assert.equal(
    resolveEllisAssistantTurnKind({
      text: SAMPLE_REVIEW,
      hasOriginalPlan: false,
    }),
    ELLIS_METADATA_KIND_CHAPTER_REVIEW
  );
  assert.equal(
    resolveEllisAssistantTurnKind({ text: "Ok.", hasOriginalPlan: true }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
  assert.equal(
    resolveEllisAssistantTurnKind({
      text: "Lucille's emotional clarity is stronger now. ".repeat(20),
      hasOriginalPlan: true,
    }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
  assert.equal(
    resolveEllisAssistantTurnKind({
      text:
        "The revised opening is stronger.\n\n📌 To save anything you want to revisit, highlight the feedback and add it to Chapter Notes.",
      hasOriginalPlan: false,
    }),
    ELLIS_METADATA_KIND_REVISION_REVIEW
  );
  assert.equal(
    resolveEllisAssistantTurnKind({
      text: "Lucille's emotional clarity is stronger now. ".repeat(20),
      hasOriginalPlan: false,
    }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
});

test("resolveEllisDeliveredReviewChapter uses the Output Standard opener, not the thread chapter", () => {
  const one = {
    _id: "one",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>One</p>",
  };
  const two = {
    _id: "two",
    chapterNumber: 2,
    chapterLabel: "Chapter Two",
    userContent: "<p>Two</p>",
  };
  const ch2Review = SAMPLE_REVIEW.replace(/Chapter One/g, "Chapter Two");
  const delivered = resolveEllisDeliveredReviewChapter({
    text: ch2Review,
    userContents: [one, two],
    fallback: one,
  });
  assert.equal(String(delivered._id), "two");
  const conversational = resolveEllisDeliveredReviewChapter({
    text: "Yes. Move to Chapter Two. Chapter One is strong enough.",
    userContents: [one, two],
    fallback: one,
  });
  assert.equal(String(conversational._id), "one");
});

test("resolveEllisDeliveredReviewChapter matches a custom Epilogue opener", () => {
  const epi = {
    _id: "epi",
    chapterNumber: 12,
    chapterLabel: "Epilogue - September- 1936 - California",
    userContent: "<p>End</p>",
  };
  const one = {
    _id: "one",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>One</p>",
  };
  const jammed = `
Epilogue - September- 1936 - California – POV: Myla Function in Story: This chapter closes the occult cost in Myla's body after the school collapse.
Genre Beat Check: The horror ending must land as earned consequence, not a leftover scare.
Scene Analysis: The California close still talks more than it costs, and the last image does not yet force a choice.
Creative Suggestions
Structural Weakness: The last turn explains instead of charging
Creative Suggestion Name: Make the last hallway cost her
`.repeat(2);
  const delivered = resolveEllisDeliveredReviewChapter({
    text: jammed,
    userContents: [one, epi],
    fallback: one,
  });
  assert.equal(String(delivered._id), "epi");
});

