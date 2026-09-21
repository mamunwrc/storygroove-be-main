export const getCharacterPrompts = (userInput) => {
  const {
    archetype,
    role,
    name,
    age,
    gender,
    occupation,
    ethnicity,
    appearance,
    style,
    traits,
  } = userInput;

  return [
    `Act as a character development expert. Create a detailed profile for my character, focusing on both unique and archetypal qualities. 
    Use the template I will give you and the guidance I provided for Archetype & Role, Basic Information, and Physical Description as 
    a guide to fill out the rest of the profile for me. You should replace all the placeholders with specific details starting with Personality 
    Traits and finishing at Test Scenario.  The profile should feel realistic and emotionally resonant. 
    Wait until I give you the Character Profile Template before you create the profile for me. I will give it to you shortly. Respond with got it.`,

    `
    1. Archetype and Role:
        - Archetype: ${archetype}
        - Role in the Story: ${role}
    2. Basic Information:
        - Name: ${name}
        - Age: ${age}
        - Gender: ${gender}
        - Occupation: ${occupation}
        - Nationality/Ethnicity: ${ethnicity}
    3. Physical Description:
        - Appearance: ${appearance}
        - Style: ${style}
        - Notable Traits: ${traits}
    4. Personality and Traits:
        - Core Traits: [E.g., ambitious, compassionate, guarded]
        - Likes and Dislikes: [What brings them joy, what they avoid]
        - Mannerisms and Habits: [E.g., taps fingers when anxious, laughs loudly]
        - Fears and Insecurities: [Biggest fears and what makes them vulnerable]
        - Stress Reactions: [How they respond under pressure]
        - Triggers and Guilty Pleasures: [What sets them off, and secret enjoyments]
    5. Speech and Voice:
        - Style of Speech: [Formal, casual, sarcastic, etc.]
        - Common Phrases: [Signature phrases, curses, or verbal habits]
    6. Background and Upbringing:
        - Family Background: [Relationships, upbringing, social class]
        - Key Events: [Defining moments from their past]
        - Education Level: [Highest level of education or training]
    7. Skills and Weaknesses:
        - Special Abilities: [Unique skills, talents, or knowledge]
        - Weaknesses: [Flaws or areas of vulnerability]
    8. Relationships:
        - Family Dynamics: [Relationship with family members]
        - Romantic Relationships: [Current or past romantic involvements]
        - Friends and Enemies: [Close friends, rivals, or enemies]
    9. Internal Conflicts:
        - Moral Dilemmas: [Key ethical challenges they face]
        - Inner Struggles: [Internal conflicts or contradictions]
    10. External Conflicts:
        - Character Conflicts: [Tensions with other characters]
        - Environmental Obstacles: [Societal or external challenges they encounter]
    11. Goals and Motivations:
        - Short-Term Goals: [Immediate aspirations within the story]
        - Long-Term Goals: [Their ultimate ambitions or dreams]
        - Motivations: [What drives them forward in the story]
    12. Secrets and Lies:
        - Personal Secrets: [What they hide from others]
        - Self-Deceptions: [The lie they tell themselves]
    13. Influences:
        - Who or What Influences Them: [People, beliefs, or events that shape their choices]
    14. Unique Possessions:
        - Important Belongings: [Items in their bag, car, or home that reveal their personality]
    15. Romantic History:
        - Romantic Background: [Key details about past relationships or romantic experiences]
    16. Regrets:
        - Biggest Regret: [What they most wish they had done differently]
    17. Test Scenario:
        - Moral Test: What would [Character's Name] do if they witnessed a crime in public? Describe their likely reaction.
    `,
  ];
};
