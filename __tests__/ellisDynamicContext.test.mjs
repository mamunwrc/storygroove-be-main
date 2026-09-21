import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEllisChapterNumberFromMessage,
  parseEllisChapterRefFromMessage,
  parseEllisBareChapterRef,
  parseEllisBareSectionLabel,
  parseEllisReviewSectionLabelFromHeader,
  ELLIS_CHAPTER_REFERENCE_BANNER,
  ELLIS_NEXT_MAP_CHAPTER_BANNER,
  ELLIS_REVISED_CHAPTER_BANNER,
  resolveEllisRevisionCandidateRows,
  resolveFocusedChapterRow,
  buildEllisChapterEphemeralBlock,
  buildEllisSupplementBlock,
  buildEllisChapterHeading,
  buildEllisOriginalPlanBlock,
  resolveEllisChapterPovName,
  buildEllisPassProgressBlock,
  resolveNextEllisChapterRow,
  chapterHasEllisDraftContent,
  isEllisAffirmation,
  extractLastChapterRefFromAssistantContent,
  uniqueAssistantChapterNumbers,
  resolveEllisSupportingChapterRows,
  resolveChapterFromLabel,
  resolveEllisNamedChapterFromMessage,
  resolveEllisConversationChapter,
  resolveEllisTopicChapterFromMessages,
  resolveEllisInsertConfirmNextChapter,
  messageMatchesEllisChapterReview,
  resolveEllisReviewUnit,
  findChapterRowByNumericLabel,
} from "../service/ellisDynamicContext.js";
import {
  stripEllisFalseInsertClaims,
  stripEllisOpenEndedOffers,
  stripEllisLeakedModeFraming,
  rewriteEllisReviewOpenersToChapterTitle,
  stampEllisRepeatedSceneOpenerLetters,
  resolveEllisAssistantTurnKind,
} from "../service/ellisChapterReviewService.js";
import {
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_CONVERSATIONAL,
  ELLIS_METADATA_KIND_INSERT_CONFIRM,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
  ELLIS_METADATA_KIND_SCENE_WELCOME,
  ELLIS_SCENE_WELCOME_TEXT,
} from "../constants/ellisUiMessages.js";

test("parseEllisBareSectionLabel matches bare standalone section names", () => {
  assert.equal(parseEllisBareSectionLabel("Prologue"), "Prologue");
  assert.equal(parseEllisBareSectionLabel("the Epilogue"), "Epilogue");
  assert.equal(parseEllisBareSectionLabel("PROLOGUE."), "Prologue");
  assert.equal(parseEllisBareSectionLabel("Interlude"), "Interlude");
});

test("parseEllisBareSectionLabel ignores prose and numbered chapters", () => {
  assert.equal(parseEllisBareSectionLabel("Chapter 1"), null);
  assert.equal(
    parseEllisBareSectionLabel("The prologue feels rushed, can we tighten it?"),
    null
  );
  assert.equal(parseEllisBareSectionLabel("prologue and chapter one"), null);
});

