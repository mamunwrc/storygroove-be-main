/**
 * Copy for Ellis thread messages. Welcome + full reviews stay out of model
 * replay (`excludeFromModelInput`). Insert-confirms name the next chapter and
 * must stay in history so a "yes" after "next open chapter is X" has conversation context.
 */

export const ELLIS_METADATA_KIND_SCENE_WELCOME = "ellis_scene_welcome";
export const ELLIS_METADATA_KIND_INSERT_CONFIRM = "ellis_insert_confirm";
/** Assistant message containing a full chapter developmental review (Scene Architect). */
export const ELLIS_METADATA_KIND_CHAPTER_REVIEW = "ellis_chapter_review";
/** Assistant message containing a revision-history evaluation of writer changes. */
export const ELLIS_METADATA_KIND_REVISION_REVIEW = "ellis_revision_review";
/** Assistant message from a follow-up / agentic Q&A turn (not a full chapter review). */
export const ELLIS_METADATA_KIND_CONVERSATIONAL = "ellis_conversational";
/** Assistant message holding an editorial letter draft (Phase 1 refine thread). */
export const ELLIS_METADATA_KIND_LETTER_DRAFT = "ellis_editorial_letter_draft";
/** User refine request in the editorial letter thread. */
export const ELLIS_METADATA_KIND_LETTER_REFINE = "ellis_editorial_letter_refine";

export const ELLIS_SCENE_WELCOME_TEXT =
  "Your Editorial Letter and Manuscript Map are now saved in the Manuscript Hub 👈 on the left. The map gives you an at-a-glance view of your novel by chapter, so you can see the full shape of the manuscript before we begin the deeper work.\n\n" +
  "Now we'll move into your chapter-by-chapter developmental pass.\n\n" +
  "The best way to work with me is to build the full Revision Plan first, one chapter at a time, before making major changes. That gives you the whole manuscript strategy before you revise Chapter One and later discover that the real pressure point lives in Chapter Thirty.\n\n" +
  "This will take some time, so be gentle with yourself. We are not generating a quick report. We are doing deep craft work: structure, character movement, stakes, pacing, and reader payoff, chapter by chapter.\n\n" +
  "That kind of critical thinking can be tiring after a few chapters. Take breaks when you need them. I'll be here when you come back.\n\n" +
  "**Here's how we'll work:**\n\n" +
  "- Start with Chapter One.\n" +
  "- I'll deliver a focused developmental review.\n" +
  "- Some chapters contain more than one scene. If I miss a scene inside a chapter, just ask me to look for it, and I'll review it.\n" +
  "- If the direction feels right, click 👉 Insert to Revision Plan.\n" +
  "- You can ask questions, clarify anything, and add your own notes in the 👉 Chapter Notes section.\n" +
  "- Then we'll move to the next chapter.\n\n" +
  "📝 **A note on how to read my feedback:** This is an interactive developmental edit session. I am not a scorecard or a polish meter. I will not rate a chapter as \"done\" or keep moving it toward 100%. Developmental editing is judgment-based, not percentage-based. My role is to identify the strongest revision opportunities; your role is to decide which notes serve the book.\n\n" +
  "🔎 If my feedback becomes highly specific or starts to feel repetitive, that often means the chapter is already working. Use your judgment, ask me questions when something feels off, and keep moving when the revision plan feels ready.\n\n" +
  "👉 **To begin, say: Start Chapter One**";

/** Kickoff when the named chapter has no draft prose. Keep in sync with FE `buildEllisEmptyChapterMessage`. */
export const buildEllisEmptyChapterMessage = (chapterLabel = "This chapter") =>
  `**${chapterLabel}** doesn't have any draft content yet. Write or paste your chapter in the editor, then ask me to review it again.`;

export const ellisUiMessageMetadata = (kind, extra = {}) => ({
  excludeFromModelInput: true,
  kind,
  ...extra,
});

