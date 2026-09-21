import { COVER_METADATA_KIND_GENERATE_OFFER } from "../constants/coverUiMessages.js";

const AFFIRMATION_PREFIX_RE =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|go ahead|please do|do it|let'?s do it)[,.\s!]*/i;

const EXPLICIT_GENERATE_RE =
  /\b(generate|create|render|make|show me|give me)\b.{0,48}\b(it|one|a cover|the cover|an image|cover image|cover version|version|image)\b/i;

const EXPLICIT_COVER_RE =
  /\b(generate|create|render|make|deliver)\b.{0,40}\b(cover|version|image)\b/i;

const DELIVER_COVER_RE = /\bdeliver\s+cover\b/i;

const SHORT_GENERATE_RE =
  /^(?:generate|create|render|make)\s*(?:it|one|now)?[.!?]?$/i;

const PRONOUN_GENERATE_RE =
  /\b(?:let'?s|please|can you|could you|go ahead and|just)\s+(?:generate|create|render|make)\s+it\b/i;

const VISUAL_DIRECTION_RE =
  /\b(darker|lighter|mood|palette|color|typography|font|serif|sans|commercial|literary|romantic|thriller|minimal|bold|vintage|modern|comp|comparable|imagery|illustration|photo)\b/i;

const INCREMENTAL_REFINE_RE =
  /\b(title|typography|font|without|remove|drop|fix|same cover|keep the|keep.*look|just say|call it|format\s*\d|spell|spelling|rename|omit)\b/i;

const COVER_ACTION_CLASSIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["conversational", "refine_concept", "offer_generation"],
    },
    refinementMode: {
      type: "string",
      enum: ["incremental", "full"],
    },
    confidence: { type: "string", enum: ["high", "low"] },
  },
  required: ["action", "refinementMode", "confidence"],
};

export const isCoverActionClassifierEnabled = () =>
  process.env.COVER_ACTION_CLASSIFIER_ENABLED !== "false";

export const normalizeCoverUserMessage = (message) => {
  const raw = String(message || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!raw) return "";
  return raw.replace(AFFIRMATION_PREFIX_RE, "").trim() || raw;
};

const lastAssistantHadGenerateOffer = (priorMessages = []) => {
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const m = priorMessages[i];
    if (m.role !== "assistant") continue;
    return (
      m.metadata?.kind === COVER_METADATA_KIND_GENERATE_OFFER &&
      !m.metadata?.generationConsumed
    );
  }
  return false;
};

const threadHasVisualDirection = (priorMessages = [], currentText = "") => {
  if (VISUAL_DIRECTION_RE.test(currentText)) return true;
  const recent = priorMessages
    .filter((m) => m.role === "user" && m.kind !== "welcome")
    .slice(-5);
  return recent.some((m) => VISUAL_DIRECTION_RE.test(m.text || ""));
};

const threadHasRenderedCover = (priorMessages = []) =>
  priorMessages.some((m) => m.kind === "render_notice");

export const detectIncrementalRefinement = (
  text,
  { priorMessages = [], hasWorkingConcept = false } = {}
) => {
  if (!hasWorkingConcept && !threadHasRenderedCover(priorMessages)) {
    return false;
  }
  return INCREMENTAL_REFINE_RE.test(String(text || "").trim());
};