test("default chapter ephemeral block is reference, not a review command", () => {
  const block = buildEllisChapterEphemeralBlock({
    chapterNumber: 10,
    chapterLabel: "Chapter Ten",
    pov: "Myla",
    userContent: "<p>POV: Myla</p><p>The spell caught.</p>",
  });
  assert.match(block.content, /CHAPTER BODY \(reference only/);
  assert.equal(block.content.includes(ELLIS_CHAPTER_REFERENCE_BANNER), true);
  assert.doesNotMatch(block.content, /CURRENT CHAPTER UNDER REVIEW/);
  assert.doesNotMatch(block.content, /MANDATORY REVIEW OPENER/);
  assert.match(block.content, /Chapter Ten – POV: Myla/);
});

test("parseEllisReviewSectionLabelFromHeader keeps a custom Epilogue title", () => {
  assert.equal(
    parseEllisReviewSectionLabelFromHeader(
      "Epilogue - September- 1936 - California – POV: Myla\n\nFunction in Story:\nCloses the book."
    ),
    "Epilogue - September- 1936 - California"
  );
});

test("parseEllisReviewSectionLabelFromHeader trusts the header over body mentions", () => {
  assert.equal(
    parseEllisReviewSectionLabelFromHeader(
      "Prologue – POV: Narrator\n\nFunction in Story:\nSets up Chapter One and Chapter Two."
    ),
    "Prologue"
  );
  assert.equal(
    parseEllisReviewSectionLabelFromHeader(
      "Chapter Four – POV: Darien\n\nThis mirrors the Prologue."
    ),
    null
  );
});

const sampleContents = [
  {
    _id: "aaa",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>Chapter one body.</p>",
    pov: "Alice",
  },
  {
    _id: "bbb",
    chapterNumber: 6,
    chapterLabel: "Chapter Six",
    userContent: "<p>Sixth chapter prose here.</p>",
    pov: "Bob",
  },
];

test("parseEllisChapterNumberFromMessage accepts start and review phrasing", () => {
  assert.equal(parseEllisChapterNumberFromMessage("Start Chapter 1"), 1);
  assert.equal(parseEllisChapterNumberFromMessage("Start Chapter One"), 1);
  assert.equal(
    parseEllisChapterNumberFromMessage("Let's start with chapter one"),
    1
  );
  assert.equal(parseEllisChapterNumberFromMessage("Review Chapter Six"), 6);
  assert.equal(parseEllisChapterNumberFromMessage("look at chapter 6"), 6);
  assert.equal(parseEllisChapterNumberFromMessage("review again the chapter 6"), 6);
  assert.equal(parseEllisChapterNumberFromMessage("Can you review again chapter 6"), 6);
  assert.equal(parseEllisChapterNumberFromMessage("How is the POV?"), null);
});

test("parseEllisChapterRefFromMessage parses letter suffixes", () => {
  assert.deepEqual(parseEllisChapterRefFromMessage("Start Chapter Seven A"), {
    chapterNumber: 7,
    chapterSuffix: "A",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("Start Chapter 7A"), {
    chapterNumber: 7,
    chapterSuffix: "A",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("Start Chapter Seven"), {
    chapterNumber: 7,
    chapterSuffix: "",
  });
});

test("parseEllisChapterRefFromMessage keeps decimal chapter identifiers", () => {
  assert.deepEqual(parseEllisChapterRefFromMessage("review chapter 1.5"), {
    chapterNumber: 1.5,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("Can you review chapter 1.5"), {
    chapterNumber: 1.5,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("review chapter 2.5"), {
    chapterNumber: 2.5,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("review chapter 2"), {
    chapterNumber: 2,
    chapterSuffix: "",
  });
  assert.notEqual(parseEllisChapterRefFromMessage("review chapter 1.5")?.chapterNumber, 1);
  assert.notEqual(parseEllisChapterRefFromMessage("review chapter 1.5")?.chapterNumber, 2);
});

test("parseEllisChapterRefFromMessage detects a bare decimal chapter number without the word 'chapter'", () => {
  assert.deepEqual(
    parseEllisChapterRefFromMessage("can you go read 6.5 and give me feedback"),
    { chapterNumber: 6.5, chapterSuffix: "" }
  );
  assert.deepEqual(
    parseEllisChapterRefFromMessage("can you go read chapter 6.5 and give me feedback"),
    { chapterNumber: 6.5, chapterSuffix: "" }
  );
  // A plain integer with no decimal and no "chapter" word is still too
  // ambiguous mid-sentence and stays unmatched here.
  assert.equal(
    parseEllisChapterRefFromMessage("can you go read 6 and give me feedback"),
    null
  );
});

test("parseEllisChapterRefFromMessage finds spelled-out Chapter nine even when 'changes' appears earlier", () => {
  // Regression: the `ch` shorthand used to match the start of "changes" and
  // then fail to parse, so "Chapter nine" was never seen. Digit form "Chapter 9"
  // already worked because the digit path skips non-numeric leftovers.
  assert.deepEqual(
    parseEllisChapterRefFromMessage(
      "Ok I made some changes on Chapter nine can you look?"
    ),
    { chapterNumber: 9, chapterSuffix: "" }
  );
  assert.deepEqual(
    parseEllisChapterRefFromMessage(
      "Ok I made some changes on Chapter 9 can you look?"
    ),
    { chapterNumber: 9, chapterSuffix: "" }
  );
  assert.deepEqual(
    parseEllisChapterRefFromMessage("I made some changes, check chapter twenty"),
    { chapterNumber: 20, chapterSuffix: "" }
  );
});

test("resolveFocusedChapterRow prefers parsed chapter number over chapterId", () => {
  const row = resolveFocusedChapterRow({
    userContents: sampleContents,
    chapterId: "aaa",
    chapterNumber: 6,
  });
  assert.equal(String(row._id), "bbb");
  assert.equal(row.chapterNumber, 6);
});

test("resolveFocusedChapterRow resolves lettered refs to the base chapter row", () => {
  const contents = [
    {
      _id: "seven",
      chapterNumber: 7,
      chapterSuffix: null,
      chapterLabel: "Chapter Seven",
      userContent: "<p>Seven</p>",
    },
    {
      _id: "sevenA",
      chapterNumber: 7,
      chapterSuffix: "A",
      chapterLabel: "Chapter Seven A",
      userContent: "<p>Seven A</p>",
    },
  ];
  const bare = resolveFocusedChapterRow({
    userContents: contents,
    chapterNumber: 7,
  });
  assert.equal(String(bare._id), "seven");
  const lettered = resolveFocusedChapterRow({
    userContents: contents,
    chapterNumber: 7,
    chapterSuffix: "A",
  });
  assert.equal(String(lettered._id), "seven");
});

test("resolveFocusedChapterRow resolves by chapterId when no number", () => {
  const row = resolveFocusedChapterRow({
    userContents: sampleContents,
    chapterId: "aaa",
  });
  assert.equal(String(row._id), "aaa");
});

test("resolveFocusedChapterRow does not return an archived chapter", () => {
  const contents = [
    {
      _id: "one",
      chapterNumber: 1,
      chapterLabel: "Chapter One",
      userContent: "<p>One</p>",
    },
    {
      _id: "parked",
      chapterNumber: 2,
      chapterLabel: "Chapter Two",
      userContent: "<p>SECRET ARCHIVED</p>",
      archivedAt: new Date("2026-09-09"),
    },
    {
      _id: "live-two",
      chapterNumber: 2,
      chapterLabel: "Chapter Two live",
      userContent: "<p>Live two</p>",
    },
  ];
  assert.equal(
    resolveFocusedChapterRow({ userContents: contents, chapterId: "parked" }),
    null
  );
  assert.equal(
    resolveFocusedChapterRow({ userContents: contents, chapterNumber: 2 })?._id,
    "live-two"
  );
});

test("resolveEllisReviewUnit does not remap an archived chapterId onto a live neighbor", () => {
  const contents = [
    {
      _id: "live",
      chapterNumber: 2,
      chapterLabel: "Chapter Two",
      userContent: "<p>Live</p>",
    },
    {
      _id: "parked",
      chapterNumber: 2,
      chapterLabel: "Old Two",
      userContent: "<p>SECRET</p>",
      archivedAt: new Date("2026-09-09"),
    },
  ];
  assert.equal(
    resolveEllisReviewUnit({ userContents: contents, chapterId: "parked" }),
    null
  );
});

test("resolveChapterFromLabel skips archived chapters", () => {
  const contents = [
    {
      _id: "live",
      chapterNumber: 1,
      chapterLabel: "Birthday Glass",
      userContent: "<p>Live</p>",
    },
    {
      _id: "parked",
      chapterNumber: 2,
      chapterLabel: "The Betrayal",
      userContent: "<p>SECRET</p>",
      archivedAt: new Date("2026-09-09"),
    },
  ];
  assert.equal(
    resolveChapterFromLabel("what happens in The Betrayal", contents),
    null
  );
});

test("extractLastChapterRefFromAssistantContent parses word-form Chapter Ten POV reply", () => {
  const ref = extractLastChapterRefFromAssistantContent(
    "Chapter Ten is in Myla's POV."
  );
  assert.deepEqual(ref, { chapterNumber: 10, chapterSuffix: "" });
});

test("extractLastChapterRefFromAssistantContent parses word-form Chapter Nine", () => {
  const ref = extractLastChapterRefFromAssistantContent(
    "The next chapter for review is Chapter Nine."
  );
  assert.deepEqual(ref, { chapterNumber: 9, chapterSuffix: "" });
});

test("extractLastChapterRefFromAssistantContent takes the LAST chapter mention", () => {
  const ref = extractLastChapterRefFromAssistantContent(
    "Chapter Two is focused, but the next chapter for review is Chapter Nine."
  );
  assert.equal(ref.chapterNumber, 9);
});

test("extractLastChapterRefFromAssistantContent parses digit form", () => {
  const ref = extractLastChapterRefFromAssistantContent(
    "The next chapter for review is Chapter 9."
  );
  assert.equal(ref.chapterNumber, 9);
});

test("extractLastChapterRefFromAssistantContent returns null when no chapter mentioned", () => {
  assert.equal(
    extractLastChapterRefFromAssistantContent("That sounds like a pacing issue."),
    null
  );
});

test("extractLastChapterRefFromAssistantContent: scene welcome last mention is Chapter One", () => {
  const ref = extractLastChapterRefFromAssistantContent(ELLIS_SCENE_WELCOME_TEXT);
  assert.equal(ref.chapterNumber, 1);
});

test("resolveChapterFromLabel matches renamed chapter titles in chat text", () => {
  const contents = [
    {
      _id: "c1",
      chapterNumber: 1,
      chapterLabel: "Chapter One",
      sceneTitle: "Chapter One",
    },
    {
      _id: "c15",
      chapterNumber: 15,
      chapterLabel: "Chapter 15 B — 1932",
      sceneTitle: "Chapter 15 B — 1932",
    },
  ];
  const row = resolveChapterFromLabel(
    "what happens in Chapter 15 B — 1932?",
    contents
  );
  assert.equal(String(row._id), "c15");
  assert.equal(
    resolveChapterFromLabel("Start The Betrayal", contents),
    null
  );
});

test("resolveChapterFromLabel matches lettered word-form titles like Chapter Fifteen B", () => {
  const contents = [
    {
      _id: "c15b",
      chapterNumber: 15,
      chapterSuffix: "B",
      chapterLabel: "Chapter Fifteen B",
      sceneTitle: "Chapter Fifteen B",
    },
  ];
  const row = resolveChapterFromLabel(
    "what is Chapter Fifteen B called?",
    contents
  );
  assert.equal(String(row._id), "c15b");
});

test("resolveChapterFromLabel prefers longest matching custom title", () => {
  const contents = [
    {
      _id: "a",
      chapterNumber: 2,
      chapterLabel: "Birthday",
      sceneTitle: "Birthday",
    },
    {
      _id: "b",
      chapterNumber: 3,
      chapterLabel: "Birthday Glass",
      sceneTitle: "Birthday Glass",
    },
  ];
  const row = resolveChapterFromLabel(
    "can we discuss Birthday Glass next?",
    contents
  );
  assert.equal(String(row._id), "b");
});

test("resolveChapterFromLabel matches custom titles including Chapter A", () => {
  const contents = [
    {
      _id: "ch2",
      chapterNumber: 2,
      chapterLabel: "Chapter Two",
      userContent: "<p>Two</p>",
    },
    {
      _id: "chA",
      chapterNumber: 4,
      chapterLabel: "Chapter A",
      sceneTitle: "Chapter A",
      userContent: "<p>A</p>",
    },
    {
      _id: "chLife",
      chapterNumber: 11,
      chapterLabel: "Chapter Bring Back to Life",
      sceneTitle: "Bring Back to Life",
      userContent: "<p>Life</p>",
    },
  ];
  assert.equal(
    String(
      resolveChapterFromLabel(
        "Ok I made some changes on Chapter Bring Back to Life can you look?",
        contents
      )._id
    ),
    "chLife"
  );
  assert.equal(
    String(
      resolveChapterFromLabel(
        "can you look at Bring Back to Life?",
        contents
      )._id
    ),
    "chLife"
  );
  assert.equal(
    String(
      resolveChapterFromLabel(
        "Ok I made some changes on Chapter A can you look?",
        contents
      )._id
    ),
    "chA"
  );
  assert.equal(
    resolveChapterFromLabel("can you look at A?", contents),
    null
  );
});

test("resolveEllisNamedChapterFromMessage prefers a numeric ref over a custom title", () => {
  const contents = [
    {
      _id: "ch9",
      chapterNumber: 9,
      chapterLabel: "Chapter Nine",
      userContent: "<p>Nine</p>",
    },
    {
      _id: "chLife",
      chapterNumber: 11,
      chapterLabel: "Bring Back to Life",
      userContent: "<p>Life</p>",
    },
  ];
  const named = resolveEllisNamedChapterFromMessage(
    "I made some changes on Chapter nine and also mention Bring Back to Life",
    contents
  );
  assert.equal(named.namedBy, "number");
  assert.equal(named.chapterNumber, 9);
  assert.equal(String(named.row._id), "ch9");
});

test("resolveEllisNamedChapterFromMessage finds a custom-titled chapter by number", () => {
  const contents = [
    {
      _id: "emon",
      chapterNumber: 10,
      chapterLabel: "Emon Work",
      userContent: "<p>Emon body</p>",
    },
    {
      _id: "six",
      chapterNumber: 6,
      chapterLabel: "Chapter Six",
      userContent: "<p>Six</p>",
    },
  ];
  const named = resolveEllisNamedChapterFromMessage(
    "review chapter 10",
    contents
  );
  assert.equal(named.namedBy, "number");
  assert.equal(named.chapterNumber, 10);
  assert.equal(String(named.row._id), "emon");
});

test("buildEllisChapterEphemeralBlock includes heading and body", () => {
  const block = buildEllisChapterEphemeralBlock(sampleContents[1]);
  assert.equal(block.role, "user");
  assert.match(block.content, /CHAPTER BODY \(reference only/);
  assert.doesNotMatch(block.content, /CURRENT CHAPTER UNDER REVIEW/);
  assert.doesNotMatch(block.content, /MANDATORY REVIEW OPENER/);
  assert.match(block.content, /Chapter Six/);
  assert.match(block.content, /Sixth chapter prose here/);
});

test("buildEllisChapterEphemeralBlock keeps stored decimal title and POV as a fact", () => {
  const block = buildEllisChapterEphemeralBlock({
    chapterNumber: 2,
    chapterLabel: "1.5",
    sceneTitle: "1.5",
    pov: "Myla",
    userContent: "<p>Chapter One A – POV: Myla</p><p>The aftermath.</p>",
  });
  assert.doesNotMatch(block.content, /MANDATORY REVIEW OPENER/);
  assert.match(block.content, /1\.5 – POV: Myla/);
});

test("buildEllisChapterEphemeralBlock includes POV on Chapter One heading", () => {
  const block = buildEllisChapterEphemeralBlock({
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    pov: "Myla",
    userContent:
      "<p>Chapter One – POV: Myla</p><p>She walked into the bar.</p>",
  });
  assert.doesNotMatch(block.content, /MANDATORY REVIEW OPENER/);
  assert.match(block.content, /Chapter One – POV: Myla/);
});

test("buildEllisChapterEphemeralBlock includes scene inventory for multi-scene chapters", () => {
  const block = buildEllisChapterEphemeralBlock({
    chapterNumber: 7,
    chapterLabel: "Chapter Seven",
    userContent:
      "<p>POV: David John</p><p>David John stood in front of the mirror in his private bathroom at Love Story, fixing his tie for the third time.</p><p>Chapter Seven A</p><p>Darien stepped through the revolving door.</p><p>Chapter Seven B</p><p>Benjamin leaned back in his leather chair.</p>",
  });
  assert.match(block.content, /CHAPTER SCENE INVENTORY/);
  assert.match(block.content, /3 distinct scenes/);
  assert.match(block.content, /Chapter Seven A, Chapter Seven B, Chapter Seven C/);
  assert.match(block.content, /MULTI-SCENE CHAPTER/);
});

test("buildEllisChapterEphemeralBlock supports a custom banner for cross-chapter references", () => {
  const block = buildEllisChapterEphemeralBlock(sampleContents[1], {
    banner:
      "═══ ANOTHER CHAPTER REFERENCED IN THIS MESSAGE (the writer is asking about this chapter — answer about it directly, do not redirect back to the focused chapter) ═══",
  });
  assert.equal(block.role, "user");
  assert.match(block.content, /ANOTHER CHAPTER REFERENCED IN THIS MESSAGE/);
  assert.doesNotMatch(block.content, /CURRENT CHAPTER UNDER REVIEW/);
  assert.match(block.content, /Chapter Six/);
  assert.match(block.content, /Sixth chapter prose here/);
});

test("buildEllisChapterHeading includes POV metadata", () => {
  const heading = buildEllisChapterHeading(sampleContents[0]);
  assert.match(heading, /Chapter One/);
  assert.match(heading, /POV: Alice/);
  assert.equal(
    buildEllisChapterHeading({
      chapterLabel: "1.5",
      sceneTitle: "1.5",
      pov: "Darien",
    }),
    "1.5 – POV: Darien"
  );
  assert.equal(
    buildEllisChapterHeading({
      chapterLabel: "Chapter One",
      userContent: "<p>POV: Myla</p><p>She walked into the bar.</p>",
    }),
    "Chapter One – POV: Myla"
  );
  assert.equal(
    buildEllisChapterHeading({
      chapterLabel: "Chapter One",
      userContent:
        "<p>Chapter One – POV: Myla</p><p>She walked into the bar.</p>",
    }),
    "Chapter One – POV: Myla"
  );
});

test("resolveEllisChapterPovName prefers stored pov then a POV line in the chapter", () => {
  assert.equal(resolveEllisChapterPovName(sampleContents[0]), "Alice");
  assert.equal(
    resolveEllisChapterPovName({
      chapterLabel: "Chapter One",
      userContent: "<p>POV: Myla</p><p>She walked into the bar.</p>",
    }),
    "Myla"
  );
  assert.equal(
    resolveEllisChapterPovName({
      chapterLabel: "Chapter One",
      userContent:
        "<p>Chapter One – POV: Myla</p><p>She walked into the bar.</p>",
    }),
    "Myla"
  );
});

test("buildEllisSupplementBlock includes letter and map when present", () => {
  const block = buildEllisSupplementBlock({
    novel: {
      editorialLetter: "Big picture note.",
      editorialLetterStatus: "ready",
    },
    userContents: sampleContents,
    focusedChapter: sampleContents[1],
    priorSavedNotesContext:
      "CUMULATIVE NOTES FROM EARLIER CHAPTERS:\n- Ch 1: note",
    priorThreadReviewBlock: "",
  });
  assert.equal(block.role, "system");
  assert.match(block.content, /GLOBAL EDITORIAL LETTER/);
  assert.match(block.content, /MANUSCRIPT MAP/);
  assert.match(block.content, /load_manuscript_chapters/);
  assert.match(block.content, /chapterId:bbb/);
  assert.match(block.content, /CUMULATIVE NOTES/);
});

test("buildEllisSupplementBlock returns null when no supplements", () => {
  const block = buildEllisSupplementBlock({
    novel: {},
    userContents: [],
    focusedChapter: null,
    priorSavedNotesContext: "",
    priorThreadReviewBlock: "",
  });
  assert.equal(block, null);
});

test("parseEllisChapterRefFromMessage accepts fuzzy misspellings", () => {
  assert.deepEqual(parseEllisChapterRefFromMessage("Hapter 8"), {
    chapterNumber: 8,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("chpater 12"), {
    chapterNumber: 12,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("ch 9"), {
    chapterNumber: 9,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("ch9"), {
    chapterNumber: 9,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisChapterRefFromMessage("ch. 9"), {
    chapterNumber: 9,
    chapterSuffix: "",
  });
});

test("parseEllisBareChapterRef accepts whole-message chapter shorthand", () => {
  assert.deepEqual(parseEllisBareChapterRef("Eleven"), {
    chapterNumber: 11,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisBareChapterRef("11"), {
    chapterNumber: 11,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisBareChapterRef("seven"), {
    chapterNumber: 7,
    chapterSuffix: "",
  });
  assert.equal(parseEllisBareChapterRef("yes"), null);
  assert.equal(parseEllisBareChapterRef("next chapter"), null);
  assert.equal(parseEllisBareChapterRef("What about eleven?"), null);
  assert.equal(parseEllisBareChapterRef("Start Chapter 11"), null);
});

test("parseEllisBareChapterRef accepts a whole-message 'Chapter N' selector", () => {
  assert.deepEqual(parseEllisBareChapterRef("Chapter 1"), {
    chapterNumber: 1,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisBareChapterRef("Chapter One"), {
    chapterNumber: 1,
    chapterSuffix: "",
  });
  assert.deepEqual(parseEllisBareChapterRef("chapter 15 B"), {
    chapterNumber: 15,
    chapterSuffix: "B",
  });
  assert.deepEqual(parseEllisBareChapterRef("Chapter Fifteen B"), {
    chapterNumber: 15,
    chapterSuffix: "B",
  });
  // A longer message that only starts with "Chapter" is not a bare selector.
  assert.equal(parseEllisBareChapterRef("Chapter 3 feels slow"), null);
  assert.equal(parseEllisBareChapterRef("Chapter one, what do you think?"), null);
});

test("parseEllisChapterRefFromMessage falls back to bare chapter shorthand", () => {
  assert.deepEqual(parseEllisChapterRefFromMessage("Eleven"), {
    chapterNumber: 11,
    chapterSuffix: "",
  });
});

test("buildEllisPassProgressBlock uses revision plan gap when readyChapterNumbers provided", () => {
  const contents = [
    { chapterNumber: 1, chapterLabel: "Chapter One" },
    { chapterNumber: 2, chapterLabel: "Chapter Two" },
    { chapterNumber: 3, chapterLabel: "Chapter Three" },
    { chapterNumber: 4, chapterLabel: "Chapter Four" },
  ];
  const block = buildEllisPassProgressBlock({
    userContents: contents,
    reviewedChapters: [{ chapterNumber: 1, chapterSuffix: "" }],
    readyChapterNumbers: new Set([1, 3, 4]),
    focusedChapter: contents[3],
  });
  assert.match(
    block,
    /Next open chapter \(authoritative — first chapter still needing a developmental pass\): Chapter Two/
  );
});

test("buildEllisPassProgressBlock keeps next-open as a fact on conversational turns without pitching it", () => {
  const contents = [
    { chapterNumber: 1, chapterLabel: "Chapter One" },
    { chapterNumber: 5, chapterLabel: "Chapter Five" },
    { chapterNumber: 6, chapterLabel: "Chapter Six" },
  ];
  const block = buildEllisPassProgressBlock({
    userContents: contents,
    reviewedChapters: [{ chapterNumber: 4, chapterSuffix: "" }],
    readyChapterNumbers: new Set([1, 2, 3, 4]),
    focusedChapter: contents[1],
    conversationChapter: contents[1],
    forConversationalTurn: true,
  });
  assert.match(
    block,
    /Next open chapter \(authoritative — first chapter still needing a developmental pass\): Chapter Five/
  );
  assert.match(block, /answer with Chapter Five in one sentence/);
  assert.match(block, /Do not answer from a following-chapter reference body/);
  assert.match(block, /Do not volunteer or propose the next open chapter/);
  assert.doesNotMatch(block, /NEXT CHAPTER IN THE MANUSCRIPT MAP/);
});

test("following-chapter banner is reference only, not next-open", () => {
  assert.match(ELLIS_NEXT_MAP_CHAPTER_BANNER, /FOLLOWING CHAPTER IN MANUSCRIPT ORDER/);
  assert.match(ELLIS_NEXT_MAP_CHAPTER_BANNER, /this is NOT the next open chapter/);
  assert.doesNotMatch(
    ELLIS_NEXT_MAP_CHAPTER_BANNER,
    /NEXT CHAPTER IN THE MANUSCRIPT MAP/
  );
});

test("resolveEllisRevisionCandidateRows loads Chapter One when it already has notes", () => {
  const one = {
    _id: "c1",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>Revised opening.</p>",
  };
  const five = {
    _id: "c5",
    chapterNumber: 5,
    chapterLabel: "Chapter Five",
    userContent: "<p>Five.</p>",
  };
  const six = {
    _id: "c6",
    chapterNumber: 6,
    chapterLabel: "Chapter Six",
    userContent: "<p>Six changed.</p>",
    updatedAt: new Date("2026-09-09"),
  };
  const rows = resolveEllisRevisionCandidateRows({
    userContents: [one, five, six],
    readyReviews: [
      { chapterId: "c1", chapterNumber: 1, draftContentHash: "old" },
      { chapterId: "c6", chapterNumber: 6, draftContentHash: "also-old" },
    ],
    focusedChapter: five,
  });
  assert.equal(rows.length, 2);
  assert.equal(String(rows[0]._id), "c1");
  assert.equal(String(rows[1]._id), "c6");
  assert.match(ELLIS_REVISED_CHAPTER_BANNER, /CHAPTER THAT ALREADY HAS NOTES/);
});

test("buildEllisPassProgressBlock shows revision plan complete when all ready", () => {
  const contents = [
    { chapterNumber: 1, chapterLabel: "Chapter One" },
    { chapterNumber: 2, chapterLabel: "Chapter Two" },
  ];
  const block = buildEllisPassProgressBlock({
    userContents: contents,
    reviewedChapters: [{ chapterNumber: 1, chapterSuffix: "" }],
    readyChapterNumbers: new Set([1, 2]),
    focusedChapter: contents[1],
  });
  assert.match(block, /All manuscript chapters are in your Revision Plan/);
});

test("resolveNextEllisChapterRow returns the following chapter", () => {
  const next = resolveNextEllisChapterRow(sampleContents, 1);
  assert.equal(next.chapterNumber, 6);
  assert.equal(resolveNextEllisChapterRow(sampleContents, 6), null);
});

test("resolveNextEllisChapterRow skips lettered rows and advances by base number", () => {
  const contents = [
    { _id: "seven", chapterNumber: 7, chapterSuffix: null, chapterLabel: "Chapter Seven" },
    { _id: "sevenA", chapterNumber: 7, chapterSuffix: "A", chapterLabel: "Chapter Seven A" },
    { _id: "eight", chapterNumber: 8, chapterSuffix: null, chapterLabel: "Chapter Eight" },
  ];
  const next = resolveNextEllisChapterRow(contents, 7);
  assert.equal(next.chapterNumber, 8);
});

test("buildEllisPassProgressBlock forbids completion before final chapter", () => {
  const block = buildEllisPassProgressBlock({
    userContents: sampleContents,
    reviewedChapters: [{ chapterNumber: 1, chapterSuffix: "" }],
    focusedChapter: sampleContents[0],
  });
  assert.match(block, /DEVELOPMENTAL PASS PROGRESS/);
  assert.match(block, /Manuscript chapters total: 2/);
  assert.match(block, /NOT the final chapter/);
  assert.match(block, /Chapter One/);
});

test("buildEllisPassProgressBlock allows completion language on final chapter", () => {
  const block = buildEllisPassProgressBlock({
    userContents: sampleContents,
    reviewedChapters: [
      { chapterNumber: 1, chapterSuffix: "" },
      { chapterNumber: 6, chapterSuffix: "" },
    ],
    focusedChapter: sampleContents[1],
  });
  assert.match(block, /final chapter/);
  assert.doesNotMatch(block, /NOT the final chapter/);
});

test("buildEllisPassProgressBlock forbids repeating wrap-up after first pass already completed", () => {
  const block = buildEllisPassProgressBlock({
    userContents: sampleContents,
    reviewedChapters: [
      { chapterNumber: 1, chapterSuffix: "" },
      { chapterNumber: 6, chapterSuffix: "" },
    ],
    focusedChapter: sampleContents[1],
    firstPassAlreadyComplete: true,
  });
  assert.match(block, /wrap-up already happened/);
  assert.doesNotMatch(block, /You may use the completion line/);
});

test("buildEllisSupplementBlock includes pass progress when provided", () => {
  const block = buildEllisSupplementBlock({
    novel: {},
    userContents: sampleContents,
    focusedChapter: sampleContents[0],
    passProgressBlock: buildEllisPassProgressBlock({
      userContents: sampleContents,
      reviewedChapters: [],
      focusedChapter: sampleContents[0],
    }),
  });
  assert.match(block.content, /DEVELOPMENTAL PASS PROGRESS/);
});

test("buildEllisSupplementBlock includes original chapter edits for revision-history", () => {
  const block = buildEllisSupplementBlock({
    novel: {},
    userContents: sampleContents,
    focusedChapter: sampleContents[0],
    originalPlanBlock:
      "ORIGINAL CHAPTER EDITS / REVISION PLAN FOR Chapter One (evaluate whether the writer's current manuscript revisions hit these notes):\n\nTighten the POV.",
  });
  assert.match(block.content, /ORIGINAL CHAPTER EDITS \/ REVISION PLAN/);
  assert.match(block.content, /Tighten the POV/);
});

test("buildEllisOriginalPlanBlock names the chapter and asks for revision review", () => {
  const block = buildEllisOriginalPlanBlock({
    chapterLabel: "Chapter Two",
    reviewMarkdown: "Function in Story\nGrief after the funeral.",
  });
  assert.match(block, /ORIGINAL CHAPTER EDITS \/ REVISION PLAN FOR Chapter Two/);
  assert.match(block, /Never announce/);
  assert.match(block, /Grief after the funeral/);
  assert.equal(buildEllisOriginalPlanBlock({ chapterLabel: "Chapter Two" }), "");
});

test("resolveEllisAssistantTurnKind tags already-reviewed chapters as revision review", () => {
  const feedback = "Lucille's emotional clarity is stronger now. ".repeat(20);
  assert.equal(
    resolveEllisAssistantTurnKind({ text: feedback, hasOriginalPlan: true }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
  const withClose =
    `${feedback}\n\n📌 To save anything you want to revisit, highlight the feedback and add it to Chapter Notes.`;
  assert.equal(
    resolveEllisAssistantTurnKind({ text: withClose, hasOriginalPlan: true }),
    ELLIS_METADATA_KIND_REVISION_REVIEW
  );
  assert.equal(
    resolveEllisAssistantTurnKind({
      text: "Short thanks.",
      hasOriginalPlan: true,
    }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
  assert.equal(
    resolveEllisAssistantTurnKind({ text: feedback, hasOriginalPlan: false }),
    ELLIS_METADATA_KIND_CONVERSATIONAL
  );
});

test("chapterHasEllisDraftContent treats empty HTML as no draft", () => {
  assert.equal(chapterHasEllisDraftContent(""), false);
  assert.equal(chapterHasEllisDraftContent("<p><br></p>"), false);
  assert.equal(chapterHasEllisDraftContent("<p>Hello.</p>"), true);
});

test("messageMatchesEllisChapterReview accepts metadata or review header", () => {
  assert.equal(
    messageMatchesEllisChapterReview(
      {
        content: "Chapter Twenty – POV: Janet\n\nFunction in Story",
        metadata: { chapterNumber: 20 },
      },
      20
    ),
    true
  );
  assert.equal(
    messageMatchesEllisChapterReview(
      {
        content: "Chapter Twenty – POV: Janet\n\nFunction in Story",
        metadata: {},
      },
      20
    ),
    true
  );
  assert.equal(
    messageMatchesEllisChapterReview(
      { content: "Chapter Eight – POV: David", metadata: { chapterNumber: 8 } },
      20
    ),
    false
  );
});

test("messageMatchesEllisChapterReview matches stable chapterId after a number shift", () => {
  assert.equal(
    messageMatchesEllisChapterReview(
      {
        content: "Chapter Six – POV: Maya\n\nFunction in Story",
        metadata: { chapterNumber: 6, chapterId: "ch6orig" },
      },
      8,
      "ch6orig"
    ),
    true
  );
});

test("isEllisAffirmation detects short affirmatives", () => {
  assert.equal(isEllisAffirmation("okay"), true);
  assert.equal(isEllisAffirmation("go ahead"), true);
  assert.equal(isEllisAffirmation("please revise chapter 8"), false);
});

test("resolveEllisTopicChapterFromMessages picks insert-confirm next chapter over last review", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    { role: "user", content: "yes" },
    {
      role: "assistant",
      content:
        "✅ **Chapter Ten** was inserted into your Revision Plan.\n\nYour next open chapter is **Chapter Two**. Say when you'd like me to run the next developmental edit pass.",
      metadata: {
        kind: ELLIS_METADATA_KIND_INSERT_CONFIRM,
        chapterNumber: 10,
        chapterId: "ten",
        nextChapterNumber: 2,
        nextChapterId: "two",
      },
    },
    {
      role: "assistant",
      content: "Full review",
      metadata: {
        kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
        chapterNumber: 10,
        chapterId: "ten",
      },
    },
  ]);
  assert.equal(topic.chapterNumber, 2);
  assert.equal(topic.chapterId, "two");
});

test("insert-confirm yes loads map chapter 1.5, not Chapter One or Two", () => {
  const one = {
    _id: "one",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>One</p>",
  };
  const added = {
    _id: "ch15",
    chapterNumber: 2,
    chapterLabel: "1.5",
    sceneTitle: "1.5",
    userContent: "<p>Aftermath bridge</p>",
  };
  const two = {
    _id: "two",
    chapterNumber: 3,
    chapterLabel: "Chapter Two",
    userContent: "<p>Two</p>",
  };
  const eight = {
    _id: "eight",
    chapterNumber: 9,
    chapterLabel: "Chapter Eight",
    userContent: "<p>Eight</p>",
  };
  const confirm = {
    role: "assistant",
    content:
      "✅ **Chapter Eight** was inserted into your Revision Plan.\n\nYour next open chapter is **1.5**. Tell me when you're ready to continue your developmental pass.",
    metadata: {
      kind: ELLIS_METADATA_KIND_INSERT_CONFIRM,
      chapterNumber: 9,
      chapterId: "eight",
      // Positional trap: 1.5 sits at chapterNumber 2 after insert.
      nextChapterNumber: 2,
      nextChapterId: "ch15",
      nextChapterLabel: "1.5",
    },
  };

  const fromHelper = resolveEllisInsertConfirmNextChapter(confirm);
  assert.equal(fromHelper.chapterNumber, 1.5);
  assert.equal(fromHelper.chapterId, "ch15");
  assert.equal(fromHelper.chapterLabel, "1.5");

  const topic = resolveEllisTopicChapterFromMessages([
    { role: "user", content: "yes" },
    confirm,
  ]);
  assert.equal(topic.chapterNumber, 1.5);
  assert.equal(topic.chapterId, "ch15");
  assert.equal(topic.chapterLabel, "1.5");

  const row = resolveEllisConversationChapter({
    userContents: [one, added, two, eight],
    message: "yes",
    topicFromThread: topic,
  });
  assert.equal(String(row._id), "ch15");

  const withoutId = resolveEllisConversationChapter({
    userContents: [one, added, two, eight],
    message: "yes",
    topicFromThread: {
      chapterNumber: 1.5,
      chapterId: null,
      chapterLabel: "1.5",
    },
  });
  assert.equal(String(withoutId._id), "ch15");
});

test("resolveEllisConversationChapter uses the thread, never the sidebar", () => {
  const ten = {
    _id: "ten",
    chapterNumber: 10,
    chapterLabel: "Chapter Ten",
    userContent: "<p>Ten</p>",
  };
  const two = {
    _id: "two",
    chapterNumber: 2,
    chapterLabel: "Chapter Two",
    userContent: "<p>Two</p>",
  };
  const contents = [two, ten];
  const fromYes = resolveEllisConversationChapter({
    userContents: contents,
    topicFromThread: {
      chapterNumber: 2,
      chapterSuffix: "",
      chapterId: "two",
    },
  });
  assert.equal(String(fromYes._id), "two");

  const namedDoesNotRegexParse = resolveEllisConversationChapter({
    userContents: contents,
    topicFromThread: { chapterNumber: 10, chapterId: "ten" },
  });
  assert.equal(String(namedDoesNotRegexParse._id), "ten");

  const noSidebarFallback = resolveEllisConversationChapter({
    userContents: contents,
    topicFromThread: null,
  });
  assert.equal(noSidebarFallback, null);
});

test("ok after welcome loads Chapter One from the thread, not a re-ask", () => {
  const one = {
    _id: "one",
    chapterNumber: 1,
    chapterLabel: "Chapter One",
    userContent: "<p>Myla opens the door.</p>",
  };
  const two = {
    _id: "two",
    chapterNumber: 2,
    chapterLabel: "Chapter Two",
    userContent: "<p>Two</p>",
  };
  const welcomeTopic = resolveEllisTopicChapterFromMessages([
    { role: "user", content: "ok" },
    {
      role: "assistant",
      content: ELLIS_SCENE_WELCOME_TEXT,
      metadata: { kind: ELLIS_METADATA_KIND_SCENE_WELCOME },
    },
  ]);
  assert.equal(welcomeTopic.chapterNumber, 1);

  const fromOk = resolveEllisConversationChapter({
    userContents: [one, two],
    message: "ok",
    topicFromThread: welcomeTopic,
  });
  assert.equal(String(fromOk._id), "one");

  const inviteTopic = resolveEllisTopicChapterFromMessages([
    { role: "user", content: "yes" },
    {
      role: "assistant",
      content:
        "Chapter One is the right place to begin — say the word and I'll deliver the review.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL },
    },
    { role: "user", content: "ok" },
    {
      role: "assistant",
      content: ELLIS_SCENE_WELCOME_TEXT,
      metadata: { kind: ELLIS_METADATA_KIND_SCENE_WELCOME },
    },
  ]);
  assert.equal(inviteTopic.chapterNumber, 1);
});

test("supporting chapter rows include the next map chapter, not a move-on regex", () => {
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
  const rows = resolveEllisSupportingChapterRows({
    focusedChapter: one,
    userContents: [one, two],
  });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0]._id), "two");
});

test("resolveEllisTopicChapterFromMessages uses stamped user metadata, not message regex", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    {
      role: "user",
      content: "what about the jail frame in chapter 20?",
      metadata: { chapterNumber: 20, chapterId: "c20" },
    },
    {
      role: "assistant",
      content: "Full review",
      metadata: {
        kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
        chapterNumber: 9,
      },
    },
  ]);
  assert.equal(topic.chapterNumber, 20);
  assert.equal(topic.chapterId, "c20");

  const ignoredBareText = resolveEllisTopicChapterFromMessages([
    { role: "user", content: "Start Chapter Eight" },
    {
      role: "assistant",
      content: "Full review",
      metadata: {
        kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
        chapterNumber: 9,
        chapterId: "nine",
      },
    },
  ]);
  assert.equal(ignoredBareText.chapterNumber, 9);
  assert.equal(ignoredBareText.chapterId, "nine");
});

test("resolveEllisTopicChapterFromMessages does not let stale Chapter Six win after Chapter Eight Q&A", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    {
      role: "assistant",
      content:
        "We were talking about Chapter Eight — specifically whether its length felt too long.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL },
    },
    {
      role: "user",
      content: "which chapter were we talking about",
      metadata: { chapterNumber: 6, chapterId: "c6" },
    },
    {
      role: "assistant",
      content:
        "✅ **Chapter Five** was inserted into your Revision Plan.\n\nYour next open chapter is **Chapter Six**. Say when you'd like me to run the next developmental edit pass.",
      metadata: {
        kind: ELLIS_METADATA_KIND_INSERT_CONFIRM,
        chapterNumber: 5,
        nextChapterNumber: 6,
        nextChapterId: "c6",
        nextChapterLabel: "Chapter Six",
      },
    },
    {
      role: "assistant",
      content: "Full review",
      metadata: {
        kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
        chapterNumber: 6,
        chapterId: "c6",
      },
    },
  ]);
  assert.equal(topic.chapterNumber, 8);
});

test("resolveEllisTopicChapterFromMessages uses Ellis's last named Q&A chapter, not next-open", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    {
      role: "user",
      content: "Ok great. Now let's do the edit",
      metadata: { chapterNumber: 4, chapterId: "c4" },
    },
    {
      role: "assistant",
      content:
        "Yes — Myla is the right POV for Chapter Seven. The pressure point is making sure Chapter Seven remains Myla's transformation experience.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL },
    },
    {
      role: "user",
      content: "is the POV works for it?",
      metadata: { chapterNumber: 4, chapterId: "c4" },
    },
    {
      role: "assistant",
      content: "Of course — what do you want to know about Chapter Seven?",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL },
    },
    {
      role: "assistant",
      content:
        "✅ **Chapter Three** was inserted into your Revision Plan.\n\nYour next open chapter is **Chapter Four**. Say when you'd like me to run the next developmental edit pass.",
      metadata: {
        kind: ELLIS_METADATA_KIND_INSERT_CONFIRM,
        chapterNumber: 3,
        nextChapterNumber: 4,
        nextChapterId: "c4",
        nextChapterLabel: "Chapter Four",
      },
    },
  ]);
  assert.equal(topic.chapterNumber, 7);
});

test("resolveEllisTopicChapterFromMessages ignores map-inventory replies after next-open", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    {
      role: "user",
      content: "ok let's review chapter 7",
    },
    {
      role: "assistant",
      content:
        "No — the manuscript map goes through Chapter Ten, and there's no Chapter Eleven or epilogue listed.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL, chapterNumber: 11 },
    },
    {
      role: "user",
      content: "is there a chapter 11 or an epiloge?",
    },
    {
      role: "assistant",
      content:
        "The first three chapter titles in the manuscript map are Chapter One, Chapter Two, and Chapter Three.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL, chapterNumber: 3 },
    },
    {
      role: "user",
      content: "If you look at the manuscript map what are the titles of the first 3 chapters?",
    },
    {
      role: "assistant",
      content: "Chapter Seven.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL, chapterNumber: 7 },
    },
    {
      role: "user",
      content: "ok what is the next chapter we have open",
    },
  ]);
  assert.equal(topic.chapterNumber, 7);
  assert.deepEqual(
    uniqueAssistantChapterNumbers(
      "The first three chapter titles in the manuscript map are Chapter One, Chapter Two, and Chapter Three."
    ),
    [1, 2, 3]
  );
});

