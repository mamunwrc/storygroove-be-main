const ENHANCEMENT_SYSTEM = `You expand short image generation prompts into detailed, model-friendly descriptions.

Rules:
- Preserve the user's core subject and intent
- Add cinematic lighting, composition, texture, and atmosphere when appropriate
- Keep it one paragraph, under 400 words
- Do not add unrelated subjects or change the genre unless implied
- Do not include markdown, bullet lists, or meta commentary
- Return only the enhanced prompt text`;

export async function enhanceImagePrompt(
  openai,
  userPrompt,
  { enabled = true, model = "gpt-4.1-mini" } = {}
) {
  const original = String(userPrompt || "").trim();
  if (!enabled || !original) {
    return { original, enhanced: null, promptSent: original };
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: ENHANCEMENT_SYSTEM },
        { role: "user", content: original },
      ],
    });
    const enhanced = response.choices?.[0]?.message?.content?.trim() || null;
    return {
      original,
      enhanced,
      promptSent: enhanced || original,
    };
  } catch (err) {
    console.error("Prompt enhancement failed, using original:", err.message);
    return { original, enhanced: null, promptSent: original };
  }
}

/**
 * Build a preservation-focused prompt for masked (inpainting) edits.
 *
 * GPT Image masks are soft, prompt-guided guides, not pixel-strict selections.
 * A bare delta instruction ("remove the girl boss pillow") makes the model
 * regenerate globally and alter unmasked content. Wrapping the instruction with
 * explicit preservation guidance keeps changes localized to the selected region.
 */
export function buildMaskedEditPrompt(userInstruction) {
  const instruction = String(userInstruction || "").trim();
  return [
    `Edit ONLY the selected (masked) region of the provided image.`,
    `Change to make inside the selected region: ${instruction}.`,
    `Everything outside the selected region must stay exactly the same as the original image:`,
    `keep the identical subjects, faces, poses, text, objects, colors, textures, lighting, framing, and background.`,
    `Do not add, move, restyle, recolor, or remove anything outside the selected region.`,
    `Blend the edited area seamlessly with the untouched surroundings so the result looks like the original photo with only the selected area changed.`,
  ].join(" ");
}

/**
 * Wrap a cover edit instruction with locked title/author metadata so full-image
 * edits do not hallucinate a different book.
 */
export function buildCoverEditPromptWithMetadata(
  userInstruction,
  { displayTitle, authorName } = {}
) {
  const instruction = String(userInstruction || "").trim();
  const title = String(displayTitle || "").trim();
  const author = String(authorName || "").trim();

  const locks = [];
  if (title) {
    locks.push(
      `The book title on the cover must remain exactly "${title}" unless the instruction explicitly changes the title.`
    );
  }
  if (author) {
    locks.push(
      `The author name on the cover must remain exactly "${author}" unless the instruction explicitly changes the author name.`
    );
  }
  const lockBlock =
    locks.length > 0
      ? `${locks.join(" ")} Preserve genre positioning and overall cover identity.`
      : "Preserve the existing book title, author name, and genre positioning on the cover unless the instruction explicitly changes them.";

  return `${lockBlock}\n\nRequested change: ${instruction}`;
}
