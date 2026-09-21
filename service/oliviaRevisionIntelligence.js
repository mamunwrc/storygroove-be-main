import crypto from "crypto";

import Message from "../models/messageModel.js";
import { OLIVIA_METADATA_KIND_COACHING_FULL_PASS } from "../constants/oliviaUiMessages.js";
import { truncateManuscriptDraftForContext } from "./oliviaDynamicContext.js";
import { COACHING_INTENT } from "./oliviaCoachingGate.js";

const PRIMARY_OPPORTUNITY_PATTERN =
  /### 2\. Primary Opportunity[^\n]*\n+([\s\S]*?)(?=\n### 3\.|$)/i;

const REVISION_PHRASE_PATTERN =
  /\b(revis(?:e|ed|ing|ion)|another pass|ready for another pass|compare(?:\s+it)?(?:\s+to)?|review my changes|made (?:the )?(?:changes|edits|updates)|made (?:the )?adjustments|take another look|look again|have another look|read (?:it|the chapter|the scene) again|updated it|i'?m done|done (?:revising|editing|updating)|did i fix)\b/i;

export const hashManuscriptDraft = (text = "") =>
  crypto.createHash("sha1").update(String(text || "").trim()).digest("hex");

export const truncateManuscriptDraft = (text = "") =>
  truncateManuscriptDraftForContext(text).text;

export const isFullCoachingPass = (content = "") => {
  const text = String(content || "");
  return (
    /### 1\. What's Working/i.test(text) &&
    /### 2\. Primary Opportunity/i.test(text)
  );
};

export const parsePrimaryOpportunity = (content = "") => {
  const match = String(content || "").match(PRIMARY_OPPORTUNITY_PATTERN);
  if (!match?.[1]) return "";
  return match[1].trim().slice(0, 4000);
};

export const buildCoachingFullPassMetadata = ({
  fullText,
  manuscriptDraft,
  sceneId,
  coachSceneMeta = {},
} = {}) => {
  if (!isFullCoachingPass(fullText)) return null;
  if (!sceneId || !String(manuscriptDraft || "").trim()) return null;

  const snapshot = truncateManuscriptDraft(manuscriptDraft);
  const primaryOpportunity =
    parsePrimaryOpportunity(fullText) || "See prior coaching pass in thread.";

  return {
    kind: OLIVIA_METADATA_KIND_COACHING_FULL_PASS,
    sceneId: String(sceneId),
    actNumber: coachSceneMeta.actNumber ?? null,
    sceneIndex: coachSceneMeta.sceneIndex ?? null,
    sceneTitle: coachSceneMeta.sceneTitle
      ? String(coachSceneMeta.sceneTitle).slice(0, 120)
      : "",
    manuscriptDraftSnapshot: snapshot,
    draftContentHash: hashManuscriptDraft(manuscriptDraft),
    primaryOpportunity,
  };
};

export const findLastCoachingFullPassForScene = async (threadId, sceneId) => {
  if (!threadId || sceneId == null || sceneId === "") return null;
  const doc = await Message.findOne({
    threadId,
    role: "assistant",
    "metadata.kind": OLIVIA_METADATA_KIND_COACHING_FULL_PASS,
    "metadata.sceneId": String(sceneId),
  })
    .sort({ timestamp: -1 })
    .lean();
  return doc || null;
};

export const isRevisionReviewTrigger = ({
  message = "",
  coachingIntent,
  coachTrigger = false,
  gateAlreadyAsked = false,
} = {}) => {
  if (coachingIntent === COACHING_INTENT.REVISION_REVIEW) return true;
  const text = String(message || "").trim();
  if (REVISION_PHRASE_PATTERN.test(text)) return true;
  if (coachTrigger && gateAlreadyAsked) return true;
  return false;
};

/**
 * Auto-route to revision review when a prior full pass exists for the scene and
 * the draft on this turn differs from the snapshot taken at that pass — the hash
 * diff is the real signal that the writer revised, even if their phrasing is vague.
 * @param {{ priorPass?: { metadata?: object } | null, currentDraftHash?: string }} args
 * @returns {boolean}
 */
export const hasDraftChangedSincePriorPass = ({
  priorPass = null,
  currentDraftHash = "",
} = {}) => {
  const priorHash = priorPass?.metadata?.draftContentHash;
  if (!priorHash || !currentDraftHash) return false;
  return priorHash !== currentDraftHash;
};

export const shouldRunRevisionReview = ({
  priorPass = null,
  currentDraftHash = "",
  trigger = false,
} = {}) => {
  if (!trigger || !priorPass?.metadata) return false;
  const priorHash = priorPass.metadata.draftContentHash;
  if (!priorHash || !currentDraftHash) return false;
  return priorHash !== currentDraftHash;
};

export const isDraftUnchangedSinceFullPass = ({
  priorPass = null,
  currentDraftHash = "",
  trigger = false,
} = {}) => {
  if (!trigger || !priorPass?.metadata) return false;
  const priorHash = priorPass.metadata.draftContentHash;
  if (!priorHash || !currentDraftHash) return false;
  return priorHash === currentDraftHash;
};
