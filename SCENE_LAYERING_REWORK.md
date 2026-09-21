# Scene Layering Flow Rework (Client Feedback 4/11)

Overview of all changes implemented based on the client's 4/11 transcript and PDF feedback.

---

## 1. Layering Welcome Message — Table First, Then Instructions

**Problem:** The old welcome jumped straight into layering instructions without showing the writer their 15-scene spine.

**Solution:** The welcome is now built dynamically on the backend. When the editor thread is created (or history is first loaded), the controller builds a GFM markdown table of all 15 core scenes and inserts it between a preamble and postamble.

**Flow:**
1. "Your 15-scene spine is now locked. Beautiful work. Here's your full story progression at a glance."
2. Dynamic 15-scene table with columns: `Scene # | Act | Title | POV | Scene Purpose | Summary`
3. Instructional text: review your story, identify gaps, reference your materials, jot down ideas, come back when ready.

**Files changed:**
- `constants/oliviaUiMessages.js` — Split `OLIVIA_LAYERING_WELCOME_TEXT` into `OLIVIA_LAYERING_WELCOME_PREAMBLE` and `OLIVIA_LAYERING_WELCOME_POSTAMBLE`. Legacy fallback `OLIVIA_LAYERING_WELCOME_TEXT` still works (preamble + postamble without table).
- `controllers/novelController.js` — Added `buildFifteenSceneTable()` helper that queries `UserContent` and `StoryResponse` to build the table. Added `buildLayeringWelcomeText()` that combines preamble + dynamic table + postamble. Both `oliviaEditorChat` and `getOliviaEditorHistory` now use the dynamic welcome when creating or backfilling the welcome message.

---

## 2. Scene Purpose Column Added to All Tables

**Problem:** Tables lacked a "Scene Purpose" column that the client wants for structural clarity.

**Solution:** All table formats updated from 5-column to 6-column: `| Scene # | Act | Title | POV | Scene Purpose | Summary |`

**Files changed:**
- `olivia-editor.txt` — Phase 1 table format updated.
- `olivia-scene.txt` — Scene Summary Table format updated.
- `constants/oliviaUiMessages.js` — `OLIVIA_EDITOR_LAYERING_RUNTIME_RULES` specifies the 6-column format.
- `utils/oliviaLayeringParse.js` (backend) — Parser updated to handle both 6-column (new) and 5-column (legacy) tables. When `dataCells.length >= 4`, summary is read from `dataCells[3]`; otherwise falls back to `dataCells[2]`.
- `storygroove-fe/src/Pages/BookEditor/oliviaLayeringParse.js` (frontend) — Same parser update, kept in sync.

---

## 3. After-Table Reminder Updated

**Problem:** Old reminder text didn't match client's preferred phrasing.

**Solution:** Replaced `OLIVIA_LAYERING_AFTER_TABLE_REMINDER` with the client's copy:

> Review the proposed new scenes across the three acts and tell me which ones feel right, which ones do not, and what feels off. The more specific your feedback, the better I can shape the outline around your vision.
>
> Let's keep refining the table together.
>
> Once the new scenes are locked on the table, I'll expand each approved scene one by one into the full scene beat format so you can review it, make any final changes, and insert it into your outline.

**Files changed:**
- `constants/oliviaUiMessages.js` — `OLIVIA_LAYERING_AFTER_TABLE_REMINDER` rewritten.
- `olivia-editor.txt` — Matching reminder text updated.

---

## 4. Agentic Cue — Always Prompt Toward the Table

**Problem:** During conversational exploration, the writer had no clear signal that they could move to the table at any time.

**Solution:** Added instruction: Olivia must always end exploration replies with a cue like "Let me know when you'd like to see the table, or if you have more questions."

**Files changed:**
- `olivia-editor.txt` — Added step 5 to Conversational Exploration: "Always cue toward the table." Added anti-pattern: "Do NOT end a conversational reply without cueing toward the table."
- `constants/oliviaUiMessages.js` — Added `Exploration_cue` section to `OLIVIA_EDITOR_LAYERING_RUNTIME_RULES`.

---

## 5. Post-Layering Drafting Transition Message

**Problem:** After all NEW scenes were expanded and inserted, there was no handoff message to transition the writer into drafting mode.

**Solution:** When `insertLayeredScene` detects that all NEW scenes from the layering table are done (via `buildLayeringInsertNextCueSuffix` returning the "All NEW scenes..." message), it now:
1. Appends the full drafting transition message to the confirmation.
2. Sets `layeringComplete: true` on the Novel model.

**Drafting transition message includes:**
- Congratulations on completing the expanded outline
- Encouragement to start drafting
- Explanation of the Edit button for real-time scene updates
- Introduction of the Coach Scene button
- Reminder that the outline is a working blueprint

