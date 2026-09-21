/**
 * Copy for Olivia UI-only thread messages (persisted in Message, excluded from model input).
 * Also: runtime instructions appended to Olivia Editor (layering) API calls — keep in sync with olivia-editor.txt.
 */

export const OLIVIA_METADATA_KIND_SCENE_WELCOME = "olivia_scene_welcome";
export const OLIVIA_METADATA_KIND_LAYERING_WELCOME = "olivia_layering_welcome";
export const OLIVIA_METADATA_KIND_OUTLINE_CONFIRM = "olivia_outline_confirm";
/** Posted once when the 15th core outline slot is first filled. */
export const OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED = "olivia_core_spine_locked";
/** Post–layering insert confirmation on the editor thread (excluded from model input). */
export const OLIVIA_METADATA_KIND_LAYERING_OUTLINE_CONFIRM = "olivia_layering_outline_confirm";

export const OLIVIA_CORE_NEXT_SCENE_CONFIRM_TEXT =
  "The chapter is now in your outline! If you already have an idea for this next chapter, tell me. If not, I can step in and propose the strongest next chapter beat based on your Story Bible and the momentum of your story so far. Ready for the next chapter? Tell me how you would like to proceed.";

export const OLIVIA_CORE_SPINE_LOCKED_TEXT =
  "The chapter is now in your outline! All 15 core chapters are now locked. Beautiful work. 🎉\n\n" +
  "Here's what we're going to do next: I'm going to give you a chapter summary table so you can see your full story progression at a glance, and then we'll start identifying chapters to layer in for added depth.\n\n" +
  "Ready to see your table?";

export const OLIVIA_CORE_SCENE_SAVED_CONFIRM_TEXT =
  "The chapter is now in your outline!";

/**
 * Pick the post-save chat confirmation. The 15-lock table offer is only
 * for the save that fills the last empty core slot, and only once per thread.
 */
export const resolveOliviaCoreSaveConfirm = ({
  nextEmptySlot,
  hadEmptyCoreSlot,
  alreadyPostedSpineLock,
} = {}) => {
  if (nextEmptySlot) {
    return {
      content: OLIVIA_CORE_NEXT_SCENE_CONFIRM_TEXT,
      kind: OLIVIA_METADATA_KIND_OUTLINE_CONFIRM,
    };
  }
  if (hadEmptyCoreSlot && !alreadyPostedSpineLock) {
    return {
      content: OLIVIA_CORE_SPINE_LOCKED_TEXT,
      kind: OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED,
    };
  }
  return {
    content: OLIVIA_CORE_SCENE_SAVED_CONFIRM_TEXT,
    kind: OLIVIA_METADATA_KIND_OUTLINE_CONFIRM,
  };
};

export const OLIVIA_LAYERING_QUICK_REPLIES = [];


export const OLIVIA_SCENE_WELCOME_TEXT =
  "Yes! Let's get started. ✨\n\n" +
  "Let me know what direction we are heading.\n\n" +
  "🧭 **Starting from scratch or working from an incomplete first draft?**\n\n" +
  "We'll begin with **Act 1, Chapter 1** and build your first **15 Key Chapters/Scenes** across Acts 1, 2, and 3.\n\n" +
  "👉 Just say: **\"Start Act 1, Chapter 1.\"**\n\n" +
  "---\n\n" +
  "🔧 **Already have a finished first draft?**\n\n" +
  "**Tell me about your Chapter 1.**\n\n" +
  "*For example:*\n\n" +
  "*\"My Chapter One opens with Eliza arriving at Blackwell Manor after receiving a strange letter from her late aunt. She meets the housekeeper, finds a locked room, and hears someone crying behind the door. Right now, the chapter has atmosphere, but I want more pressure, a stronger turn, and a bigger reason for the reader to worry.\"*\n\n" +
  "📌**Remember, I work much better with a high-level overview of your chapter than with the full chapter pasted in here. 😊** Tell me what happens, what feels missing, and what you want the chapter to achieve or just ask me questions about it. **That gives me room to think bigger and help you redesign the beat structure, instead of getting boxed in by what is already on the page.**\n\n" +
  "🛑 Please do not upload full manuscripts, large documents, or unrelated material here.\n\n" +
  "I'm not a document-scanning tool. 💀 I'm your interactive trained story editor, with a very fancy craft brain. 😊\n\n" +
  "👉 So, what are we doing?\n\n" +
  "**\"Start Act 1, Chapter 1.\"**\n\n" +
  "or\n\n" +
  "**\"I have a draft, and here is what happens in Chapter 1…\"**";