test("resolveEllisTopicChapterFromMessages does not let older Q&A outrank a later chapter review", () => {
  const topic = resolveEllisTopicChapterFromMessages([
    {
      role: "assistant",
      content: "Chapter Four – POV: Myla\n\nFunction in Story\nThis chapter…",
      metadata: {
        kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
        chapterNumber: 4,
        chapterId: "c4",
      },
    },
    {
      role: "assistant",
      content: "Yes — Myla is the right POV for Chapter Seven.",
      metadata: { kind: ELLIS_METADATA_KIND_CONVERSATIONAL },
    },
  ]);
  assert.equal(topic.chapterNumber, 4);
  assert.equal(topic.chapterId, "c4");
});

test("buildEllisPassProgressBlock names the conversation chapter and omits sidebar", () => {
  const block = buildEllisPassProgressBlock({
    userContents: [
      ...sampleContents,
      {
        _id: "ccc",
        chapterNumber: 20,
        chapterLabel: "Chapter Twenty",
        userContent: "<p>Twenty</p>",
      },
    ],
    reviewedChapters: [{ chapterNumber: 9, chapterSuffix: "" }],
    conversationChapter: {
      chapterNumber: 20,
      chapterLabel: "Chapter Twenty",
    },
    lastReviewedChapter: { chapterNumber: 9, chapterSuffix: "" },
  });
  assert.match(
    block,
    /Conversation chapter this turn \(authoritative\): Chapter Twenty/
  );
  assert.doesNotMatch(block, /Sidebar selection/);
  assert.doesNotMatch(block, /Chapter the writer currently has open/);
  assert.doesNotMatch(block, /Chapter the writer is currently discussing/);
  assert.match(block, /that request is for Chapter Twenty/);
});

