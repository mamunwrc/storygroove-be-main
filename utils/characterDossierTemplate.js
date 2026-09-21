/**
 * Seeded 17-point dossier markdown for manually added characters.
 * Matches Olivia's canonical format in olivia.txt so the Characters tab
 * editor and parser treat manual dossiers like generated ones.
 */

export const MANUAL_CHARACTER_TYPES = [
  "protagonist",
  "antagonist",
  "supporting character",
];

const CAST_TYPE_LABEL = {
  protagonist: "Protagonist",
  antagonist: "Antagonist",
  "supporting character": "Supporting character",
};

export const normalizeManualCharacterType = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "protagonist") return "protagonist";
  if (raw === "antagonist") return "antagonist";
  if (
    raw === "supporting" ||
    raw === "supporting character" ||
    raw === "supporting_character"
  ) {
    return "supporting character";
  }
  return "supporting character";
};

export const castTypeAccordionLabel = (characterType) =>
  CAST_TYPE_LABEL[normalizeManualCharacterType(characterType)] ||
  "Supporting character";

const roleInStoryLine = (characterType, roleInStory) => {
  const typeLabel = castTypeAccordionLabel(characterType);
  const extra = String(roleInStory || "").trim();
  if (!extra) return typeLabel;
  if (/^(protagonist|antagonist|supporting)\b/i.test(extra)) return extra;
  return `${typeLabel} — ${extra}`;
};

/**
 * @param {{ name: string, roleInStory?: string, characterType?: string }} opts
 * @returns {string}
 */
export const buildManualCharacterDossierTemplate = ({
  name,
  roleInStory = "",
  characterType = "supporting character",
} = {}) => {
  const displayName = String(name || "").trim() || "Unnamed Character";
  const type = normalizeManualCharacterType(characterType);
  const roleLine = roleInStoryLine(type, roleInStory);

  return [
    `**👤 ${displayName}: 17-Point Dossier**`,
    "",
    "1. 🧬 Archetype and Role",
    "   • Archetype: [e.g. The Mentor, The Truth-Seeker]",
    `   • Role in the Story: ${roleLine}`,
    "2. 📋 Basic Information",
    `   • Name: ${displayName}`,
    "   • Age:",
    "   • Gender: [Female, Male, or Non-binary only]",
    "   • Occupation:",
    "   • Cultural Identity & Background: [ethnicity, nationality, regional upbringing, or multi-heritage if relevant]",
    "   • How do they support or complicate the main character?",
    "3. 👤 Physical Description",
    "   • Appearance: [height, build, posture, distinctive features]",
    "   • Style: [clothes, accessories, grooming — what their style says about them]",
    "   • Notable Traits: [close-up details, fidgeting habits, memorable physical quirks]",
    "4. 🧠 Personality and Traits",
    "   • Core Traits: [e.g. ambitious, compassionate, guarded]",
    "   • Likes and Dislikes:",
    "   • Mannerisms and Habits:",
    "   • Fears and Insecurities:",
    "   • Stress Reactions:",
    "   • Triggers and Guilty Pleasures:",
    "5. 🗣 Speech and Voice",
    "   • Style of Speech: [formal, casual, sarcastic, etc.]",
    "   • Common Phrases: [3–5 signature phrases, verbal habits, or expressions]",
    "6. 🏡 Background and Upbringing",
    "   • Family Background:",
    "   • Key Events: [defining moments from their past]",
    "   • Education Level:",
    "7. 🛠 Skills and Weaknesses",
    "   • Special Abilities: [unique skills, talents, or knowledge]",
    "   • Weaknesses: [flaws or areas of vulnerability]",
    "8. 🤝 Relationships",
    "   • Family Dynamics:",
    "   • Romantic Relationships:",
    "   • Friends and Enemies:",
    "9. 💔 Internal Conflicts",
    "   • Moral Dilemmas:",
    "   • Inner Struggles:",
    "   • Core Wound: [the deep scar from childhood or formative relationships that still shapes their sense of worth or belonging]",
    "10. ⚔ External Conflicts",
    "    • Character Conflicts: [tensions with other characters]",
    "    • Environmental Obstacles: [societal or external challenges]",
    "11. 🎯 Wants & Stakes (Story Engine)",
    "    • What They Want Most: [conscious goal — external or internal]",
    "    • What's at Stake (Worst Thing if They Don't Get It): [consequence of failure]",
    "    • Core Conflict / Contradiction: [1–2 sentences linking the Want with an obstacle, fear, or contradiction]",
    "12. 🧭 Goals and Motivations",
    "    • Short-Term Goals:",
    "    • Long-Term Goals:",
    "    • Motivations:",
    "13. 🔐 Secrets and Lies",
    "    • Personal Secrets: [what they hide from others]",
    "    • Self-Deceptions: [the lie they tell themselves]",
    "14. 🌱 Influences",
    "    • Who or What Influences Them: [people, beliefs, or events that shape their choices]",
    "15. 🎒 Unique Possessions",
    "    • Important Belongings: [items that reveal personality — in their bag, car, or home]",
    "16. ⏳ Regrets",
    "    • Biggest Regret: [what they most wish they had done differently]",
    "17. 🚀 Potential for Growth Beyond This Story",
    "    • [How this character could evolve if carried into future books]",
    "📖 Summary Note of Character",
    "[4–6 sentence narrative distillation capturing the character's essence, driving wound, and arc potential. Highlight how internal and external conflicts intersect. Gesture at possible growth across the story or series. Avoid repetition of earlier bullet points — this is a narrative synthesis a story editor would keep on hand.]",
  ].join("\n");
};