/**
 * Static preamble and postamble for the layering welcome. The controller
 * concatenates: PREAMBLE + dynamic 15-scene table + POSTAMBLE.
 * Legacy callers that still reference OLIVIA_LAYERING_WELCOME_TEXT get the
 * same static string without a table (backward compat).
 */
export const OLIVIA_LAYERING_WELCOME_PREAMBLE =
  "✨ **Your 15-scene spine is now locked. Beautiful work.**\n\n" +
  "Here's your **current 15-scene spine** (reference only — this is NOT the layering table):\n\n";

export const OLIVIA_LAYERING_WELCOME_POSTAMBLE =
  "\n\nNow review the table and let's start layering in new **chapters/scenes** to expand subplots, strengthen narrative threads, create tension, deepen relationships, or honor your story vision. " +
  "Most full-length novels expand to about **30–40 chapters/scenes**, so you can bring me your own ideas, ask me to make suggestions for your consideration based on your current story arc, or we can do both. ✍️\n\n" +
  "We'll work through the story arc for the newly added chapters/scenes in this table format first. Once we lock the table with the new chapters/scenes you want to keep, I'll start delivering each one in the full scene beat format so you can save it into your outline. 📚\n\n" +
  "You can also ask clarifying questions before we begin. 💬\n\n" +
  "😊 **I'll be here when you're ready.**";

export const OLIVIA_LAYERING_WELCOME_TEXT =
  OLIVIA_LAYERING_WELCOME_PREAMBLE + OLIVIA_LAYERING_WELCOME_POSTAMBLE;

/**
 * Appended verbatim by the model after every Phase-1 layering table. Duplicated in olivia-editor.txt for authors editing the prompt.
 */
export const OLIVIA_LAYERING_AFTER_TABLE_REMINDER =
  "💬 Review the proposed new scenes across the three acts and tell me which ones feel right, which ones do not, and what feels off. " +
  "The more specific your feedback, the better I can shape the outline around your vision. 😊\n\n" +
  "Let's keep refining the table together.\n\n" +
  "👉 Once the new scenes are locked on the table, I'll expand each approved scene one by one into the full scene beat format so you can review it, make any final changes, and insert it into your outline. 📚";

/**
 * Drafting transition delivered after all NEW scenes from the layering table
 * have been expanded and inserted. Sets layeringComplete on the Novel model.
 */
export const OLIVIA_DRAFTING_TRANSITION_TEXT =
  "🎉 **Beautiful work — your expanded outline is now in place.**\n\n" +
  "You are ready to start drafting your novel. ✍️ You have a strong structure in place. Your first draft is going to rock!\n\n" +
  "You do not need to wait until everything feels perfect to begin. Start writing from the outline you have now, and let the story keep revealing itself as you go.\n\n\n" +
  "As new ideas come up, or if you want to adjust a scene while drafting, just click 👉 **Edit** (on the right-hand corner) on that scene and update it in real time. You can revise the scene design, add notes, or come back to me with questions about any scene you are working on. 😊 I'm your 24/7 book coach.\n\n" +
  "💡 As you write, you can return anytime to \n" +
  "• add a new scene\n" +
  "• deepen a relationship, subplot, or turning point\n" +
  "• pressure-test a story decision before moving forward\n" +
  "👉 Remember, your outline is a working blueprint. It is meant to support your drafting, not trap you.\n\n" +
  "Happy writing. I'll be here when you need me. 😊";

