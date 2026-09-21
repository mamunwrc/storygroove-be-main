# PromptTemplate — Seed Source

> Target collection: `PromptTemplate` (see plan §5 Phase 1.5).
> 15 entries, one per `sceneIndex` (1–15). Each entry combines:
> - **`template`** from v5_MP.pdf Prompts #3–#17 (the Prompt #N text with `[Protagonist]` placeholder),
> - **`coachingPrompt`** from v5_MP.pdf "Olivia's 15-Scene Novel Blueprint" (the per-scene coaching note),
> - **`subplotReminder`** from the same blueprint (the 🫖 reminder),
> - **`tentpoleHint`** when the scene is one of: `inciting_incident`, `first_reversal`, `midpoint`, `dark_night`, `climax`, `resolution`, else `null`.

**Act mapping** (per `act_scene_distribution` rule): Act 1 = scenes 1–5; Act 2 = scenes 6–10; Act 3 = scenes 11–15.

**`outputFormatLabels`** is identical for every scene (sourced from the Scene Output Format Spec rule). Stored on each row so the model can render the exact bulleted skeleton without resolving the methodology rule separately.

---

## scene_1

- key: `scene_1_intro_protagonist`
- sceneIndex: 1
- actNumber: 1
- title: Introduce Your Protagonist in Their Everyday World
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_3+blueprint_act1_1`
- enabled: true
- outputFormatLabels: `[Book Coaching for Scene, Genre-Specific Coaching Note (if applicable), Scene to Write, Setting, Significant Actions, Emotional Reactions, Subplot Tie-In, Character Arc Movement]`

**template:**

Describe a moment that introduces [Protagonist] and their current life. What does their everyday world look like? Focus on showing the broader setting, tone, and themes of the story. Highlight key visual or sensory details to give the reader a vivid snapshot of the protagonist's world before the main conflict begins. Begin with an interesting scene that will engage the reader immediately, using tension, curiosity, or a sense of foreboding to make the mundane feel compelling and irresistible, while staying true to the tone and conventions of the stated genre.

**coachingPrompt:**

Introduce Your Protagonist in Their Everyday World — but add tension, a vivid image, or a small mystery that makes us want to know more. Even a normal day should have cracks in the surface.

**subplotReminder:**

Hint at an unresolved emotional thread, relationship strain, or personal contradiction that will evolve in the background.

---

## scene_2

- key: `scene_2_personal_relationships`
- sceneIndex: 2
- actNumber: 1
- title: Explore Personal Relationships That Reveal Stakes
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_4+blueprint_act1_2`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Identify an unexpected event that disrupts [Protagonist's] normal life and serves as the inciting incident. What happens that creates a sense of urgency or high stakes, forcing [Protagonist] to take notice or reconsider their current path? Focus on crafting a compelling, high-stakes scene that grabs the reader's attention and clearly signals the beginning of the protagonist's journey.

> Note: v5_MP's Prompt #4 is labeled "inciting incident" in the template text, but the per-scene blueprint slots scene #2 as "Explore Personal Relationships" and scene #3 as the "Inciting Incident – The Disruption". The template-vs-blueprint mismatch is preserved here verbatim. Seed engineer: confirm with content team before commit. Recommendation: trust the blueprint headings (scenes 1, 2, 3, 4, 5 = Introduce / Relationships / Inciting / First Response / Resistance), then map Prompts #3 → scene 1, #4 → scene 3 (inciting), #5 → scene 2 (relationships), #6 → scene 4, #7 → scene 5. The PDF's prompt-to-scene-number alignment is ambiguous; the seed JSON authoring step is the place to lock it.

**coachingPrompt:**

Explore Personal Relationships That Reveal Stakes — use dialogue, conflict, or quiet moments to show who matters and what's simmering beneath the surface. A flashback or loaded exchange can hint at deeper threads.

**subplotReminder:**

Introduce a secondary emotional arc (romantic, familial, moral) that adds complexity to the character's identity.

---

## scene_3

- key: `scene_3_inciting_incident`
- sceneIndex: 3
- actNumber: 1
- title: Inciting Incident – The Disruption
- tentpoleHint: `inciting_incident`
- source: `v5_MP.pdf#prompt_5+blueprint_act1_3`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe a scene that explores [Protagonist's] personal life and relationships within their everyday world. How do they interact with key supporting characters? Highlight their goals, challenges, or conflicts that hint at the central stakes of the story.

> Note: same template-vs-blueprint mismatch flagged in scene_2 — engineer to confirm mapping. The blueprint heading for scene 3 IS "Inciting Incident", so `tentpoleHint: inciting_incident` stays. The `template` body may need to be swapped with Prompt #4's text when the JSON is authored.

**coachingPrompt:**

Inciting Incident – The Disruption — this is the moment the story breaks open. Something unexpected, irreversible, or disorienting pulls your protagonist out of their comfort zone.

**subplotReminder:**

(none in the blueprint for scene 3 — leave empty string)

---

## scene_4

- key: `scene_4_first_response`
- sceneIndex: 4
- actNumber: 1
- title: First Response – Emotional Fallout or Avoidance
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_6+blueprint_act1_4`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe a pivotal moment when [Protagonist] actively responds to the disruption caused by the inciting incident. How does this event push them toward a new challenge, opportunity, or decision that shifts their perspective? Focus on showing their emotional reaction, internal conflict, and the first step they take toward embracing or resisting their journey into the unknown.

**coachingPrompt:**

First Response – Emotional Fallout or Avoidance — show how your character reacts, not just in action, but in avoidance, denial, or overreaction. Let the emotions drive behavior.

**subplotReminder:**

How might this reaction deepen or create tension in a subplot character's goals, beliefs, or view of the protagonist?

---

## scene_5

- key: `scene_5_resistance`
- sceneIndex: 5
- actNumber: 1
- title: Resistance – Doubt, Delay, or Fear of Change
- tentpoleHint: `first_reversal`
- source: `v5_MP.pdf#prompt_7+blueprint_act1_5`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe a scene where [Protagonist] faces an internal struggle or hesitation after the Catalyst/inciting incident. What doubts, fears, or conflicting emotions hold them back from moving forward? Focus on showing their uncertainty and the tension between staying in their comfort zone or stepping into the unknown. Complicate the stakes further for the main character.

**coachingPrompt:**

Resistance – Doubt, Delay, or Fear of Change — make the internal hesitation external through behavior, decisions, or pushing people away.

**subplotReminder:**

Use a subplot character to mirror or challenge the protagonist's fear in a subtler, non-plot-driven way.

---

## scene_6

- key: `scene_6_enter_new_world`
- sceneIndex: 6
- actNumber: 2
- title: Decision to Move Forward – Entering the New World
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_8+blueprint_act2_6`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe the moment when [Protagonist] makes a clear decision to leave their old world behind and enter a new situation or journey. Focus on showing how this decision marks a significant turning point, propelling them into Act 2 and the main conflict.

**coachingPrompt:**

Decision to Move Forward – Entering the New World — let this feel momentous, even if quiet. It's a line crossed. This is an active choice. What motivates the decision? What does it cost? Let us feel the friction.

**subplotReminder:**

Is a supporting character cheering them on — or warning them?

---

## scene_7

- key: `scene_7_growth_clarity`
- sceneIndex: 7
- actNumber: 2
- title: A Moment of Growth, Clarity, or False Confidence
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_9+blueprint_act2_7`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Develop a scene where [Protagonist] has a pivotal moment of clarity, growth, or realization about themselves or their journey. This realization should challenge their beliefs, commitment, or resolve and either deepen their investment in the main conflict or raise new questions about their path forward.

**coachingPrompt:**

A Moment of Growth, Clarity, or False Confidence — they try something new, or pretend they've got it handled. Let them stretch, succeed, or stumble.

**subplotReminder:**

A subplot character might misread this moment or confront the protagonist from a different emotional lens. B story should deepen, challenge, or complicate things.

---

## scene_8

- key: `scene_8_premise_promise`
- sceneIndex: 8
- actNumber: 2
- title: Deliver the Premise – Let the Story's Big Idea Play Out
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_10+blueprint_act2_8`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Develop a scene that showcases the core essence of your story's premise. What does [Protagonist] experience in this new situation or journey? Focus on key actions, interactions, and lighter moments that highlight the excitement, challenges, or opportunities of this new world.

**coachingPrompt:**

Deliver the Premise – Let the Story's Big Idea Play Out — this is the "promise of the premise" scene. Let your genre shine, but plant tension beneath the surface.

**subplotReminder:**

How does the subplot quietly deepen or contrast the theme here?

---

## scene_9

- key: `scene_9_midpoint`
- sceneIndex: 9
- actNumber: 2
- title: The Midpoint – Truth, Shift, or Major Escalation
- tentpoleHint: `midpoint`
- source: `v5_MP.pdf#prompt_11+blueprint_act2_9`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Identify a key turning point in your story where [Protagonist] faces a significant event that changes the stakes. Is this a moment of false victory or false defeat? Describe how this pivotal event impacts their journey and shifts the direction of the story.

**coachingPrompt:**

The Midpoint – Truth, Shift, or Major Escalation — the story turns. A realization, reversal, or reveal changes everything.

**subplotReminder:**

Let the subplot hit a turning point too — new awareness, a reveal, or rising tension that mirrors the protagonist's own unraveling.

---

## scene_10

- key: `scene_10_fallout`
- sceneIndex: 10
- actNumber: 2
- title: Fallout & Complications – Pressure Builds
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_12+blueprint_act2_10`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

After the key turning point, tensions should escalate as [Protagonist] deals with the fallout of the key turning point. Describe a scene where [Protagonist] faces new complications or consequences from the events of the Key Turning Point. Focus on how these new challenges test their resolve and force them to take unexpected actions to keep moving forward.

**coachingPrompt:**

Fallout & Complications – Pressure Builds — let things unravel emotionally, relationally, practically. What's the cost of the midpoint?

**subplotReminder:**

Could a subplot character take surprising action? Can the subplot now escalate emotionally or thematically?

---

## scene_11

- key: `scene_11_mounting_pressure`
- sceneIndex: 11
- actNumber: 3
- title: Mounting Pressure – The Tension Tightens
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_13+blueprint_act3_11`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe scenes where internal or external pressures begin to tighten around [Protagonist]. How do these growing threats or doubts challenge their progress and increase the tension? Focus on showing the protagonist facing mounting obstacles.

**coachingPrompt:**

Mounting Pressure – The Tension Tightens — they're running out of time, space, or options. Make their internal and external conflicts collide.

**subplotReminder:**

Use the subplot to create contrast — stillness, vulnerability, or conflict the main plot can't show directly.

---

## scene_12

- key: `scene_12_low_point`
- sceneIndex: 12
- actNumber: 3
- title: The Low Point – Loss, Humiliation, or Collapse
- tentpoleHint: `dark_night`
- source: `v5_MP.pdf#prompt_14+blueprint_act3_12`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe the lowest point in your story for [Protagonist]. What external events or circumstances lead them to feel like all hope is lost or that they have failed? Focus on capturing the tangible losses, setbacks, or consequences that push [Protagonist] to the brink, creating a moment of despair or defeat.

**coachingPrompt:**

The Low Point – Loss, Humiliation, or Collapse — make this hit. It's not just what's lost; it's what feels irreparable.

**subplotReminder:**

Reflect that loss through a subplot fallout or misunderstanding. Let the subplot echo the failure or amplify the isolation.

---

## scene_13

- key: `scene_13_emotional_reckoning`
- sceneIndex: 13
- actNumber: 3
- title: Emotional Reckoning – They Face Themselves
- tentpoleHint: `null`
- source: `v5_MP.pdf#prompt_15+blueprint_act3_13`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe a scene where [Protagonist] reflects on their lowest point and confronts their deepest fears, doubts, or failures. How does this emotional moment help them rediscover their motivation or spark a glimmer of hope? Focus on showing their internal transformation as they decide to move forward despite the odds.

**coachingPrompt:**

Emotional Reckoning – They Face Themselves — let them break the lie or admit it's true. This is the pivot point. This is the cost of change.

**subplotReminder:**

Use a subplot character or dynamic to force clarity or offer perspective. This can be the emotional fulcrum.

---

## scene_14

- key: `scene_14_climax`
- sceneIndex: 14
- actNumber: 3
- title: Climax – Face the Conflict, Take the Risk
- tentpoleHint: `climax`
- source: `v5_MP.pdf#prompt_16+blueprint_act3_14`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe the climactic scene where [Protagonist] confronts the main conflict or antagonist. How do they put everything on the line to resolve it? Focus on showcasing their decisive actions, applying lessons learned throughout their journey, and the emotional stakes of this final showdown. Highlight the tension and stakes that make this moment unforgettable.

**coachingPrompt:**

Climax – Face the Conflict, Take the Risk — the final confrontation against the antagonist, the lie, the system, or the fear. Show growth through action. It's not just about winning; it's about becoming.

**subplotReminder:**

The subplot arc should collide with the climax — through aid, resistance, sacrifice, or resolution.

---

## scene_15

- key: `scene_15_closing_image`
- sceneIndex: 15
- actNumber: 3
- title: Closing Image – Reflect the Change
- tentpoleHint: `resolution`
- source: `v5_MP.pdf#prompt_17+blueprint_act3_15`
- enabled: true
- outputFormatLabels: same as scene_1

**template:**

Describe the closing scene that reflects how [Protagonist] or their world has changed after the climax. How does this moment tie back to the opening image, showing transformation, resolution, or the consequences of their journey? Focus on crafting a satisfying conclusion that resonates emotionally with the reader and leaves a lasting impression.

**coachingPrompt:**

Closing Image – Reflect the Change — call back to your opening. Show us how far we've come.

**subplotReminder:**

Has the subplot resolved, transformed, or remained beautifully unfinished? Let it reflect the emotional truth of your ending.

---

## Open question for JSON authoring (resolve before seed)

The v5_MP PDF presents Prompts #3–#17 in numbered order, AND it presents a parallel "Olivia's 15-Scene Novel Blueprint" with per-scene headings (Introduce Protagonist / Explore Relationships / Inciting Incident / First Response / Resistance / ...). For scenes 1–5 the two slightly disagree on which scene number gets "Inciting Incident":

- Prompt #4's body text uses the phrase "inciting incident" — would suggest scene 2.
- Blueprint heading "3. Inciting Incident – The Disruption" — puts it at scene 3.

This file follows the blueprint (scene 3 = inciting incident) because the `tentpole_scene_definition` rule from olivia-brain references "Inciting Incident" as a tentpole, and the blueprint headings are the authoritative scene structure. The seed JSON author should:

1. Confirm with the content team which mapping is canonical.
2. If the blueprint mapping wins (scene 3 = inciting), use the templates as currently mapped here.
3. If the prompt mapping wins (scene 2 = inciting), swap `template` between scene_2 and scene_3 rows and move `tentpoleHint: inciting_incident` from scene_3 to scene_2.

The rest of the scenes (6–15) align cleanly between Prompt # and Blueprint scene #.