export const detectCoverGenerateIntent = (text, { priorMessages = [] } = {}) => {
  const trimmed = String(text || "").trim();
  if (!lastAssistantHadGenerateOffer(priorMessages)) {
    if (
      /\b(typography|font|palette|comparable)\b/i.test(trimmed) &&
      !/\b(cover|version|image|it|one)\b/i.test(trimmed)
    ) {
      return false;
    }
  }

  if (
    EXPLICIT_COVER_RE.test(trimmed) ||
    DELIVER_COVER_RE.test(trimmed) ||
    EXPLICIT_GENERATE_RE.test(trimmed) ||
    SHORT_GENERATE_RE.test(trimmed) ||
    PRONOUN_GENERATE_RE.test(trimmed)
  ) {
    return true;
  }

  const normalized = normalizeCoverUserMessage(trimmed);
  if (
    lastAssistantHadGenerateOffer(priorMessages) &&
    normalized.length > 0 &&
    normalized.length < 80 &&
    /^(?:yes|yeah|yep|yup|ok|okay|sure|go ahead|please|do it|let'?s do it|sounds good|perfect|great)[.!?]?$/i.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    lastAssistantHadGenerateOffer(priorMessages) &&
    (EXPLICIT_GENERATE_RE.test(normalized) ||
      PRONOUN_GENERATE_RE.test(normalized) ||
      SHORT_GENERATE_RE.test(normalized))
  ) {
    return true;
  }

  return false;
};

const buildCoverThreadSignals = ({
  priorMessages = [],
  hasWorkingConcept = false,
}) => ({
  hasWorkingConcept,
  hasRenderedCover: threadHasRenderedCover(priorMessages),
  pendingGenerateOffer: lastAssistantHadGenerateOffer(priorMessages),
});

const buildRecentCoverConversation = (priorMessages = []) =>
  priorMessages
    .filter((m) => m.kind === "chat" || m.kind === "welcome" || !m.kind)
    .slice(-10)
    .map((m) => ({
      role: m.role,
      text: String(m.text || "").slice(0, 800),
      kind: m.metadata?.kind || m.kind || null,
    }));

/**
 * Map validated classifier JSON to a routing decision (pure, testable).
 */
export const applyCoverClassifierDecision = ({
  parsed,
  priorMessages = [],
  hasWorkingConcept = false,
}) => {
  if (!parsed?.action || parsed.confidence !== "high") return null;

  const validActions = ["conversational", "refine_concept", "offer_generation"];
  if (!validActions.includes(parsed.action)) return null;

  if (parsed.action === "offer_generation") {
    let refinementMode =
      parsed.refinementMode === "incremental" ? "incremental" : "full";
    if (
      refinementMode === "incremental" &&
      !hasWorkingConcept &&
      !threadHasRenderedCover(priorMessages)
    ) {
      refinementMode = "full";
    }
    return { action: "offer_generation", source: "classifier", refinementMode };
  }

  if (parsed.action === "refine_concept") {
    return { action: "refine_concept", source: "classifier" };
  }

  return { action: "conversational", source: "classifier" };
};

/**
 * Heuristic fallback when classifier is off or inconclusive.
 */
export const resolveCoverUserActionHeuristic = ({
  message,
  priorMessages = [],
  hasAttachments = false,
  hasWorkingConcept = false,
}) => {
  const trimmed = String(message || "").trim();

  const shouldRefine =
    hasAttachments ||
    VISUAL_DIRECTION_RE.test(trimmed) ||
    threadHasVisualDirection(priorMessages, trimmed);

  if (shouldRefine) {
    return { action: "refine_concept", source: "visual_direction" };
  }

  return { action: "conversational", source: "default" };
};

/**
 * Lightweight structured classifier for free-text cover chat turns (internal only).
 */
export const classifyCoverUserActionWithModel = async ({
  openai,
  model,
  message,
  priorMessages = [],
  hasWorkingConcept = false,
}) => {
  const instructions = `You route Book Cover Studio chat for a novelist designing a book cover.
Return JSON only. Pick the writer's intent for this single message.

Actions:
- offer_generation: writer is ready for a cover image to be rendered (explicit generate request, affirmation after a generate offer, or approval of a revision such as "I like this cover but keep the title as X only")
- refine_concept: writer is giving visual direction or discussing mood/palette/typography/comps without being ready to render yet
- conversational: general questions, brainstorming, or ambiguous discussion

Refinement modes (only when action is offer_generation):
- incremental: writer wants the next version to keep the same overall cover look and only fix title/typography/spelling/removal of subtitle text
- full: writer wants a new cover direction or major visual change

Routing policies:
1. After assistant offered generation (pendingGenerateOffer), short affirmations ("yes", "go ahead", "let's do it", "sounds good") are offer_generation.
2. "I like this cover but keep the title as X" / "remove the subtitle" / "same look, fix the title" are offer_generation with refinementMode incremental when a prior cover or working concept exists.
3. Explicit generate/create/render/make cover phrasing is offer_generation.
4. Visual direction without render readiness ("make it darker", "try a serif font", "more gothic") is refine_concept.
5. When unsure between offer_generation and refine_concept, prefer refine_concept — never offer_generation on ambiguous discussion.
6. Set confidence high only when intent is clear; otherwise confidence low.

Never invent cover details not present in the conversation.`;

  const input = JSON.stringify({
    userMessage: message,
    threadSignals: buildCoverThreadSignals({ priorMessages, hasWorkingConcept }),
    recentConversation: buildRecentCoverConversation(priorMessages),
  });

  const { callResponsesAPI, extractTextFromOutput } = await import(
    "./responsesApiService.js"
  );

  const response = await callResponsesAPI({
    openai,
    model,
    instructions,
    input: [{ role: "user", content: input }],
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "CoverUserAction",
        schema: COVER_ACTION_CLASSIFIER_SCHEMA,
        strict: true,
      },
    },
  });

  const text = extractTextFromOutput(response.output);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return applyCoverClassifierDecision({
    parsed,
    priorMessages,
    hasWorkingConcept,
  });
};

/**
 * @returns {Promise<{ action: 'conversational'|'refine_concept'|'offer_generation', source: string, refinementMode?: 'incremental'|'full' }>}
 */
export const resolveCoverUserAction = async ({
  message,
  priorMessages = [],
  hasAttachments = false,
  hasWorkingConcept = false,
  openai = null,
  model = null,
}) => {
  const trimmed = String(message || "").trim();

  if (detectCoverGenerateIntent(trimmed, { priorMessages })) {
    const refinementMode = detectIncrementalRefinement(trimmed, {
      priorMessages,
      hasWorkingConcept,
    })
      ? "incremental"
      : "full";
    return { action: "offer_generation", source: "generate_intent", refinementMode };
  }

  if (isCoverActionClassifierEnabled() && openai && model) {
    try {
      const classified = await classifyCoverUserActionWithModel({
        openai,
        model,
        message: trimmed,
        priorMessages,
        hasWorkingConcept,
      });
      if (classified) return classified;
    } catch (err) {
      console.error("classifyCoverUserActionWithModel error:", err);
    }
  }

  return resolveCoverUserActionHeuristic({
    message: trimmed,
    priorMessages,
    hasAttachments,
    hasWorkingConcept,
  });
};