export const OLIVIA_METADATA_KIND_DRAFTING_TRANSITION = "olivia_drafting_transition";

/** Office 3 — scene completion gate before a full coaching pass. */
export const OLIVIA_METADATA_KIND_COACHING_GATE = "olivia_coaching_gate";

/** Office 3 — full coaching pass snapshot for revision intelligence. */
export const OLIVIA_METADATA_KIND_COACHING_FULL_PASS = "olivia_coaching_full_pass";

/**
 * Verbatim post-scene CTA after scene delivery (period-only line, blank line, then this paragraph).
 * Keep in sync with olivia-editor.txt and olivia-scene.txt.
 */
export const OLIVIA_SCENE_POST_SCENE_CTA =
  "👉 **Love this direction?** Click **Save Chapter to Outline** and we'll lock it in. ✅ Have questions about this chapter before you commit? Ask me first and we can talk it through. 🛠️ If something doesn't feel right, tell me what feels off, what you want more of, less of, or different, so I can better understand your story vision and revise it with you. ✨ Want to brainstorm before we move to the next chapter? We can do that too.";

// ---------------------------------------------------------------------------
// Phase-scoped layering runtime rules (Phase 2 — `phase2-layering-phase`).
//
// Originally one giant constant injected on every Olivia editor turn.
// Now split per layering phase so the assembler only ships the active
// phase's rules. `OLIVIA_EDITOR_LAYERING_RUNTIME_RULES` is kept exported
// for backward compatibility (controllers behind `isOliviaMemoryV2Enabled()`
// flag bypass it; the legacy path still uses the full string).
//
// Phase mapping:
//   outlining        → only the universal "phase_boundaries" snippet
//   phase1_table     → table iteration + after-table reminder + phase-1 gate
//                      + exploration cue (phase 1 variant)
//   phase2_expansion → sequential expansion + exploration cue (phase 2)
//   coaching         → unused for editor (Office 3 uses olivia_coaching agent)
//   drafting         → only universal phase_boundaries
//
// All phases also receive `LAYERING_RUNTIME_RULES_PHASE_BOUNDARIES`.
// ---------------------------------------------------------------------------

const LAYERING_PHASE1_TABLE_ITERATION = `
Phase_1_Table_iteration:
- When the writer wants to layer or revise the plan, deliver the scene layering table: full existing spine plus NEW Chapter rows (decimal positions, e.g. NEW Chapter 2.5). Use a six-column GFM markdown table (Chapter #, Act, Title, POV, Chapter Purpose, Summary). The table must start on its own line after a blank line — never append pipe syntax to prose. Spread NEW rows across all three acts; over revision turns, work toward roughly 10–15 NEW rows as the expanded structure matures.
- Collaboration happens in chat: invite feedback on which NEW rows to keep, drop, or reshape and why; revise the table accordingly. Do not tell the writer that scene selection happens only outside the conversation.
- Do not output table header syntax (| Chapter # | ...) during conversational or agentic replies unless you are delivering a full layering table as the primary output of the turn.

After EVERY assistant message that includes a scene layering markdown table containing at least one row with "NEW Chapter" or "NEW Scene" in the Chapter # column:
- Do NOT write any sentences, bullets, rationale, or other prose between the end of the markdown table and the opening "---" below. The reminder must follow the table immediately.
- End your reply by appending the following block verbatim (same wording every time, including the horizontal rule lines):

---

${OLIVIA_LAYERING_AFTER_TABLE_REMINDER}

---
`.trim();

