import Message from "../models/messageModel.js";
import { OLIVIA_METADATA_KIND_COACHING_GATE } from "../constants/oliviaUiMessages.js";

export const COACH_SCENE_MESSAGE_PATTERN = /^Coach me on Act\s/i;

export const COACHING_INTENT = {
  COACH_SCENE: "coach_scene",
  FOLLOW_UP: "follow_up",
  FULL_COACHING_PASS: "full_coaching_pass",
  BRAINSTORM: "brainstorm",
  REVISION_REVIEW: "revision_review",
};

// Gate option numbering (matches the displayed script in olivia-coaching.txt):
//   1) complete -> full coaching pass
//   2) already revised -> compare to previous draft (revision review)
//   3) still drafting / stuck -> brainstorm
const GATE_FULL_PASS_PATTERN =
  /\b(full coaching pass|option\s*1|option\s*one|#?1\b|ready for a full pass|treating.*complete|chapter is complete|scene is complete|yes[,.]?\s*(it'?s\s+)?complete|completed|done with (?:this|the) (?:chapter|scene))\b/i;

const GATE_REVISION_PATTERN =
  /\b(already revised|compare (?:it|my|the|this)|revision review|made the changes|another look|option\s*2|option\s*two|#?2\b|take another look at my revision)\b/i;

const GATE_BRAINSTORM_PATTERN =
  /\b(still drafting|not complete|not done|feeling stuck|brainstorm|option\s*3|option\s*three|#?3\b|work through an idea)\b/i;

const EXPLICIT_GATE_INTENTS = new Set([
  COACHING_INTENT.FULL_COACHING_PASS,
  COACHING_INTENT.BRAINSTORM,
  COACHING_INTENT.REVISION_REVIEW,
]);

/**
 * Whether this turn is starting a Coach Scene flow (button or equivalent message).
 */
export const isCoachSceneTrigger = ({ coachingIntent, message } = {}) => {
  if (coachingIntent === COACHING_INTENT.COACH_SCENE) return true;
  const text = typeof message === "string" ? message.trim() : "";
  return COACH_SCENE_MESSAGE_PATTERN.test(text);
};

/**
 * True when the completion gate was already shown for this scene on this thread.
 */
export const hasCoachingGateAskedForScene = async (threadId, sceneId) => {
  if (!threadId || sceneId == null || sceneId === "") return false;
  const found = await Message.exists({
    threadId,
    role: "assistant",
    "metadata.coachingGatePendingForSceneId": String(sceneId),
  });
  return Boolean(found);
};

/**
 * Latest coaching gate assistant message for a scene on this thread.
 */
export const findPendingCoachingGateForScene = async (threadId, sceneId) => {
  if (!threadId || sceneId == null || sceneId === "") return null;
  const doc = await Message.findOne({
    threadId,
    role: "assistant",
    "metadata.kind": OLIVIA_METADATA_KIND_COACHING_GATE,
    "metadata.coachingGatePendingForSceneId": String(sceneId),
  })
    .sort({ timestamp: -1 })
    .lean();
  return doc || null;
};

/**
 * True when the writer is replying to the scene completion gate — the most
 * recent assistant message on the thread must be that gate for this scene.
 */
export const isGateFollowUpTurn = async ({ threadId, sceneId } = {}) => {
  if (!threadId || sceneId == null || sceneId === "") return false;
  const lastAssistant = await Message.findOne({
    threadId,
    role: "assistant",
  })
    .sort({ timestamp: -1 })
    .lean();
  if (!lastAssistant) return false;
  if (lastAssistant.metadata?.kind !== OLIVIA_METADATA_KIND_COACHING_GATE) {
    return false;
  }
  return (
    String(lastAssistant.metadata?.coachingGatePendingForSceneId || "") ===
    String(sceneId)
  );
};

/**
 * Classify a gate follow-up reply (quick-reply intent or typed text).
 * @returns {string|null} COACHING_INTENT value or null if ambiguous
 */
export const parseGateFollowUpOption = (message = "", explicitIntent = "") => {
  const intent = String(explicitIntent || "").trim();
  if (EXPLICIT_GATE_INTENTS.has(intent)) return intent;

  const text = String(message || "").trim();
  if (!text) return null;

  // Revision check before full pass — "already revised" must not match "complete"-style
  // wording on the full-pass path.
  if (GATE_REVISION_PATTERN.test(text)) {
    return COACHING_INTENT.REVISION_REVIEW;
  }
  if (GATE_FULL_PASS_PATTERN.test(text)) {
    return COACHING_INTENT.FULL_COACHING_PASS;
  }
  if (GATE_BRAINSTORM_PATTERN.test(text)) {
    return COACHING_INTENT.BRAINSTORM;
  }
  return null;
};

/**
 * Resolve gate follow-up intent when the current turn answers the completion gate.
 * @returns {Promise<string|null>}
 */
export const resolveGateFollowUpIntent = async ({
  threadId,
  sceneId,
  message = "",
  coachingIntent = "",
} = {}) => {
  const isGateReply = await isGateFollowUpTurn({ threadId, sceneId });
  if (!isGateReply) return null;
  return parseGateFollowUpOption(message, coachingIntent);
};

/**
 * Canonical conversational close for brainstorm / follow-up coaching turns
 * (verbatim in substance from olivia-coaching.txt). The backend appends this
 * so the "no branching offers" rule is enforced deterministically rather than
 * relying on the model to comply every turn.
 */
export const COACHING_CONVERSATIONAL_CTA =
  "👉 Let me know if this makes sense, or if you have questions, want to discuss, or dig deeper. You are the writer, so bring me your questions, pushback, or instincts.";

// Trailing "branching offer" lines that send writers down a rabbit hole. We
// only ever strip these from the END of a reply, so mid-reply prose is safe.
const BRANCHING_OFFER_PATTERNS = [
  /^\s*(if you('?d| would)? (like|want)|if you want)\b/i,
  /\bI can (sketch|draft|outline|write|build|map|break\s+.*down|show you|help you (shape|build|draft|map))\b/i,
  /\bwould you like me to\b/i,
  /\b(three|a few|several)\s+versions\b/i,
  /\blet me know if you('?d| would)? like (me )?to (explore|see|try|sketch|draft)\b/i,
];

const isBlankLine = (line) => /^\s*$/.test(line);
const isSeparatorLine = (line) => /^\s*-{3,}\s*$/.test(line);
const isExistingCtaLine = (line) => /^\s*👉/.test(line);
const isBranchingOfferLine = (line) =>
  BRANCHING_OFFER_PATTERNS.some((re) => re.test(line));

/**
 * Strip trailing branching-offer sentences and any existing CTA from a
 * conversational/brainstorm coaching reply, then append the canonical CTA.
 *
 * Trailing-only and conservative: if stripping would remove all content, the
 * original text is returned unchanged. Idempotent.
 *
 * @param {string} text
 * @returns {string}
 */
export const sanitizeCoachingConversationalClose = (text) => {
  if (typeof text !== "string" || !text.trim()) return text;

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (
      isBlankLine(last) ||
      isSeparatorLine(last) ||
      isExistingCtaLine(last) ||
      isBranchingOfferLine(last)
    ) {
      lines.pop();
      continue;
    }
    break;
  }

  const body = lines.join("\n").trimEnd();

  // Safety: never strip the entire reply away.
  if (!body.trim()) return text.trim();

  return `${body}\n\n${COACHING_CONVERSATIONAL_CTA}`;
};

const GATE_SECTION_MARKER = "## SCENE COMPLETION GATE";

/**
 * Gate question text from the olivia_coaching AgentPrompt (MongoDB / admin).
 */
export const parseOliviaCoachingGateText = (promptText) => {
  const text = typeof promptText === "string" ? promptText : "";
  const idx = text.indexOf(GATE_SECTION_MARKER);
  if (idx === -1) {
    throw new Error(
      `olivia_coaching prompt is missing ${GATE_SECTION_MARKER} section`
    );
  }
  const nextHeading = text.indexOf("\n## ", idx + GATE_SECTION_MARKER.length);
  const section =
    nextHeading === -1 ? text.slice(idx) : text.slice(idx, nextHeading);

  const gateTextMatch = section.match(/\n\n"([^"]+)"\n\nThen stop/);
  if (!gateTextMatch?.[1]) {
    throw new Error(
      "Could not parse scene completion gate question from olivia_coaching prompt"
    );
  }
  return gateTextMatch[1].trim();
};