test("buildEllisPassProgressBlock does not mention an outline sidebar chapter", () => {
  const block = buildEllisPassProgressBlock({
    userContents: sampleContents,
    reviewedChapters: [],
  });
  assert.doesNotMatch(block, /Sidebar selection/);
  assert.doesNotMatch(block, /Chapter the writer currently has open/);
  assert.doesNotMatch(block, /Conversation chapter this turn/);
});

test("stripEllisOpenEndedOffers removes open-ended 👉 offer lines", () => {
  const input =
    "Chapter Three works because the stakes escalate cleanly.\n\n👉 If you want, ask me the specific Chapter Three issue you're weighing, and I'll answer that directly.";
  const stripped = stripEllisOpenEndedOffers(input);
  assert.match(stripped, /stakes escalate cleanly/);
  assert.doesNotMatch(stripped, /If you want/);
  assert.doesNotMatch(stripped, /👉/);
});

test("stripEllisOpenEndedOffers removes 'I can help you' offer variants", () => {
  const input =
    "That ending lands.\n\n👉 If you want, I can help you think through what to trim in Chapter One so it earns that ending even more cleanly.";
  const stripped = stripEllisOpenEndedOffers(input);
  assert.match(stripped, /That ending lands\./);
  assert.doesNotMatch(stripped, /help you think through/);
});