const LAYERING_PHASE1_GATE = `
Phase_1_gate (MANDATORY — applies before any Phase 2 behavior):
- The 15-scene spine table embedded in the layering-welcome message is NOT a layering table. It contains the existing core scenes only — zero rows whose Chapter # cell is "NEW Chapter X.Y" or "NEW Scene X.Y". It is a reference recap, not something to be "locked" or "expanded".
- You MUST NOT treat a bare "yes", "ok", "go ahead", "sounds good", "locked", "table looks good", or similar affirmative sent after the layering-welcome as confirmation to expand scenes.
- You may only enter Phase 2 (the serial "Ready for Act X, NEW Chapter Y.Z — [title]?" cue and STEP-2 rich blocks) after at least one prior assistant turn in this thread contains a markdown layering table with at least one row whose Chapter # cell begins with "NEW Chapter" or "NEW Scene". If no such NEW-row layering table has been produced yet in this thread, treat the writer's affirmative reply as intent to enter Phase 1: produce a layering table spread across Acts 1–3 with decimal NEW Chapter rows (e.g. NEW Chapter 2.5) and append the mandatory reminder block. Do NOT emit a Phase 2 serial cue and do NOT deliver a STEP-2 rich block in that turn.
`.trim();

const LAYERING_PHASE2_SEQUENTIAL_EXPANSION = `
Phase_2_Sequential_expansion (precondition: a Phase 1 NEW-row layering table has already been produced in this thread — see Phase_1_gate):
- When the writer confirms the layering table is locked (e.g. table looks good, locked, yes let's expand), do NOT ask which NEW scenes to officially lock, which to tweak first, or which scene to expand first from a menu. Build the ordered list of NEW Chapter rows from the latest table (Act 1 then 2 then 3; within act, by chapter number). Start immediately with one short cue: e.g. "Ready for Act 1, NEW Chapter 1.5 — [title]?" matching the FIRST row in that order.
- After they affirm the cue, output ONE STEP-2 rich scene block for that scene only. That message must end like olivia_scenes: after 📈 Character Arc Movement, output a line with only . then a blank line, then exactly this paragraph (verbatim):

${OLIVIA_SCENE_POST_SCENE_CTA}

Then continue serially: after they move on (next, inserted, ok, etc.), cue the next NEW chapter using this transition script: "According to your finalized table, the next chapter is **NEW Chapter X.Y — [title from the finalized table]**. Are you ready for me to deliver that next chapter, or do you want to make any adjustments here first?" Always include the NEW Chapter number (e.g. NEW Chapter 3.5) alongside the title — do not reference the next chapter by title alone.
- If they name one NEW scene out of order, honor it for that delivery, then resume serial flow.
- If they request multiple scenes in one message, still output one rich block; offer to continue with the next in a follow-up turn.
- No layering table in Phase 2 unless they explicitly ask to return to Phase 1 table work.
`.trim();

const LAYERING_EXPLORATION_PHASE1 = `
Exploration_and_redirect_cue:
- During conversational exploration in Phase 1 (before the table is generated or when the writer is discussing ideas), always end your reply with a gentle prompt toward the table — e.g. "Let me know when you'd like to see the table, or if you have more questions."
`.trim();

const LAYERING_EXPLORATION_PHASE2 = `
Exploration_and_redirect_cue:
- During Phase 2 (serial expansion), if the writer asks open-ended or exploratory questions instead of confirming the next scene cue, end your conversational reply with a gentle option to return to scene delivery — e.g. "Would you like to keep exploring this, or shall we get back to delivering your next scene?"
`.trim();

const LAYERING_PHASE_BOUNDARIES = `
Phase_boundaries:
- Purely conversational replies (no table, no STEP-2 rich block) do not require the reminder block.
`.trim();

const RULES_HEADER = "STORY_GROOVE_LAYERING_RUNTIME_RULES (MANDATORY):";

