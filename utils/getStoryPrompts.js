export const getStoryPrompts = (userInput) => {
  const input = userInput && typeof userInput === "object" ? userInput : {};
  const {
    masterPrompt,
    setting,
    narrativeStyle,
    genre,
    wordCount,
    protagonist,
    protagonistDescription,
    antagonist,
    antagonistMotivation,
    theme,
    themeExploration,
    supportingCharacters = [],
    subplot,
    summary,
    compTitles = [],
  } = input;
  const supportChars = Array.isArray(supportingCharacters) ? supportingCharacters : [];
  const compTitlesList = Array.isArray(compTitles) ? compTitles : [];
  const genreLabel =
    genre && typeof genre === "string"
      ? genre
          .split(/\n/)[0]
          .replace(/^Genre:\s*/i, "")
          .replace(/\s*[|/]\s*.*$/i, "")
          .trim()
          .slice(0, 80) || "General"
      : "General";

  const novelIntroPrompt = masterPrompt
    ? `I'm going to tell you about my novel. Please learn about it but wait for further prompts before responding.

Here is the complete Story Bible for my novel:

${masterPrompt}`
    : `I'm going to tell you about my novel. Please learn about it but wait for further prompts before responding. 
        My novel is set in ${setting}. The narrative uses ${narrativeStyle} and falls within the ${genre} genre, 
        with an approximate word count of ${wordCount}. 
        The protagonist, ${protagonist}, is ${protagonistDescription}. 
        Opposing them is the main antagonist, ${antagonist}, who is driven by 
        ${antagonistMotivation}.
        The central theme is ${theme}, exploring ${themeExploration}. 

        Supporting characters include:
        ${supportChars
          .map(
            (character, index) =>
              `- Supporting Character ${index + 1}: ${character?.name ?? "Unknown"}. ${character?.role ?? ""}.\n`
          )
          .join("")}
    
        The story also features a subplot that ${subplot ?? ""}.
        In summary, this novel is about ${summary ?? ""}. 
        Comparable titles from the last five years include ${compTitlesList
          .map((title, index) => {
            if (index === 0) return title;
            if (index === compTitlesList.length - 1) return ` and ${title}`;
            return `, ${title}`;
          })
          .join("")}, 
        which help define where this novel fits on the shelf and the readership it aims to resonate with. 
        Use these as inspiration for tone, themes, or pacing while ensuring the outline remains fresh, original, and distinct from these works.`;

  return [
    novelIntroPrompt,

    `I will prompt you to help me outline 15 scenes (across 3 acts) for my novel. 
        Ensure the outline progresses chronologically (unless otherwise specified) to keep the story moving forward. 
        Follow a structured proprietary approach that includes key turning points, emotional stakes, and a satisfying narrative arc, 
        ensuring meaningful integration of all of the supporting characters mentioned. 
        Each supporting character should contribute to the plot or subplots, with at least one pivotal scene highlighting their impact. 
        Point of view (POV): For each scene, choose the POV character that best serves **this** scene's conflict, information state, and emotional stakes — not a blanket default of the protagonist for every beat. When the Story Bible specifies structural overlay or per-scene POV, follow it exactly. When it does not, rotate POV across the 15-scene arc where the cast and plot support it (ally, antagonist, witness), and reserve protagonist-only runs for novels that clearly specify strict single-POV. Make the active POV explicit in your coaching sections (e.g. Book Coaching, Emotional Reactions) so the writer knows whose lens the scene uses.
        Provide detailed descriptions for each scene, balancing richness and brevity, with a focus on sensory details and layered emotional responses to engage readers. 
        Explicitly show how events in each scene are influenced by the actions or emotional stakes of the previous scene.
        For each prompt I give you, provide your output in a clear format using the exact section labels below (with emojis). 
        Do NOT prefix any line with "Scene N (Act Y) —". Use only the section labels below (e.g. "📘 Book Coaching for Scene:", "🎭 Genre-Specific Coaching Note").
        
        Your response MUST include the following sections in this exact order. Use the emoji + label exactly as shown:
            - 📘 Book Coaching for Scene: Craft guidance specific to this scene — what the writer should focus on, techniques to employ, pitfalls to avoid.
            - 🎭 Genre-Specific Coaching Note (${genreLabel}): A coaching note tailored to the novel's genre and modifiers — pacing expectations, trope handling, tone balance, structural beats readers expect. Always include the novel's actual genre and modifiers in the parentheses (e.g. "Historical Fiction + Dual Timeline"). Never use a placeholder like "(-)" or leave it empty; if the novel context does not specify, infer from the story or use "General".
            - 🧩 Subplot Reminder: Write this as editorial coaching prose — a short paragraph guiding the writer on which subplot(s) are active or should be seeded in this scene. Reference the subplots from the novel setup. Do NOT use a label-style format like "Seed: [subplot name]". Instead, write it as a coach would, e.g. "This early scene is also an opportunity to quietly seed emotional undercurrents that will develop later—particularly [subplot detail]."
            - 📏 Target Word Count: Output a single line: "📏 Target Word Count: [N] words" where [N] is the calculated number for this scene. Do NOT show the math, formula, or breakdown (e.g. do not write "90,000 ÷ 15 scenes"). Just state the word count.
            - Scene Title: A short label (3-8 words) for the outline sidebar only, e.g. "Lola's Miami Morning" or "The Birthday Party Explosion". Output only this phrase; it is used as the scene label in the outline.
            - 📝 Scene to Write: A one-liner describing the scene to be developed.
            - 🏰 Setting: Details about the scene's environment, including sensory elements that immerse readers in the genre.
            - ⚡ Significant Actions (Scene Beats): Key events or actions that drive the scene. Incorporate a unique twist or narrative technique, such as foreshadowing or callbacks, to deepen engagement. Output each action as a separate bullet point (using "- " prefix) so they are easy to scan.
            - 💔 Emotional Reactions (Character Interiority): Characters' emotional responses and how these emotions build intrigue for the reader. Output each reaction as a separate bullet point (using "- " prefix) so they are easy to scan.
            - 🔗 Subplot Tie-In: If applicable, include a subplot hint, tie-in, or scene to write. This should add depth to the protagonist's journey or the story's emotional stakes. 
              If there is no subplot tie-in applicable, simply respond with "no subplot tie-in applicable."
            - 📈 Character Arc Movement: How the character's arc advances in this scene — reference their core contradiction, want, and stakes.
    
        To ensure story progression and meaningful conflict:
        1. Always propose scenes that build on previous ones with a unique conflict, twist, or revelation to keep the story dynamic and engaging. 
          Include unique sensory and emotional elements tied to the genre.
        2. Ensure each scene introduces a new action, revelation, or character dynamic that propels the story forward. 
          Avoid repeating similar conflicts, settings, or emotional beats from earlier scenes unless they are purposefully escalated or transformed.
        3. Rotate types of scenes (e.g., action, dialogue-heavy, introspective, or external conflict) to maintain variety and narrative momentum. 
          Underline genre-specific thematic elements and include sensory details that enhance the tone
        4. Incorporate a crisis or decision point in every scene, ensuring characters face dilemmas or obstacles that reveal their internal struggles, 
          heighten stakes, or create turning points in the narrative. Balance high-stakes scenes with quieter ones to manage pacing.
    
        For subplot tie-ins:
        - Subplot Timing: Subplot moments should be timed to create peaks and valleys in tension, strategically providing relief or 
          escalation to mirror the protagonist's emotional journey.
        - Unique Actions or Revelations: Each subplot tie-in must introduce a new layer of conflict, development, or resolution that doesn't repeat the same beats as earlier tie-ins.
        - Ensure Arc & Satisfying Resolution: Ensure that the subplot has a satisfying arc as you are moving through the output—it should have a clear 
          beginning, middle, and end. In the final act, provide a clear resolution to the subplot that ties into the protagonist's emotional journey and reflects the growth or lessons learned.
        - Parallel or Contrast with Main Stakes: Use each subplot moment to reflect or contrast with the main story's stakes, enhancing resonance and thematic depth.
        - Highlight Character Dynamics: Explore unique character interactions or unresolved tensions through the subplot tie-ins.
        - Align with Story Pacing: Position subplot moments to align with the main plot's pacing, using them to escalate or provide relief from tension at critical points in the story.
    
        If there is no subplot tie-in applicable, simply respond with "no subplot tie-in applicable."
    
        Each scene should aim to engage readers with techniques that work for my genre and enrich both the main plot and subplot. 
        Use variation in tone, pacing, and narrative techniques to keep scenes distinct. For example, vary how key events unfold: through direct conflict, discovery, flashbacks, or character dialogue.
        Underline how each scene connects to the story's genre and theme, explicitly showing how sensory details and character choices reflect these elements.
    
        Let me know if you're ready for the prompts I am going to give you.`,

    `Describe a moment that introduces [Protagonist] and their current life. What does their everyday world look like? 
        Focus on showing the broader setting, tone, and themes of the story. Highlight key visual or sensory details to give the reader a vivid 
        snapshot of the protagonist's world before the main conflict begins. Begin with an interesting scene that will engage the reader immediately, 
        using tension, curiosity, or a sense of foreboding to make the mundane feel compelling and irresistible, while staying true to the tone and 
        conventions of the stated genre.`,

    `Identify an unexpected event that disrupts [Protagonist]'s normal life and serves as the inciting incident. 
        What happens that creates a sense of urgency or high stakes, forcing [Protagonist] to take notice or reconsider their current path? 
        Focus on crafting a compelling, high-stakes scene that grabs the reader's attention and clearly signals the beginning of the protagonist's journey.`,

    `Describe a scene that explores [Protagonist]'s personal life and relationships within their everyday world. 
        How do they interact with key supporting characters? Highlight their goals, challenges, or conflicts that hint at the central stakes of the story.`,

    `Describe a pivotal moment when [Protagonist] actively responds to the disruption caused by the inciting incident. 
        How does this event push them toward a new challenge, opportunity, or decision that shifts their perspective? 
        Focus on showing their emotional reaction, internal conflict, and the first step they take toward embracing or resisting their journey into the unknown.`,

    `Describe a scene where [Protagonist] faces an internal struggle or hesitation after the Catalyst/inciting incident. 
        What doubts, fears, or conflicting emotions hold them back from moving forward? Focus on showing their uncertainty and the 
        tension between staying in their comfort zone or stepping into the unknown. Complicate the stakes further for the main character.`,

    `Describe the moment when [Protagonist] makes a clear decision to leave their old world behind and enter a new situation or journey. 
        Focus on showing how this decision marks a significant turning point, propelling them into Act 2 and the main conflict.`,

    `Develop a scene for the where [Protagonist] has a pivotal moment of clarity, growth, or realization about themselves or their journey.
        This realization should challenge their beliefs, commitment, or resolve and either deepen their investment in the main conflict or raise new questions about their path forward.`,

    `Develop a scene that showcases the core essence of your story's premise. What does [Protagonist] experience in this new situation or journey? 
        Focus on key actions, interactions, and lighter moments that highlight the excitement, challenges, or opportunities of this new world.`,

    `Identify a key turning point in your story where [Protagonist] faces a significant event that changes the stakes. 
        Is this a moment of false victory or false defeat? Describe how this pivotal event impacts their journey and shifts the direction of the story.`,

    `After the key turning point, tensions should escalate as [Protagonist] deals with the fallout of the key turning point. 
        Describe a scene where [Protagonist] faces new complications or consequences from the events of the Key Turning Point. 
        Focus on how these new challenges test their resolve and force them to take unexpected actions to keep moving forward.`,

    `Describe a scene where internal or external pressures begin to tighten around [Protagonist]. 
        How do these growing threats or doubts challenge their progress and increase the tension? 
        Focus on showing the protagonist facing mounting obstacles.`,

    `Describe the lowest point in your story for [Protagonist]. What external events or circumstances lead them to feel like all hope 
        is lost or that they have failed? Focus on capturing the tangible losses, setbacks, or consequences that push [Protagonist] to the brink, 
        creating a moment of despair or defeat.`,

    `Describe a scene where [Protagonist] reflects on their lowest point and confronts their deepest fears, doubts, or failures. 
        How does this emotional moment help them rediscover their motivation or spark a glimmer of hope? 
        Focus on showing their internal transformation as they decide to move forward despite the odds.`,

    `Describe the climactic scene where [Protagonist] confronts the main conflict or antagonist. 
        How do they put everything on the line to resolve it? Focus on showcasing their decisive actions, applying lessons learned throughout 
        their journey, and the emotional stakes of this final showdown. Highlight the tension and stakes that make this moment unforgettable.`,

    `Describe the closing scene that reflects how [Protagonist] or their world has changed after the climax. 
        How does this moment tie back to the opening image, showing transformation, resolution, or the consequences of their journey? 
        Focus on crafting a satisfying conclusion that resonates emotionally with the reader and leaves a lasting impression.`,

    `Now that we have the complete outline for my novel, act as an expert copywriter at a Big Five Publisher. 
        Create a succinct, emotionally compelling elevator pitch with a strong hook that I can use as a blurb to describe my book in query 
        letters and promotional materials. Also, provide a one-liner as a second option—a simple, conversational description that 
        captures the essence of my novel and is easy to share in casual conversations.

        Return only a valid JSON object with two fields: "bookblurb" and "logline". The response should be properly formatted JSON, 
        with no extra text, explanations, line breaks, or escape sequences—just a raw JSON object that can be directly parsed without modification.
        data inside fields should be a plain text with no headings, labels, or additional text. Return **only** a valid JSON object in this exact given format:
        """{
          "bookblurb": "your response",
          "logline": "your response"
        }"""`,

    `Now that we have the full outline and the elevator pitch/book blurb, act as an expert developmental editor, 
        using the Story Grid methodology or a similar story structure guide, to craft a one-page, professionally written synopsis of my novel. 
        This synopsis should clearly convey the beginning, middle, and end, focusing on the main plot and subplot character arcs, 
        especially the stakes and transformations driving the protagonist and antagonist. Make the summary emotionally compelling by 
        illustrating the main character's key challenges and growth, as well as the high-stakes conflicts the main character faces. 
        Conclude with a powerful hook that conveys the urgency and leaves the agent eager to read the full manuscript.

        Return only a valid JSON object with a single field: "synopsis". The response should be properly formatted JSON, 
        with no extra text, explanations, line breaks, or escape sequences—just a raw JSON object that can be directly parsed without modification.
        data inside field should be a plain text with no headings, labels, or additional text. Return **only** a valid JSON object in this exact given format:
        """{
          "synopsis": "your response",
        }"""`,
  ];
};