test("stripEllisOpenEndedOffers keeps Output Standard 👉 labels and containment close", () => {
  const review =
    "👉 Editorial Logic: The escalation stalls at the midpoint.\n👉 Application Example 1: Stage the reveal earlier.";
  assert.equal(stripEllisOpenEndedOffers(review), review);

  const close =
    "👉 We've pressure-tested this chapter/issue well. Is there anything else you want to discuss here, or should we continue moving to the next chapter?";
  assert.equal(stripEllisOpenEndedOffers(close), close);
});

test("stripEllisLeakedModeFraming removes revision-check scaffolding from the opener", () => {
  const stripped = stripEllisLeakedModeFraming(
    "This one is a revision check, not a fresh first pass. Against the original notes, the chapter is stronger in its overall descent shape, but it still needs pressure redistributed through the middle."
  );
  assert.equal(
    stripped,
    "The chapter is stronger in its overall descent shape, but it still needs pressure redistributed through the middle."
  );
  assert.doesNotMatch(stripped, /revision check/i);
  assert.doesNotMatch(stripped, /first pass/i);
  assert.doesNotMatch(stripped, /Against the original notes/i);
});

test("stripEllisLeakedModeFraming leaves editorial judgment untouched", () => {
  const input =
    "The chapter is stronger in its overall descent shape, but the middle still needs pressure.";
  assert.equal(stripEllisLeakedModeFraming(input), input);
});