const LAYERING_RULES_BY_PHASE = {
  outlining: [LAYERING_PHASE_BOUNDARIES],
  phase1_table: [
    LAYERING_PHASE1_TABLE_ITERATION,
    LAYERING_PHASE1_GATE,
    LAYERING_EXPLORATION_PHASE1,
    LAYERING_PHASE_BOUNDARIES,
  ],
  phase2_expansion: [
    LAYERING_PHASE2_SEQUENTIAL_EXPANSION,
    LAYERING_EXPLORATION_PHASE2,
    LAYERING_PHASE_BOUNDARIES,
  ],
  coaching: [LAYERING_PHASE_BOUNDARIES],
  drafting: [LAYERING_PHASE_BOUNDARIES],
};

/**
 * Return the layering runtime rules block matching the active
 * `StoryState.layeringPhase`. Used by `contextAssembler.js` so we
 * only ship the rules the writer is actually working with — cuts
 * ~2 KB on every editor turn.
 */
export const getLayeringRuntimeRulesForPhase = (phase) => {
  const sections = LAYERING_RULES_BY_PHASE[phase] || LAYERING_RULES_BY_PHASE.outlining;
  return [RULES_HEADER, "", ...sections.join("\n\n").split("\n")].join("\n");
};

/**
 * Original combined string — kept exported because the pre-V2 path
 * (legacy controllers) still uses it. When memory V2 is disabled (see
 * constants/oliviaMemory.js)
 * Olivia receives the exact same block as before.
 */
export const OLIVIA_EDITOR_LAYERING_RUNTIME_RULES = [
  RULES_HEADER,
  "",
  LAYERING_PHASE1_TABLE_ITERATION,
  "",
  LAYERING_PHASE1_GATE,
  "",
  LAYERING_PHASE2_SEQUENTIAL_EXPANSION,
  "",
  LAYERING_EXPLORATION_PHASE1,
  "",
  LAYERING_EXPLORATION_PHASE2,
  "",
  LAYERING_PHASE_BOUNDARIES,
].join("\n");

/**
 * Anti-hallucination guardrail appended to Olivia's instructions on every
 * book-editor surface (scene, editor, coaching) via `assembleOliviaContext`.
 * Enforces that the Story Bible + CHARACTER PROFILES in context are the
 * complete, authoritative cast — Olivia must never invent named characters.
 */
export const OLIVIA_CANON_INTEGRITY_RULE = `CANON INTEGRITY (MANDATORY — supersedes all other rules): The Story Bible, CHARACTER PROFILES, and CHARACTER ROSTER / CANON ANCHOR in context are the complete, authoritative cast and canon. Use ONLY proper names that appear there. NEVER invent a new named character during scene design, layering, or coaching — not in scene beats, dialogue, examples, or summaries.
- For staff, extras, or functional roles that are NOT in the roster (e.g. a publicist, an assistant, a bartender, a board member), refer to them by a generic role label only ("the PR lead", "a staff member") — never assign a new proper name.
- This rule SUPERSEDES any other instruction — including scene-density rules and methodology rules that say to "name the supporting character" — which apply ONLY to characters already present in the roster. If those rules would require naming someone not in the roster, use a generic label instead.
- If a scene genuinely seems to need a named character who is not in the roster, do NOT invent one: name the gap and ask the writer whether to add that character before proceeding.`;

export const oliviaUiMessageMetadata = (kind, extra = {}) => ({
  excludeFromModelInput: true,
  kind,
  ...extra,
});

/**
 * Scene delivery format spec that used to live inline in `oliviaSceneChat`
 * (novelController.js). Moved here as a named constant so:
 *   1. The controller stays readable.
 *   2. Phase 1.5A's `seedMethodologyFromJson.js --migrate-agent-prompts`
 *      can append this verbatim onto the `olivia_scenes` AgentPrompt row.
 *   3. Tests can import the exact string to assert against the assembled
 *      instructions.
 *
 * The matching block in code (`SCENE FORMAT RULE …`) is identical to
 * this constant. Once the migration script has populated the AgentPrompt
 * row and the controller switches to reading from the DB exclusively,
 * this constant can be deleted.
 */