**Files changed:**
- `constants/oliviaUiMessages.js` — Added `OLIVIA_DRAFTING_TRANSITION_TEXT` constant and `OLIVIA_METADATA_KIND_DRAFTING_TRANSITION` metadata kind.
- `controllers/novelController.js` — `insertLayeredScene` detects the "all done" condition, delivers the transition message, and sets `layeringComplete: true`. Response includes `layeringComplete` flag.
- `olivia-editor.txt` — Added "Post-layering drafting transition" documentation in Phase 2.

---

## 6. Coach Scene Button (Office 3)

**Problem:** No way for the writer to get scene-specific coaching during drafting.

**Solution:** Added a "Coach Scene" button to each scene in the outline sidebar. It only appears after scene layering is complete (`layeringComplete === true`). When clicked, it opens the Olivia chat and auto-sends a coaching request for that specific scene.

**How it works:**
1. Writer clicks the Coach Scene icon (speech bubble) on a scene in the sidebar.
2. Frontend opens the Olivia chat modal and sends: `"Coach me on Act X, Scene Y — [title]"`.
3. Olivia's prompt recognizes this as a coaching trigger and delivers structured coaching: what the scene needs to accomplish, craft considerations, character interiority cues, pitfalls to avoid, and one concrete suggestion.
4. Control returns to the writer for follow-up questions or to move on.

**Files changed:**
- `storygroove-fe/src/Pages/BookEditor/OutlineSidebar.jsx` — Added `showCoachScene` and `onCoachScene` props. `TbMessageCircle` icon button renders before Rename/Delete when `showCoachScene` is true.
- `storygroove-fe/src/Pages/BookEditor/BookEditorPage.jsx` — Added `layeringComplete` derived from `bookData.layeringComplete`. Added `handleCoachScene` callback. Props passed to OutlineSidebar.
- `storygroove-fe/src/Pages/BookEditor/bookEditor.scss` — Added `.scene-action-btn--coach` styles (blue accent color).

---

## 7. Scene Coaching Mode in Prompt

**Problem:** The `olivia_editor` prompt had no instructions for handling scene coaching requests.

**Solution:** Added a full "SCENE COACHING MODE (Office 3)" section to the prompt with:
- Trigger: "Coach me on Act X, Scene Y — [title]"
- Behavior: Identify scene, deliver structured coaching, hand control back
- Anti-patterns: Don't deliver a full STEP-2 rich block, don't replace the chat, don't trap in a workflow

**Files changed:**
- `olivia-editor.txt` — Added Scene Coaching Mode section between Step 3 and Output Hygiene.
- `constants/oliviaUiMessages.js` — Added `Scene_coaching` section to `OLIVIA_EDITOR_LAYERING_RUNTIME_RULES`.

---

## 8. Novel Model — layeringComplete Flag

**Problem:** No way to track whether scene layering is finished for a novel.

**Solution:** Added `layeringComplete` boolean field (default `false`) to the Novel schema. Set to `true` when the drafting transition is delivered. Used by the frontend to gate Coach Scene button visibility.

**Files changed:**
- `models/novelModel.js` — Added `layeringComplete: { type: Boolean, default: false }`.

---

## 9. Prompt Sync to MongoDB

Both `olivia-editor.txt` and `olivia-scene.txt` were synced to MongoDB via `scripts/syncOliviaAgentPromptsFromRepo.mjs`:
- `olivia_scenes`: 22,171 characters
- `olivia_editor`: 21,148 characters

---

## All Files Modified

| File | What Changed |
|------|-------------|
| `constants/oliviaUiMessages.js` | Welcome split into preamble/postamble, after-table reminder rewritten, drafting transition added, runtime rules updated with Scene Purpose column + exploration cue + coaching mode |
| `controllers/novelController.js` | Dynamic welcome builder, drafting transition in `insertLayeredScene`, `layeringComplete` flag set on completion |
| `models/novelModel.js` | Added `layeringComplete` boolean field |
| `utils/oliviaLayeringParse.js` | 6-column table parser (backward compatible) |
| `storygroove-fe/.../oliviaLayeringParse.js` | Same parser update (frontend, kept in sync) |
| `storygroove-fe/.../OutlineSidebar.jsx` | Coach Scene button with `showCoachScene` / `onCoachScene` props |
| `storygroove-fe/.../BookEditorPage.jsx` | `layeringComplete` state, `handleCoachScene` handler, props to sidebar |
| `storygroove-fe/.../bookEditor.scss` | Coach button styles |
| `olivia-editor.txt` | Scene Purpose column, agentic cue, drafting transition phase, scene coaching mode section |
| `olivia-scene.txt` | Scene Purpose column in summary table format |
