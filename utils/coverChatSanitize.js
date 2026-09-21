/**
 * Strip internal cover-pipeline content that must not appear in writer-facing chat.
 */

const INTERNAL_LEAK_PATTERNS = [
  /Prompt for render:[\s\S]*$/im,
  /Applying on (?:this|the) (?:first )?render:[\s\S]*$/im,
  /"imagePrompt"\s*:[\s\S]*$/m,
  /\bimagePrompt:\s*[\s\S]*$/im,
  /```json[\s\S]*?```/g,
];

export const stripCoverInternalLeaks = (text) => {
  let out = String(text || "").trim();
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    out = out.replace(pattern, "").trim();
  }
  return out;
};