test("stripEllisLeakedModeFraming removes attached-body targeting talk", () => {
  const stripped = stripEllisLeakedModeFraming(
    "No — I see Chapter Five here, and the following reference text is Chapter Seven, not Chapter Six.\n\nChapter Six is in the book."
  );
  assert.doesNotMatch(stripped, /I see Chapter Five here/i);
  assert.doesNotMatch(stripped, /following reference text/i);
  assert.match(stripped, /Chapter Six is in the book/);

  const missing = stripEllisLeakedModeFraming(
    "I can review Chapter One, but I don’t have Chapter One’s revised text in front of me here. We’re still looking at Chapter Five material, so I can’t give you a real assessment from this context alone.\n\nThe opening still has to earn the rupture."
  );
  assert.doesNotMatch(missing, /in front of me/i);
  assert.doesNotMatch(missing, /from this context alone/i);
  assert.match(missing, /opening still has to earn/);
});

test("stripEllisLeakedModeFraming removes chapter-in-play targeting talk", () => {
  const stripped = stripEllisLeakedModeFraming(
    "Because you asked to do the review, and the chapter in play at that moment was Chapter Six, so I delivered the full pass on Chapter Six.\n\nThen the conversation moved back to Chapter Eight."
  );
  assert.doesNotMatch(stripped, /in play/i);
  assert.match(stripped, /Chapter Eight/);
});