export const OLIVIA_SCENE_FORMAT_RULE = `SCENE FORMAT RULE (MANDATORY):
When delivering a scene, use this EXACT section format. The rich block MUST begin with Scene Title and POV as the first two lines — each on its own line, no greeting, pitch, or preamble before them:
Scene Title: [3-8 word label for the outline sidebar]
POV: [First and last name of the point-of-view character for this scene]
📘 Book Coaching for Scene: [guidance]
🎭 Genre-Specific Coaching Note ([genre]): [note]
🧩 Subplot Reminder: [prose coaching]
📏 Target Word Count: [N] words
📝 Scene to Write: [one-liner description ONLY — do NOT expand into prose]
🏰 Setting: [sensory environment]
⚡ Significant Actions (Scene Beats):
- [action beat — one bullet per distinct story beat or on-page character turn; merge only trivial physical beats]
💔 Emotional Reactions (Character Interiority):
- [emotional beat — one bullet per character with interiority on the page; merge only redundant duplicate feelings]
🔗 Subplot Tie-In: [tie-in or "no subplot tie-in applicable"]
📈 Character Arc Movement: [arc note]

BULLET COUNT RULE (MANDATORY):
- Include every story-significant beat needed for this scene to work on the page — do not omit named characters, subplot turns, or beats from the Story Bible's Opening Scene Idea / anchor scenes for this position.
- Typical scene: about 5–8 bullets per section (Significant Actions and Emotional Reactions).
- High-density scenes (opening image, inciting public rupture, climax, ensemble party, "all threads activate"): 8–12 bullets in Significant Actions when the bible requires multiple on-page characters; one emotional bullet per character who has a distinct reaction on the page in Emotional Reactions.
- Merge only trivial physical motion — never merge separate character arcs, separate subplot seeds, or antagonist/love-interest introductions into one generic bullet.
- Avoid thin lists (1–2 bullets) and exhaustive micro-catalogs (every gesture). If the bible names a character's beat for this scene, it gets its own bullet.

OPENING SCENE (Scene 1) DENSITY (MANDATORY): When delivering Scene 1, treat it as a high-density ensemble ignition scene if the Story Bible lists multiple supporting characters and subplots. Significant Actions must dramatize each friend's seed beat and any characters named in Opening Scene Idea. Emotional Reactions must cover each of those characters, not only the POV lead. Do not defer bible-mandated appearances to later scenes.

SCENE QUALITY RULES (MANDATORY):
- Every scene must introduce a new conflict, twist, revelation, or turning point — do not repeat beats from earlier scenes unless deliberately escalated.
- Rotate scene types across the outline: action, dialogue-heavy, introspective, external conflict — vary the texture.
- Every scene must contain a crisis or decision point that forces the character to reveal something about themselves.
- Subplot moments should create peaks and valleys in tension — use them to escalate or provide relief at strategic points.
- Ground every scene in sensory details specific to the genre; show how the environment shapes mood and character behaviour.
- Explicitly connect each scene to what immediately preceded it: show how the emotional or plot stakes carry forward.

After 📈 Character Arc Movement, STOP. Do NOT continue with story prose, narrative text, dialogue, or manuscript content. This is an outline, not a draft.

STRUCTURAL OVERLAY RULE (MANDATORY):
If the Story Bible specifies a rotating POV, ensemble cast, or alternating character structure, you MUST rotate POV according to that pattern. NEVER deliver more than 2 consecutive scenes from the same character's POV when the overlay specifies rotation. Before delivering any scene, check the POV ROTATION TRACKER above — if the same character appears in the last 2 delivered scenes, you MUST choose a different character.
If the Story Bible does not specify POV for this scene position, choose the POV character whose perspective best serves this scene's function; vary POV across scenes when the cast supports it unless strict single-POV is specified.`;
