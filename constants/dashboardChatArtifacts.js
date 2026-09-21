/**
 * Detect large dashboard Olivia deliverables that must stay pinned across
 * cold-start / chain-reset turns (Story Bible, character dossiers).
 * Mirrors FE `isOliviaCopyEligible` in AIAgentChatPage.jsx.
 */
export const isDashboardStoryBibleArtifact = (text) => {
  const t = String(text || "");
  return (
    t.includes("📘 Story Bible") ||
    t.includes("📘 StoryGroove.ai™ Master Prompt for Novel Architecture") ||
    t.includes("👤 CHARACTER DOSSIERS — 17-Point Dossiers") ||
    t.includes("**📘 Story Bible") ||
    t.includes("**📘 StoryGroove.ai™ Master Prompt for Novel Architecture") ||
    t.includes("**👤 CHARACTER DOSSIERS — 17-Point Dossiers")
  );
};

/** Metadata kind stored on assistant Message rows for cold-start pinning. */
export const DASHBOARD_ARTIFACT_KIND_STORY_BIBLE = "story_bible";