test("stripEllisFalseInsertClaims removes prose insert claims", () => {
  const input =
    "Great plan.\n\nThis chapter was inserted into your revision plan.\n\nNext steps.";
  const stripped = stripEllisFalseInsertClaims(input);
  assert.doesNotMatch(stripped, /inserted into your revision plan/i);
  assert.match(stripped, /Great plan/);
  assert.match(stripped, /Next steps/);
});

test("rewriteEllisReviewOpenersToChapterTitle uses the stored chapter title", () => {
  const rewritten = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter Two – POV: Darien\n\nFunction in Story:\nThe scene opens.",
    "1.5"
  );
  assert.match(rewritten, /^1\.5 – POV: Darien/m);
  assert.doesNotMatch(rewritten, /^Chapter Two – POV:/m);

  const lettered = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter Two A – POV: Darien\nChapter Two B – POV: Cassie",
    "1.5"
  );
  assert.match(lettered, /^1\.5 A – POV: Darien/m);
  assert.match(lettered, /^1\.5 B – POV: Cassie/m);

  const oneA = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter One A – POV: Myla\n\nFunction in Story\nThis inserted chapter bridges Chapter One and Chapter Two.",
    "1.5"
  );
  assert.match(oneA, /^1\.5 A – POV: Myla/m);
  assert.doesNotMatch(oneA, /Chapter One A/);

  const alreadyCorrect = rewriteEllisReviewOpenersToChapterTitle(
    "1.5 – POV: Darien\n\nFunction in Story:\nThe scene opens.",
    "1.5"
  );
  assert.match(alreadyCorrect, /^1\.5 – POV: Darien/m);

  const defaultLabel = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter Two – POV: Darien",
    "Chapter Two"
  );
  assert.equal(defaultLabel, "Chapter Two – POV: Darien");

  const missingPov = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter One\n\nFunction in Story\nThe scene opens.",
    "Chapter One",
    "Myla"
  );
  assert.match(missingPov, /^Chapter One – POV: Myla$/m);
  assert.match(missingPov, /Function in Story/);

  const boldMissingPov = rewriteEllisReviewOpenersToChapterTitle(
    "**Chapter One**\n\nFunction in Story",
    "Chapter One",
    "Myla"
  );
  assert.match(boldMissingPov, /^\*\*Chapter One – POV: Myla\*\*$/m);

  const splitPovLine = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter One\nPOV: Myla\n\nFunction in Story\nThe scene opens.",
    "Chapter One",
    ""
  );
  assert.match(splitPovLine, /^Chapter One – POV: Myla$/m);
  assert.doesNotMatch(splitPovLine, /^POV: Myla$/m);
  assert.match(splitPovLine, /Function in Story/);

  const trailingDash = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter One –\n\nFunction in Story",
    "Chapter One",
    "Myla"
  );
  assert.match(trailingDash, /^Chapter One – POV: Myla$/m);
});

