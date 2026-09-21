import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const promptPath = path.join(repoRoot, "ellis-scene-architect.txt");
const promptV2Path = path.join(repoRoot, "ellis-scene-architect-v2.txt");
const promptV3Path = path.join(repoRoot, "ellis-scene-architect-v3.txt");
const promptV4Path = path.join(repoRoot, "ellis-scene-architect-v4.txt");
const readIfPresent = (filePath) =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
const prompt = readIfPresent(promptPath);
const promptV2 = readIfPresent(promptV2Path);
const promptV3 = fs.readFileSync(promptV3Path, "utf8");
const promptV4 = fs.readFileSync(promptV4Path, "utf8");

test("ellis-scene-architect includes Follow-up Containment Protocol", { skip: !prompt }, () => {
  assert.match(prompt, /## Follow-up Containment Protocol/);
  assert.match(
    prompt,
    /whenever Ellis is in follow-up or conversational mode/
  );
  assert.match(prompt, /maximum of two related next-step options/);
  assert.match(
    prompt,
    /We've pressure-tested this chapter\/issue well/
  );
  assert.match(prompt, /does not apply when delivering a full chapter review kickoff/);
});

test("ellis-scene-architect reconciles workflow rules with containment", { skip: !prompt }, () => {
  assert.match(prompt, /see Follow-up Containment Protocol/);
  assert.match(prompt, /Continuation Protocol \(kickoff delivery only\)/);
  assert.match(
    prompt,
    /does not apply to follow-up Q&A after the review is complete/
  );
});

test("ellis-scene-architect preserves kickoff output standard", { skip: !prompt }, () => {
  assert.match(prompt, /## Output Standard/);
  assert.match(prompt, /Chapter Cumulative Editorial Note/);
});

test("ellis-scene-architect requires theory plus in-scene examples", { skip: !prompt }, () => {
  assert.match(
    prompt,
    /Creative Suggestions must prioritize real-time scene action/
  );
  assert.match(prompt, /mini-rewrite/);
  assert.match(prompt, /👉 Example 1:/);
  assert.match(prompt, /Creative Suggestion Name:/);
});

test("ellis-scene-architect gates completion to final chapter", { skip: !prompt }, () => {
  assert.match(prompt, /After analyzing the final chapter, conclude with:/);
  assert.match(prompt, /This concludes your first developmental edit pass/);
});

test("ellis-scene-architect-v2 uses original depth mechanism for Creative Suggestions", { skip: !promptV2 }, () => {
  assert.match(promptV2, /If multiple weaknesses exist, repeat only the weakness template/);
  assert.doesNotMatch(promptV2, /one package per distinct issue/i);
  assert.doesNotMatch(promptV2, /two Structural packages/);
  assert.doesNotMatch(promptV2, /Default: at most one Structural and one Character package/);
});

test("ellis-scene-architect-v2 keeps original Scene Analysis wording", { skip: !promptV2 }, () => {
  assert.match(promptV2, /Paragraph 1: Structural evaluation with actionable revision guidance\./);
  assert.match(promptV2, /Paragraph 2: Character evaluation with actionable revision guidance\./);
  assert.doesNotMatch(promptV2, /name each so it can be addressed on its own/);
  assert.doesNotMatch(promptV2, /never manufacture a second issue to look thorough/);
});

test("ellis-scene-architect-v3 uses Editorial Logic and Application Example labels", () => {
  const editorialLogicMatches = promptV3.match(/👉 Editorial Logic:/g) || [];
  assert.equal(editorialLogicMatches.length, 2);
  assert.doesNotMatch(promptV3, /👉 Description:/);
  assert.match(promptV3, /👉 Application Example 1:/);
  assert.match(promptV3, /👉 Application Example 2:/);
});

test("ellis-scene-architect-v3 uses presentation-only conversational formatting guidance", () => {
  assert.doesNotMatch(promptV3, /Stay in prose\./);
  assert.match(promptV3, /presentation only/i);
  assert.match(
    promptV3,
    /Do not begin or append in the same response: Function in Story, Genre Beat Check, Scene Analysis, Creative Suggestions, or Chapter Cumulative Editorial Note/
  );
  assert.match(
    promptV3,
    /This lightweight formatting never means emitting the chapter-review Output Standard sections/
  );
});

test("ellis-scene-architect-v3 conversational mode stays on the asked topic", () => {
  assert.match(promptV3, /Stay on that one topic/);
  assert.match(
    promptV3,
    /Do not recap the chapter, list what is working or not working, or volunteer a mini-review/
  );
  assert.match(
    promptV3,
    /do not narrate DEVELOPMENTAL PASS PROGRESS, unless the writer asked/
  );
  assert.match(
    promptV3,
    /These depth-and-style rules apply only in CHAPTER REVIEW KICKOFF MODE/
  );
});

test("ellis-scene-architect-v4 conversational mode stays on the asked topic", () => {
  assert.match(promptV4, /Stay on that one topic/);
  assert.match(
    promptV4,
    /Do not recap the chapter, list what is working or not working, or volunteer a mini-review/
  );
  assert.match(
    promptV4,
    /do not narrate DEVELOPMENTAL PASS PROGRESS, unless the writer asked/
  );
  assert.match(
    promptV4,
    /These depth-and-style rules apply only in CHAPTER REVIEW KICKOFF MODE/
  );
  assert.doesNotMatch(
    promptV4,
    /If a TURN SIGNAL is present for this message, follow that signal/
  );
  assert.match(
    promptV4,
    /A question about the Insert button, the app UI, or why something appeared is never a chapter review/
  );
});

test("ellis-scene-architect-v4 conversation beats sidebar after insert-confirm yes", () => {
  assert.match(promptV4, /\*\*CONVERSATION OVER SIDEBAR \(CRITICAL\):\*\*/);
  assert.match(
    promptV4,
    /The writer's open\/sidebar chapter is never the topic/
  );
  assert.match(
    promptV4,
    /agreement to continue is a kickoff for Chapter X/
  );
  assert.match(
    promptV4,
    /It does not apply when the writer is affirming an insert-confirm/
  );
});

test("ellis-scene-architect-v4 a question about another chapter is not a kickoff", () => {
  assert.match(
    promptV4,
    /I wonder if I need to break Chapter Ten into different chapters/
  );
  assert.match(
    promptV4,
    /Do not treat a question about another chapter as a kickoff/
  );
  assert.match(
    promptV4,
    /If they only \*\*asked a question\*\* about that chapter/
  );
  assert.match(
    promptV4,
    /Quoting the writer's own manuscript is allowed and expected when they ask/
  );
});

test("ellis-scene-architect-v4 owns kickoff vs conversation vs revision", () => {
  assert.match(promptV4, /## CONVERSATION vs DELIVERY SEPARATION/);
  assert.match(promptV4, /\*\*POSITIVE REPLIES — PROCEED:\*\*/);
  assert.match(
    promptV4,
    /Agreement to continue after you invited the next chapter is kickoff/
  );
  assert.match(
    promptV4,
    /Let's start with Chapter One/
  );
  assert.match(
    promptV4,
    /Do not substitute a one-line POV, tense, or "written in" fact for the pass/
  );
  assert.match(
    promptV4,
    /next open is Chapter Five, not Chapter Six/
  );
  assert.match(
    promptV4,
    /stale next-open invite does not outrank/
  );
  assert.match(
    promptV4,
    /There is no separate pre-classifier picking the chapter for you/
  );
  assert.match(promptV4, /chapter in play/);
  assert.match(
    promptV4,
    /Ok great\. Now let's do the edi/
  );
  assert.match(
    promptV4,
    /kickoff for \*\*Chapter Seven\*\*, not Chapter Four/
  );
  assert.match(
    promptV4,
    /Do not open with "Chapter Four – POV" or "Chapter Three – POV"/
  );
  assert.match(promptV4, /Wrong-body hard stop/);
  assert.match(
    promptV4,
    /Never reply "Chapter One already has a developmental review in this thread"/
  );
  assert.match(
    promptV4,
    /Never praise "this revised Chapter One"/
  );
  assert.match(
    promptV4,
    /📌 To save anything you want to revisit, highlight the feedback and add it to Chapter Notes/
  );
  assert.match(
    promptV4,
    /Never end a Q&A reply with "Chapter feedback complete"/
  );
  assert.match(
    promptV4,
    /ok let's review chapter 7/
  );
  assert.match(
    promptV4,
    /Do not ask which chapter they want when the thread already named one/
  );
  assert.match(
    promptV4,
    /Never claim you lack the manuscript when the chapter text is in context/
  );
  assert.match(promptV4, /never convert 1\.5 into Chapter One A/);
  assert.match(promptV4, /never the title alone/);
  assert.match(promptV4, /stored map heading supplied with the chapter text/);
  assert.doesNotMatch(promptV4, /MANDATORY REVIEW OPENER/);
  assert.doesNotMatch(promptV4, /CURRENT CHAPTER UNDER REVIEW/);
  assert.match(promptV4, /\*\*REVISION REVIEW MODE\*\*/);
  assert.match(promptV4, /Never announce the mode to the writer/);
  assert.match(
    promptV4,
    /already has ORIGINAL CHAPTER EDITS or a PRIOR DEVELOPMENTAL REVIEW/
  );
  assert.match(promptV4, /Ellis decides the mode from the writer's meaning/);
  assert.match(promptV4, /load_manuscript_chapters/);
  assert.match(promptV4, /short form of a map title/);
});

test("ellis-scene-architect-v3 invites the specific question on permission/meta questions", () => {
  assert.match(promptV3, /Permission \/ meta questions/);
  assert.match(
    promptV3,
    /do NOT assume, guess, or pre-empt the question/
  );
  assert.match(
    promptV3,
    /Wait for the writer to state their actual question before answering/
  );
});

test("ellis-scene-architect-v3 affirms review of the named chapter after let's review that", () => {
  assert.match(
    promptV3,
    /if the writer affirms a review after you just named a specific chapter/
  );
  assert.match(promptV3, /let's review that/);
  assert.match(
    promptV3,
    /deliver the full review for \*\*that named chapter\*\*/
  );
});

test("ellis-scene-architect-v3 answers cross-chapter questions instead of refusing/redirecting", () => {
  assert.match(promptV3, /Cross-Chapter Agentic Awareness/);
  assert.match(
    promptV3,
    /Do not redirect the writer back to the chapter under review, refuse to engage, or claim you can only discuss the current chapter/
  );
});

test("ellis-scene-architect-v3 narrows creative-engine protection so chapter facts are always answerable", () => {
  assert.match(
    promptV3,
    /a chapter's title or label \(including after a rename\), its POV character, its timeline/
  );
  assert.match(
    promptV3,
    /never decline, hedge, or say "I can't disclose that" for this kind of factual question/
  );
});

test("ellis-scene-architect-v3 never asks the writer to paste manuscript text", () => {
  assert.match(
    promptV3,
    /Never ask the writer to paste chapter text, manuscript text, or specific lines\/sentences\/paragraphs/
  );
  assert.match(
    promptV3,
    /Ellis must never ask the writer to paste manuscript text, chapter text, or specific lines\/sentences\/paragraphs to answer a question/
  );
});

test("ellis-scene-architect-v3 forbids open-ended next-step offers that cause loops", () => {
  assert.doesNotMatch(promptV3, /maximum of two related next-step options/);
  assert.match(
    promptV3,
    /Most conversational answers should simply answer the question and stop — no offered next step at all/
  );
  assert.match(
    promptV3,
    /Ellis must NOT append open-ended offers of further work/
  );
  assert.match(
    promptV3,
    /Never use the 👉 pointing hand to offer optional work in conversation/
  );
  assert.match(promptV3, /manufacture yes\/yes loops/);
  assert.match(
    promptV3,
    /Offering to "next isolate," "break this into what to keep\/trim," or otherwise re-deliver the editorial work in another form is not a next step — it is redundant/
  );
});

test("ellis chat backend JS has no TURN SIGNAL or mini chapter classifier", () => {
  const files = [
    path.join(repoRoot, "storygroove-be/service/ellisDynamicContext.js"),
    path.join(repoRoot, "storygroove-be/controllers/novelController.js"),
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /TURN SIGNAL \(/);
    assert.doesNotMatch(src, /You route Ellis/);
    assert.doesNotMatch(src, /isEllisCraftQuestionMessage/);
    assert.doesNotMatch(src, /classifyEllisChapterWithModel/);
    assert.doesNotMatch(src, /ELLIS_CHAPTER_RESOLVER_MODEL/);
  }
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "storygroove-be/service/ellisUserActionResolver.js")
    ),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "storygroove-be/service/ellisChapterResolver.js")
    ),
    false
  );
});