/** Insert-confirms are conversational cues, even if an older row was flagged UI-only. */
export const isEllisThreadMessageForModel = (msg) => {
  if (!msg) return false;
  if (msg.metadata?.kind === ELLIS_METADATA_KIND_INSERT_CONFIRM) return true;
  return !msg.metadata?.excludeFromModelInput;
};

/** Metadata for persisted chapter review assistant rows (UI visible, excluded from model replay). */
export const ellisChapterReviewMetadata = ({
  chapterNumber,
  chapterId,
  chapterSuffix = "",
  draftContentHash = null,
}) => ({
  excludeFromModelInput: true,
  kind: ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  chapterNumber: Number(chapterNumber),
  chapterSuffix: String(chapterSuffix || "").toUpperCase(),
  chapterId: String(chapterId),
  ...(draftContentHash ? { draftContentHash: String(draftContentHash) } : {}),
});

/** Metadata for revision-history evaluation rows. */
export const ellisRevisionReviewMetadata = ({
  chapterNumber,
  chapterId,
  chapterSuffix = "",
}) => ({
  excludeFromModelInput: true,
  kind: ELLIS_METADATA_KIND_REVISION_REVIEW,
  chapterNumber: Number(chapterNumber),
  chapterSuffix: String(chapterSuffix || "").toUpperCase(),
  chapterId: String(chapterId),
});

/** Pin line Ellis emits after a real revision-check. Prompt-owned; used only to tag the turn. */
export const ELLIS_REVISION_CHECK_FOOTER_MARKER =
  "📌 To save anything you want to revisit";

export const textHasEllisRevisionCheckFooter = (text) =>
  String(text || "").includes(ELLIS_REVISION_CHECK_FOOTER_MARKER);

export const ELLIS_FIRST_PASS_WRAP_UP_SNIPPET =
  "This completes your first developmental pass through the manuscript";

export const isEllisFirstPassWrapUpText = (text) =>
  String(text || "").includes(ELLIS_FIRST_PASS_WRAP_UP_SNIPPET);

export const buildEllisInsertConfirmText = ({
  chapterLabel,
  nextChapterLabel = null,
  nextChapterNumber = null,
  isBackfill = false,
  nextChapterAlreadyReviewed = false,
  firstPassAlreadyComplete = false,
}) => {
  const inserted = `✅ **${chapterLabel}** was inserted into your Revision Plan.\n\n`;
  if (nextChapterLabel && nextChapterNumber != null) {
    const nextLine = nextChapterAlreadyReviewed
      ? `**${nextChapterLabel}** already has a developmental review in this thread but isn't in your Revision Plan yet. Scroll up to that review and click **👉 Insert to Revision Plan** when you're ready.\n\nAfter that, tell me when you'd like to continue — or say which chapter you'd like to work on next.`
      : isBackfill
        ? `Your next open chapter is **${nextChapterLabel}**. Tell me when you're ready to continue your developmental pass.`
        : `Your next open chapter is **${nextChapterLabel}**. Say when you'd like me to run the next developmental edit pass.`;
    return inserted + nextLine;
  }
  if (firstPassAlreadyComplete) {
    return (
      inserted +
      "If you add more chapters, we can review those next. You can also keep revising, ask global questions, or talk through a choice as you write."
    );
  }
  return (
    inserted +
    "🎉 Congratulations. This completes your first developmental pass through the manuscript.\n\n" +
    "📘 Your Editorial Letter and Chapter-by-Chapter Revision Plan now give you a clear path into revision.\n\n" +
    "🔎 Next, you can ask me global questions, revisit the Editorial Letter, or talk through missing bridge scenes and connective tissue before you revise.\n\n" +
    "📝 If we identify new scenes, you can earmark them as placeholders, insert them into your Manuscript Map, and add notes in the Chapter Notes section.\n\n" +
    "✍️ You can also begin editing chapter by chapter now. If you get stuck or want to talk through a revision choice as you write, just ask me."
  );
};