test("rewriteEllisReviewOpenersToChapterTitle stamps A/B when one chapter repeats an unlabeled opener", () => {
  const rewritten = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter Five – POV: Myla\n\nFunction in Story\nAlley.\n\nChapter Five – POV: Myla\n\nFunction in Story\nHomecoming.",
    "Chapter Five"
  );
  assert.match(rewritten, /^Chapter Five A – POV: Myla$/m);
  assert.match(rewritten, /^Chapter Five B – POV: Myla$/m);
  assert.doesNotMatch(rewritten, /^Chapter Five – POV: Myla$/m);

  const alreadyLettered = rewriteEllisReviewOpenersToChapterTitle(
    "Chapter Five A – POV: Myla\nChapter Five B – POV: Myla",
    "Chapter Five"
  );
  assert.match(alreadyLettered, /^Chapter Five A – POV: Myla$/m);
  assert.match(alreadyLettered, /^Chapter Five B – POV: Myla$/m);

  const single = stampEllisRepeatedSceneOpenerLetters(
    "Chapter Five – POV: Myla\n\nFunction in Story"
  );
  assert.match(single, /^Chapter Five – POV: Myla$/m);
});

test("resolveEllisReviewUnit matches added decimal chapter labels like 1.5 and 2.5", () => {
  const rows = [
    { _id: "ch1", chapterNumber: 1, chapterLabel: "Chapter One", userContent: "<p>One</p>" },
    {
      _id: "ch15",
      chapterNumber: 2,
      chapterLabel: "1.5",
      sceneTitle: "1.5",
      userContent: "<p>One and a half</p>",
    },
    { _id: "ch2orig", chapterNumber: 3, chapterLabel: "Chapter Two", userContent: "<p>Two</p>" },
    {
      _id: "ch25",
      chapterNumber: 4,
      chapterLabel: "Chapter 2.5",
      sceneTitle: "Chapter 2.5",
      userContent: "<p>Two and a half</p>",
    },
  ];
  const added = resolveEllisReviewUnit({ userContents: rows, chapterNumber: 1.5 });
  assert.equal(added?._id, "ch15");
  assert.equal(Number(added?.chapterNumber), 2);
  assert.equal(
    findChapterRowByNumericLabel(rows, 2.5)?._id,
    "ch25"
  );
  // Label match wins over position: ch2orig is still literally labeled
  // "Chapter Two" even though the "1.5" insert shifted its chapterNumber to
  // 3, so "review chapter 2" must resolve to ch2orig, not the row that now
  // occupies position 2.
  assert.equal(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 2 })?._id,
    "ch2orig"
  );
  assert.notEqual(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 1.5 })?._id,
    "ch2orig"
  );
});

test("resolveEllisReviewUnit prefers a renumbered chapter's own label over its shifted position", () => {
  // Real uploaded chapters get word-form labels ("Chapter Two") from the
  // manuscript parser. Inserting "1.5" after chapter 1 shifts chapter Two's
  // chapterNumber from 2 to 3 without touching its label — "review chapter
  // 2" must still mean the chapter labeled Two, not whatever row now sits
  // at position 2.
  const rows = [
    { _id: "ch1", chapterNumber: 1, chapterLabel: "Chapter One", userContent: "<p>One</p>" },
    {
      _id: "ch15",
      chapterNumber: 2,
      chapterLabel: "1.5",
      sceneTitle: "1.5",
      userContent: "<p>One and a half</p>",
    },
    { _id: "ch2word", chapterNumber: 3, chapterLabel: "Chapter Two", userContent: "<p>Two</p>" },
    { _id: "ch3word", chapterNumber: 4, chapterLabel: "Chapter Three", userContent: "<p>Three</p>" },
  ];
  assert.equal(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 2 })?._id,
    "ch2word"
  );
  assert.notEqual(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 2 })?._id,
    "ch15"
  );
  assert.equal(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 1.5 })?._id,
    "ch15"
  );
  assert.equal(
    resolveEllisReviewUnit({ userContents: rows, chapterNumber: 3 })?._id,
    "ch3word"
  );
});

test("findChapterRowByNumericLabel does not let a short digit match a longer one (2 vs 20, 2 vs 2.5)", () => {
  const rows = [
    { _id: "c2", chapterNumber: 1, chapterLabel: "Chapter 2", userContent: "" },
    { _id: "c20", chapterNumber: 2, chapterLabel: "Chapter 20", userContent: "" },
    { _id: "c25", chapterNumber: 3, chapterLabel: "Chapter 2.5", userContent: "" },
  ];
  assert.equal(findChapterRowByNumericLabel(rows, 2)?._id, "c2");
  assert.equal(findChapterRowByNumericLabel(rows, 20)?._id, "c20");
  assert.equal(findChapterRowByNumericLabel(rows, 2.5)?._id, "c25");
});

test("findChapterRowByNumericLabel ignores a scene title that merely starts with a number word", () => {
  const rows = [
    {
      _id: "ch4",
      chapterNumber: 4,
      chapterLabel: "Chapter Four",
      sceneTitle: "Six months later",
      userContent: "",
    },
    {
      _id: "ch6",
      chapterNumber: 6,
      chapterLabel: "Chapter Six",
      sceneTitle: "The funeral",
      userContent: "",
    },
  ];
  assert.equal(findChapterRowByNumericLabel(rows, 6)?._id, "ch6");
  assert.equal(
    resolveEllisReviewUnit({
      userContents: rows,
      chapterNumber: 6,
      chapterId: "ch4",
    })?._id,
    "ch6"
  );
});
