import { StatusCodes } from "http-status-codes";
import Novel from "../models/novelModel.js";
import {
  OLIVIA_MODEL,
  ELLIS_MODEL,
  COVER_CONTEXT_SUMMARY_MODEL,
} from "../constants/models.js";
// LEGACY: Assistants API service imports (used by _old functions)
import {
  generateCharacterFromOpenAI_old,
  generateStoryFromOpenAI_old,
  generateScenesFromOliviaResponse_old,
  reviewByOpenAI_old,
  uploadContentFileToOpenAI_old,
  ellisReviewByOpenAI_old,
  uploadDocFileToOpenAI_old,
  processOliviaScenesResponse_old,
  oliviaScenesByOpenAI_old,
  parseJSONResponse,
} from "../service/openaiService.js";

// NEW DEFAULT: Responses API service imports
import {
  generateStoryFromResponses,
  generateScenesFromResponses,
  generateCharacterFromResponses,
  reviewByResponses,
  ellisReviewByResponses,
  oliviaScenesByResponses,
  readFileContentAsText,
  chatWithResponsesAPIStream,
  callResponsesAPI,
  extractTextFromOutput,
  generateCharacterProfileFromContext,
} from "../service/responsesApiService.js";
import StoryResponse from "../models/storyResponseModel.js";
import Character from "../models/characterModel.js";
import UserContent from "../models/userContentModel.js";
import { decrypt } from "../utils/keyEcryption.js";
import { extractSceneTitle, extractScenePov } from "../utils/extractSceneTitle.js";
import { resolveOutlineSceneTitle } from "../utils/resolveOutlineSceneTitle.js";
import { resolveSceneTitleForOutline } from "../utils/resolveSceneTitleForOutline.js";
import { resolveUniqueSceneTitle } from "../utils/resolveUniqueSceneTitle.js";
import { replaceSceneTitleInResponseText } from "../utils/replaceSceneTitleInResponseText.js";
import mongoose from "mongoose";
import Notes from "../models/notesModel.js";
import Idea from "../models/ideaModel.js";
import {
  parseManuscriptBuffer,
  extractManuscriptBlocks,
  buildChapterContentHtmlFromBlocks,
  stripRedundantChapterMetaBlocks,
} from "../utils/manuscriptParser.js";
import User from "../models/user.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";
import {
  STALE_CONTENT_CODE,
  parseExpectedUpdatedAt,
  buildUserContentSaveFilter,
  classifyUserContentSaveMiss,
} from "../utils/userContentSave.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import EllisSceneReview from "../models/ellisSceneReviewModel.js";
import EllisChapterReview from "../models/ellisChapterReviewModel.js";
import OliviaSceneSuggestion from "../models/oliviaSceneSuggestionModel.js";
import RevisionPlanItem from "../models/revisionPlanItemModel.js";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Header,
  PageNumber,
  TabStopPosition,
  TabStopType,
  SectionType,
  convertInchesToTwip,
  VerticalAlignSection,
  LineRuleType,
} from "docx";
import {
  parseHtmlToDocxParagraphs,
  getManuscriptNumberingConfig,
} from "../utils/htmlToDocx.js";
import { stripMarkdownForDocx } from "../utils/stripMarkdown.js";
import {
  buildSafeDocxFilenameFromTitle,
  setDocxDownloadHeaders,
} from "../utils/downloadFilename.js";
import Thread from "../models/threadModel.js";
import Message from "../models/messageModel.js";
import { v4 as uuidv4 } from "uuid";
import { getStoryPrompts } from "../utils/getStoryPrompts.js";
import {
  OLIVIA_METADATA_KIND_SCENE_WELCOME,
  OLIVIA_METADATA_KIND_LAYERING_WELCOME,
  OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED,
  OLIVIA_METADATA_KIND_LAYERING_OUTLINE_CONFIRM,
  OLIVIA_METADATA_KIND_DRAFTING_TRANSITION,
  OLIVIA_SCENE_WELCOME_TEXT,
  OLIVIA_LAYERING_WELCOME_TEXT,
  OLIVIA_LAYERING_WELCOME_PREAMBLE,
  OLIVIA_LAYERING_WELCOME_POSTAMBLE,
  OLIVIA_LAYERING_QUICK_REPLIES,
  OLIVIA_EDITOR_LAYERING_RUNTIME_RULES,
  OLIVIA_DRAFTING_TRANSITION_TEXT,
  resolveOliviaCoreSaveConfirm,
  OLIVIA_SCENE_FORMAT_RULE,
  OLIVIA_METADATA_KIND_COACHING_GATE,
  getLayeringRuntimeRulesForPhase,
  oliviaUiMessageMetadata,
} from "../constants/oliviaUiMessages.js";
import {
  ELLIS_METADATA_KIND_SCENE_WELCOME,
  ELLIS_METADATA_KIND_INSERT_CONFIRM,
  ELLIS_METADATA_KIND_CHAPTER_REVIEW,
  ELLIS_METADATA_KIND_REVISION_REVIEW,
  ELLIS_METADATA_KIND_CONVERSATIONAL,
  ELLIS_METADATA_KIND_LETTER_DRAFT,
  ELLIS_METADATA_KIND_LETTER_REFINE,
  ELLIS_SCENE_WELCOME_TEXT,
  buildEllisInsertConfirmText,
  ellisUiMessageMetadata,
  ellisChapterReviewMetadata,
  ellisRevisionReviewMetadata,
} from "../constants/ellisUiMessages.js";
import { isEllisMemoryV2Enabled } from "../constants/ellisMemory.js";
import { consolidateUploadedManuscriptChapters } from "../service/manuscriptConsolidation.js";
import {
  buildEllisChatTurnContext,
  listReviewedEllisChaptersInThread,
  hasEllisFirstPassWrapUpPosted,
  resolveEllisChapterPovName,
  findReadyReviewForChapter,
  hashEllisChapterDraft,
  extractLastChapterRefFromAssistantContent,
  uniqueAssistantChapterNumbers,
} from "../service/ellisDynamicContext.js";
import {
  executeEllisLoadManuscriptChapters,
  parseEllisLoadChapterArgs,
} from "../service/ellisChapterLoader.js";
import {
  COACHING_INTENT,
  isCoachSceneTrigger,
  hasCoachingGateAskedForScene,
  parseOliviaCoachingGateText,
  resolveGateFollowUpIntent,
  sanitizeCoachingConversationalClose,
} from "../service/oliviaCoachingGate.js";
import {
  buildCoachingFullPassMetadata,
  findLastCoachingFullPassForScene,
  hashManuscriptDraft,
  hasDraftChangedSincePriorPass,
  isDraftUnchangedSinceFullPass,
  isFullCoachingPass,
  isRevisionReviewTrigger,
  shouldRunRevisionReview,
} from "../service/oliviaRevisionIntelligence.js";
import { assembleOliviaContext } from "../service/contextAssembler.js";
import { getLayeringStateForNovel } from "../service/oliviaLayeringState.js";
import { resolveFocusScene } from "../service/oliviaFocusResolver.js";
import { buildMasterPromptSlice } from "../service/masterPromptSlice.js";
import { stripDossierBlocksFromMasterPrompt, isOutlineTableQuery } from "../service/characterCanonContext.js";
import { ensureNovelStoryBible } from "../utils/ensureNovelStoryBible.js";
import {
  buildOliviaSupplementBlock,
  buildOliviaDynamicContext,
  buildSceneExtrasBlock,
  sceneMetaFromPayload,
} from "../service/oliviaDynamicContext.js";
import { resolveOliviaAvatarDrafts, executeOliviaLoadManuscriptScenes, findLastOliviaLoadedDraftNeed, parseOliviaDraftNeedArgs } from "../service/oliviaDraftSceneResolver.js";
import { invalidateAssemblerCache } from "../service/contextAssembler.js";
import { ensureStoryStateForNovel } from "../service/storyStateBootstrap.js";
import ActiveSceneState from "../models/activeSceneStateModel.js";
import { onSceneClosed as fireSceneMemoryWorker } from "../service/memoryWorker.js";
import { enqueueFireAndForget as enqueueMemoryJob } from "../service/memoryQueue.js";
import {
  onSceneEdit as memoryOnSceneEdit,
  onSceneDelete as memoryOnSceneDelete,
  onSceneRename as memoryOnSceneRename,
  onCharacterEdit as memoryOnCharacterEdit,
  onNovelEdit as memoryOnNovelEdit,
} from "../service/memoryInvalidator.js";
import {
  buildCharacterOrderIds,
  sortCharactersByUserOrder,
} from "../utils/characterSortOrder.js";
import { fetchThreadMessagePage } from "../service/oliviaThreadHistory.js";
import StoryState from "../models/storyStateModel.js";
import {
  syncSceneMemoryToVectorStore,
} from "../utils/provisionNovelVectorStore.js";
import {
  isOliviaMemoryV2Enabled,
  isOliviaNovelVectorStoreEnabled,
  isOliviaSceneCheckpointsEnabled,
} from "../constants/oliviaMemory.js";
import {
  buildLayeringInsertNextCueSuffix,
  buildLayeringQueueBlock,
  findLatestLayeringTableTextFromMessages,
  computeLayeringState,
} from "../utils/oliviaLayeringParse.js";
import { computeActOffsets, getGlobalSceneNumber, formatActChapterRef } from "../utils/globalSceneNumber.js";
import {
  buildOliviaOutlineSaveStatusBlock,
  collectFilledOliviaCoreSlotKeys,
  findNextEmptyOliviaCoreSlot,
} from "../utils/oliviaOutlineSaveStatus.js";
import {
  buildOutlineSceneRows,
  formatOutlineSceneRowsAsMarkdownTable,
  formatOutlineInventoryTable,
} from "../utils/buildOutlineSceneRows.js";
import { isArchivedScene } from "../utils/archivedScenes.js";
import {
  generateOutlineDocx,
  OutlineExportError,
} from "../service/outlineExportService.js";
import {
  generateManuscriptMapDocx,
  ManuscriptMapExportError,
} from "../service/manuscriptMapExportService.js";
import {
  generateEditorialLetterDocx,
  EditorialLetterExportError,
} from "../service/editorialLetterExportService.js";
import {
  generateChapterPlanDocx,
  ChapterPlanExportError,
} from "../service/chapterPlanExportService.js";
import {
  generateCharactersDocx,
  CharactersExportError,
} from "../service/charactersExportService.js";
import {
  generateStoryBibleDocx,
  StoryBibleExportError,
} from "../service/storyBibleExportService.js";
import {
  safeUpsertDossierCharacter,
  createManualCharacter as createManualCharacterRecord,
  deleteCharacter as deleteCharacterRecord,
  CharacterServiceError,
  findDuplicateCharacterByName,
} from "../service/characterService.js";
import {
  generateUploadedManuscriptDocx,
  UploadedManuscriptExportError,
} from "../service/uploadedManuscriptExportService.js";
import {
  assembleManuscriptText,
  buildUploadedManuscriptMetaContext,
  buildUploadedManuscriptMetaLines,
  stripChapterHtmlToText,
  excerptChapterText,
  resolveChapterExportMeta,
  peelLeadingSceneTitleBlock,
  filterSceneBreakOrnamentBlocks,
} from "../utils/manuscriptText.js";
import { generateManuscriptEnrichment } from "../service/ellisManuscriptEnrichmentService.js";
import {
  nextSceneIndexForAct,
  healActSceneIndices,
  syncExtraSlotPromptKeys,
  healNovelSceneIndices,
  normalizeActNumber,
  resolvePromptKeyForOliviaSave,
} from "../utils/sceneIndexUtils.js";
import { buildOliviaResponsesTools, OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME } from "../utils/oliviaResponsesTools.js";
import {
  buildEllisResponsesTools,
  ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME,
} from "../utils/ellisResponsesTools.js";

const buildLayeringStateForNovel = getLayeringStateForNovel;

// ---------------------------------------------------------------------------
// Shared helper — builds the full outline context injected into AI instructions
// for generateRichScene, oliviaEditorChat, and any future scene AI calls.
// ---------------------------------------------------------------------------
/**
 * How many scenes on either side of the focus scene to render in full
 * (title + POV + summary). Scenes outside the window are condensed to a
 * single line per scene to keep the outline context bounded.
 */
const OUTLINE_FOCUS_WINDOW = 2;

const isWithinFocusWindow = (uc, focusScene) => {
  if (!focusScene?.actNumber || !focusScene?.sceneIndex) return false;
  const focusAct = Number(focusScene.actNumber);
  const focusIdx = Number(focusScene.sceneIndex);
  const actDelta = Math.abs(uc.actNumber - focusAct);
  if (actDelta > 1) return false;
  if (actDelta === 0) return Math.abs(uc.sceneIndex - focusIdx) <= OUTLINE_FOCUS_WINDOW;
  // Adjacent act: only the trailing edge of the prior act / leading edge of next.
  if (uc.actNumber < focusAct && uc.sceneIndex >= 4) return true;
  if (uc.actNumber > focusAct && uc.sceneIndex <= 2) return true;
  return false;
};

/**
 * Build the outline context that ships with every Olivia turn.
 *
 * When `focusScene` is provided, only scenes within
 * `OUTLINE_FOCUS_WINDOW` of the focus are rendered with full
 * title+POV+summary. Other scenes are listed as one-line condensed
 * entries — enough for the model to know they exist and where, without
 * blowing the prompt budget on prose that isn't relevant to the
 * current turn.
 *
 * When `focusScene` is omitted, falls back to the legacy "render every
 * scene in full" behavior so dashboard / Phase-1.5 callers that don't
 * yet pass a focus stay unaffected.
 */
const COACHING_SCENE_PURPOSE_MAX = 160;

export const buildOutlineContextFromData = (
  sceneDocs,
  userContents,
  novel,
  focusScene = null,
  contextMode = "default"
) => {
  const isCoaching = contextMode === "coaching";
  const actGroups = {};
  userContents.forEach((uc) => {
    if (isArchivedScene(uc)) return;
    if (!actGroups[uc.actNumber]) actGroups[uc.actNumber] = [];
    actGroups[uc.actNumber].push(uc);
  });

  let ctx = "\n\n---\n\nCURRENT NOVEL CONTEXT:\n";
  ctx += `Title: ${novel.name}\n`;
  if (novel.genre)     ctx += `Genre: ${novel.genre}\n`;
  if (novel.protagonist) ctx += `Protagonist: ${novel.protagonist}\n`;
  if (novel.antagonist)  ctx += `Antagonist: ${novel.antagonist}\n`;
  if (novel.wordCount)   ctx += `Word Count Target: ${novel.wordCount.toLocaleString()} words\n`;
  if (novel.theme)       ctx += `Theme: ${novel.theme}\n`;
  if (novel.subplot)     ctx += `Subplot: ${novel.subplot}\n`;

  const actOffsets = computeActOffsets(userContents);
  const focusChapter =
    focusScene?.actNumber && focusScene?.sceneIndex != null
      ? getGlobalSceneNumber(
          focusScene.actNumber,
          focusScene.sceneIndex,
          actOffsets
        )
      : null;

  if (isCoaching && focusChapter != null) {
    ctx +=
      `\nCOACHED SCENE: ${formatActChapterRef(focusScene.actNumber, focusChapter)}. ` +
      "The sections below are scene-design reference only — not the manuscript draft.\n";
    ctx += "\nSCENE DESIGN REFERENCE (outline intent — do not coach this text):\n";
  } else if (focusChapter != null) {
    ctx += `\nFOCUS: The writer is currently working near ${formatActChapterRef(focusScene.actNumber, focusChapter)}. Scenes near this focus appear with full detail; others are condensed.\n`;
    ctx += "\nCURRENT OUTLINE (focus-windowed):\n";
  } else {
    ctx += "\nCURRENT OUTLINE (all scenes in narrative order):\n";
  }

  for (const actNum of Object.keys(actGroups).sort((a, b) => Number(a) - Number(b))) {
    const actScenes = actGroups[actNum];
    const actInfo = novel.acts?.find((a) => a.actNumber === parseInt(actNum));
    ctx += `\nAct ${actNum}${actInfo?.title ? `: ${actInfo.title}` : ""}:\n`;
    for (const uc of actScenes) {
      const globalNum = getGlobalSceneNumber(uc.actNumber, uc.sceneIndex, actOffsets);
      const sceneDoc = sceneDocs.find((s) => s.promptKey === uc.promptKey);
      const inWindow = !focusScene || isWithinFocusWindow(uc, focusScene);
      const title = resolveOutlineSceneTitle(
        uc,
        sceneDoc?.responseText || "",
        globalNum
      );
      let summary = "";
      let povTag = "";
      if (sceneDoc?.responseText) {
        if (inWindow) {
          const summaryMatch = sceneDoc.responseText.match(/📝 Scene to Write:\s*(.+)/i);
          if (summaryMatch) {
            const purpose = summaryMatch[1].trim();
            const cap = isCoaching ? COACHING_SCENE_PURPOSE_MAX : 200;
            summary = ` — ${purpose.slice(0, cap)}`;
          }
        }
        const pov = extractScenePov(sceneDoc.responseText);
        if (pov) povTag = ` (POV: ${pov})`;
      }
      const focusMarker = focusScene && uc.actNumber === Number(focusScene.actNumber) && uc.sceneIndex === Number(focusScene.sceneIndex) ? " ⟵ FOCUS" : "";
      ctx += `  Chapter ${globalNum}: ${title}${povTag}${summary}${focusMarker}\n`;
    }
  }
  ctx += "\n---\n";
  return ctx;
};

const buildOutlineContext = async (
  novelId,
  userId,
  novel,
  focusScene = null,
  contextMode = "default"
) => {
  const [sceneDocs, userContents] = await Promise.all([
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
    UserContent.find({ novelId, user: userId }).sort({ actNumber: 1, sceneIndex: 1 }).lean(),
  ]);
  return buildOutlineContextFromData(
    sceneDocs,
    userContents,
    novel,
    focusScene,
    contextMode
  );
};

// ---------------------------------------------------------------------------
// Build a GFM markdown table of the 15-scene spine for the layering welcome.
// Includes a "Scene Purpose" column derived from Book Coaching or Summary.
// ---------------------------------------------------------------------------
const buildFifteenSceneTable = async (novelId, userId, novel) => {
  const [sceneDocs, userContents] = await Promise.all([
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
    UserContent.find({ novelId, user: userId }).sort({ actNumber: 1, sceneIndex: 1 }).lean(),
  ]);

  const rows = buildOutlineSceneRows(sceneDocs, userContents);
  return formatOutlineSceneRowsAsMarkdownTable(rows);
};

/**
 * Builds the full dynamic layering welcome: preamble + 15-scene table + postamble.
 */
const buildLayeringWelcomeText = async (novelId, userId, novel) => {
  try {
    const table = await buildFifteenSceneTable(novelId, userId, novel);
    return OLIVIA_LAYERING_WELCOME_PREAMBLE + table + OLIVIA_LAYERING_WELCOME_POSTAMBLE;
  } catch {
    return OLIVIA_LAYERING_WELCOME_TEXT;
  }
};

// ---------------------------------------------------------------------------
// POV rotation tracker — builds an explicit instruction block when the
// writer's Story Bible specifies a rotating / ensemble / alternating POV.
// ---------------------------------------------------------------------------
const ROTATION_KEYWORDS_RE = /rotat|ensemble|alternat|multi(?:ple)?\s*pov|dual\s*(?:pov|timeline)|shifting\s*pov/i;

const extractStructureSection = (masterPrompt) => {
  if (!masterPrompt) return "";
  const m = masterPrompt.match(
    /(?:\*{0,2}\s*(?:13\.?\s*)?Structure\s*\*{0,2}\s*\n)([\s\S]*?)(?=\n\s*(?:\*{0,2}\s*(?:14|---|\*{0,2}\s*Tone)))/i
  );
  return m?.[1]?.trim() || "";
};

const buildPovRotationBlockFromData = (sceneDocs, userContents, novel) => {
  const structureText = extractStructureSection(novel.masterPrompt);
  if (!structureText || !ROTATION_KEYWORDS_RE.test(structureText)) return "";

  const actOffsets = computeActOffsets(userContents);
  const povSequence = [];

  for (const uc of userContents) {
    if (isArchivedScene(uc)) continue;
    const globalNum = getGlobalSceneNumber(uc.actNumber, uc.sceneIndex, actOffsets);
    const sceneDoc = sceneDocs.find((s) => s.promptKey === uc.promptKey);
    const pov = sceneDoc?.responseText ? extractScenePov(sceneDoc.responseText) : "";
    povSequence.push({ globalNum, pov: pov || "unknown" });
  }

  let block = "\n\n---\nPOV ROTATION TRACKER (auto-generated from delivered scenes):\n";
  block += `Writer's structural overlay: "${structureText}"\n`;

  if (povSequence.length > 0) {
    block += "\nDelivered POV sequence:\n";
    for (const { globalNum, pov } of povSequence) {
      block += `- Scene ${globalNum}: ${pov}\n`;
    }

    const recent = povSequence.slice(-2);
    const allSamePov = recent.length >= 2 && recent.every((s) => s.pov === recent[0].pov && s.pov !== "unknown");
    if (allSamePov) {
      block += `\nWARNING: The last ${recent.length} delivered scenes used ${recent[0].pov}'s POV. The writer's structural overlay requires rotation. The next scene MUST use a DIFFERENT character's POV.\n`;
    }
  } else {
    block += "\nNo scenes delivered yet.\n";
  }

  block += "---\n";
  return block;
};

const buildPovRotationBlock = async (novelId, userId, novel) => {
  const [sceneDocs, userContents] = await Promise.all([
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
    UserContent.find({ novelId, user: userId }).sort({ actNumber: 1, sceneIndex: 1 }).lean(),
  ]);
  return buildPovRotationBlockFromData(sceneDocs, userContents, novel);
};

/**
 * Fetches StoryResponse + UserContent once and derives both outline context
 * and POV rotation block, avoiding duplicate DB queries.
 * Returns { outlineContext, povRotationBlock, userContents, actOffsets }.
 */
const buildOutlineAndPovContext = async (
  novelId,
  userId,
  novel,
  focusScene = null,
  contextMode = "default"
) => {
  const [sceneDocs, userContents] = await Promise.all([
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
    UserContent.find({ novelId, user: userId }).lean(),
  ]);
  const sortedContents = [...userContents].sort(
    (a, b) => a.actNumber - b.actNumber || a.sceneIndex - b.sceneIndex
  );
  const outlineContext = buildOutlineContextFromData(
    sceneDocs,
    sortedContents,
    novel,
    focusScene,
    contextMode
  );
  const povRotationBlock = buildPovRotationBlockFromData(
    sceneDocs,
    sortedContents,
    novel
  );
  const actOffsets = computeActOffsets(sortedContents);
  const outlineRows = buildOutlineSceneRows(sceneDocs, sortedContents);
  const filledSlotKeys = collectFilledOliviaCoreSlotKeys(
    sortedContents,
    sceneDocs
  );
  return {
    outlineContext,
    povRotationBlock,
    userContents: sortedContents,
    actOffsets,
    outlineInventoryTable: formatOutlineInventoryTable(outlineRows),
    filledSlotKeys,
    nextEmptyCoreSlot: findNextEmptyOliviaCoreSlot(filledSlotKeys),
  };
};

const attachOliviaSceneSaveStatus = (extrasArgs, outlinePov, targetScene) => ({
  ...extrasArgs,
  outlineSaveStatus: buildOliviaOutlineSaveStatusBlock({
    targetScene,
    nextEmptySlot: outlinePov.nextEmptyCoreSlot,
    filledSlotKeys: outlinePov.filledSlotKeys,
    actOffsets: outlinePov.actOffsets,
  }),
});

const applyOliviaAvatarDraftsToExtras = ({
  extrasArgs = {},
  userContents,
  selectedDraft,
  selectedMeta,
  draftNeed = null,
}) => {
  const resolved = resolveOliviaAvatarDrafts({
    userContents,
    selectedDraft,
    selectedMeta,
    draftNeed,
  });
  return {
    ...extrasArgs,
    manuscriptDraft: resolved.manuscriptDraft,
    draftSceneMeta: resolved.draftSceneMeta,
    openEditorDraft: resolved.openEditorDraft,
    openEditorSceneMeta: resolved.openEditorSceneMeta,
    draftPackScenes: resolved.draftPackScenes,
    draftIndexRows: resolved.draftIndexRows,
    missingDraftGlobals: resolved.missingDraftGlobals,
  };
};

const resolveOliviaManuscriptToolCall = ({
  userContents,
  selectedDraft,
  selectedMeta,
  loadedDraftNeedRef = null,
}) => async (fc) => {
  if (fc?.name !== OLIVIA_LOAD_MANUSCRIPT_SCENES_NAME) {
    return JSON.stringify({ error: "Function not implemented." });
  }
  const parsed = parseOliviaDraftNeedArgs(fc.arguments);
  if (parsed && loadedDraftNeedRef) loadedDraftNeedRef.value = parsed;
  return executeOliviaLoadManuscriptScenes({
    args: parsed || fc.arguments,
    userContents,
    selectedDraft,
    selectedMeta,
  });
};

const loadCarriedOliviaDraftNeed = async (threadId) => {
  if (!threadId) return null;
  const recent = await Message.find({ threadId })
    .sort({ timestamp: -1, _id: -1 })
    .limit(12)
    .select("role metadata")
    .lean();
  return findLastOliviaLoadedDraftNeed(recent);
};

import {
  extractNovelDataFromResponse,
  extractCharacterDossierBlocksFromMasterPrompt,
  normalizeDossierText,
  isOliviaDuplicatedDossier,
  stripDossierTrailingBridge,
  extractCharacterNameFromDossier,
} from "../utils/extractNovelData.js";
import {
  extractStoryBibleTitle,
  ensureStoryBibleApproxOnOwnLine,
} from "../utils/storyBibleTitle.js";
import { ensureUserAgentAssistant } from "../controllers/assistantController.js";
import { getSharedOpenAIKey } from "../controllers/chatController.js";
import OpenAI from "openai";
import { uploadToS3 } from "../service/s3Service.js";
import { logApiUsage, logApiUsageRaw } from "../utils/logApiUsage.js";
import {
  getSecondPillarPrompt,
  getThirdPillarPrompt,
  getForthPillarPrompt,
} from "../utils/reviewPrompts/getReviewCyclePrompts.js";
import {
  stripEllisOutputAdapter,
  appendEllisSecuritySuffix,
} from "../utils/reviewPrompts/ellisPromptUtils.js";
import { loadAgentPromptFromDb } from "../utils/loadAgentPrompt.js";
import AgentPrompt from "../models/agentPromptModel.js";
import {
  ELLIS_CHAPTER_REVIEW_SCHEMA,
  buildEllisChapterReviewPayload,
  upsertEllisChapterReview,
  shouldPreserveOriginalEllisReview,
  isEllisDevelopmentalReviewText,
  resolveEllisAssistantTurnKind,
  resolveEllisDeliveredReviewChapter,
  stripEllisLegacyWorkflowCta,
  stripEllisFalseInsertClaims,
  stripEllisOpenEndedOffers,
  stripEllisLeakedModeFraming,
  rewriteEllisReviewOpenersToChapterTitle,
  stampEllisRepeatedSceneOpenerLetters,
  findEllisChapterReviewForMapRow,
  buildEllisReviewProgressMap,
  markEllisChapterReviewGenerating,
  markEllisChapterReviewFailed,
  resolveEllisSavedReviewChapterRef,
  buildManuscriptMapContext,
  sortChapterRows,
  buildAdjacentChapterContext,
  resolveChapterLabel,
  getDistinctBaseChapterRows,
  collectReadyChapterNumbers,
  isEllisBackfillInsert,
  resolveNextEllisOpenChapter,
  isEllisManuscriptChapterNumber,
} from "../service/ellisChapterReviewService.js";
import { parseChapterRouteParam } from "../service/ellisDynamicContext.js";
import {
  getUploadedChapterRows,
  isArchivedChapterRow,
  nextParkedChapterNumber,
  planUploadedChapterArchive,
  planUploadedChapterRestore,
  assignCompactChapterNumbers,
  buildCompactChapterRemap,
  PARKED_CHAPTER_NUMBER_BASE,
} from "../utils/uploadedChapterRows.js";
import {
  matchChapterHeader,
  normalizeChapterSuffix,
  chapterIdentityKey,
  chapterProgressKey,
} from "../utils/manuscriptParser.js";

const getReviewInstructions = (pillar) => {
  switch (pillar) {
    case "evaluation":
      return getSecondPillarPrompt();
    case "development":
      return getSecondPillarPrompt();
    case "line":
      return getThirdPillarPrompt();
    case "copyedit":
      return getForthPillarPrompt();
    default:
      return getSecondPillarPrompt();
  }
};

// LEGACY: Assistants API story generation
export const generateStory_old = async (req, res) => {
  try {
    const userId = req.user._id;
    const openaiKey = decrypt(req.openaiKey);
    const assistantId = req.assistantId;

    const {
      novelId,
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
      supportingCharacters,
      subplot,
      summary,
      compTitles,
    } = req.body;

    const requiredFields = {
      setting: "Setting",
      narrativeStyle: "Narrative Style",
      genre: "Genre",
      wordCount: "Word Count",
      protagonist: "Protagonist",
      protagonistDescription: "Protagonist Description",
      antagonist: "Antagonist",
      antagonistMotivation: "Antagonist Motivation",
      theme: "Theme",
      themeExploration: "Theme Exploration",
      supportingCharacters: "Supporting Characters",
      subplot: "Subplot",
      summary: "Summary",
      compTitles: "Comparative Titles",
    };

    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      if (!req.body[field]) {
        missingFields.push(label);
      }
    }

    if (missingFields.length > 0) {
      const errorMessage =
        missingFields.length === 1
          ? `${missingFields[0]} is required`
          : `The following fields are required: ${missingFields.join(", ")}`;

      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errorMessage,
      });
    }

    const updatedNovel = await Novel.findByIdAndUpdate(novelId, {
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
      supportingCharacters,
      subplot,
      summary,
      compTitles,
    });

    if (!updatedNovel) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "Novel not found",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await generateStoryFromOpenAI_old(
      req.body,
      userId,
      res,
      openaiKey,
      assistantId
    );

    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ error: "Internal Server Error" })}\n\n`
    );
    res.end();
  }
};

// LEGACY: Assistants API novel review
export const reviewNovel_old = async (req, res) => {
  try {
    const userId = req.user._id;
    const openaiKey = decrypt(req.openaiKey);
    const assistantId = req.assistantId;
    const { novelId, pillar } = req.body;
    const chapters = [];

    if (!novelId) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "All fields are required" });
    }

    const userContents = await UserContent.find({ novelId, user: userId });
    const reviewOldOffsets = computeActOffsets(userContents);

    const sceneContents = userContents
      .filter(
        (c) =>
          c.actNumber && c.sceneIndex && c.userContent && c.userContent.trim()
      )
      .sort((a, b) => {
        if (a.actNumber !== b.actNumber) {
          return a.actNumber - b.actNumber;
        }
        return a.sceneIndex - b.sceneIndex;
      })
      .map((c) => {
        const header = `Act ${c.actNumber} | Chapter ${getGlobalSceneNumber(c.actNumber, c.sceneIndex, reviewOldOffsets)}`;
        let tempBody = {
          name: header,
          actNumber: c.actNumber,
          sceneIndex: c.sceneIndex,
        };
        chapters.push(tempBody);
        const content = c.userContent.trim();
        return `${header}\n\n${content}`;
      })
      .join("\n\n\n");

    if (!sceneContents) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "No scene content found" });
    }

    const fileId = await uploadContentFileToOpenAI_old(sceneContents, openaiKey);
    const reviewResponse = await reviewByOpenAI_old(
      fileId,
      openaiKey,
      assistantId,
      pillar,
      chapters,
      novelId
    );

    res.status(StatusCodes.OK).json({ data: reviewResponse });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

// LEGACY: Assistants API Ellis review
export const ellisReview_old = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.body;

    if (!novelId) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "novelId is required" });
    }

    if (!req.file) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Document file is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).lean();
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const { openaiKey, userAgent } = await ensureUserAgentAssistant({
      user,
      agentName: "ellis",
    });

    const fileId = await uploadDocFileToOpenAI_old(
      req.file.buffer,
      openaiKey,
      req.file.originalname
    );

    const reviewResponse = await ellisReviewByOpenAI_old(
      fileId,
      openaiKey,
      userAgent.assistantId,
      novelId,
      user._id
    );

    return res.status(StatusCodes.OK).json({ 
      message: "Ellis review completed successfully",
      data: reviewResponse 
    });
  } catch (error) {
    console.error("Ellis review error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error", message: error.message });
  }
};

// LEGACY: Assistants API character generation
export const generateCharacter_old = async (req, res) => {
  const openaiKey = decrypt(req.openaiKey);
  const assistantId = req.assistantId;
  try {
    const {
      _id,
      novelId,
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
      characterId,
    } = req.body;

    if (
      !_id ||
      !novelId ||
      !archetype ||
      !role ||
      !name ||
      !age ||
      !gender ||
      !occupation ||
      !ethnicity ||
      !appearance ||
      !style ||
      !traits ||
      !characterId
    ) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "All fields are required" });
    }

    const novel = await Novel.findById(novelId);

    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const characterResponse = await generateCharacterFromOpenAI_old(
      req.body,
      openaiKey,
      assistantId
    );

    const updatedCharacter = await Character.findOneAndUpdate(
      { _id, novel: novelId },
      {
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
        responseText: characterResponse,
      },
      { new: true }
    );

    if (!updatedCharacter) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Character not found" });
    }

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "novel",
      description: "Character dossier generated (legacy Assistants API)",
      metadata: { novelId: String(novelId), characterId: String(characterId) },
    });
    res.status(StatusCodes.OK).json(updatedCharacter);
  } catch (e) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const createNovel = async (req, res) => {
  const { name, bookIdea } = req.body;
  const userId = req.user._id;

  const novel = await Novel.create({
    user: userId,
    name,
    bookIdea,
  });

  if (novel) {
    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "Novel created",
      metadata: { novelId: String(novel._id), name },
    });
    res
      .status(StatusCodes.OK)
      .json({ message: "Your novel has been created successfully" });
  }
};

// LEGACY: Assistants API novel creation from Olivia response
export const createNovelFromOliviaResponse_old = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = req.user;
    const { oliviaResponse } = req.body;

    if (!oliviaResponse) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Olivia response is required",
      });
    }

    // Extract novel data from olivia's response
    const novelData = extractNovelDataFromResponse(oliviaResponse);

    // Validate required fields
    const requiredFields = {
      setting: "Setting",
      narrativeStyle: "Narrative Style",
      genre: "Genre",
      wordCount: "Word Count",
      protagonist: "Protagonist",
      protagonistDescription: "Protagonist Description",
      antagonist: "Antagonist",
      antagonistMotivation: "Antagonist Motivation",
      theme: "Theme",
      themeExploration: "Theme Exploration",
      supportingCharacters: "Supporting Characters",
      subplot: "Subplot",
      summary: "Summary",
      compTitles: "Comparative Titles",
    };

    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      if (!novelData[field] || (Array.isArray(novelData[field]) && novelData[field].length === 0)) {
        missingFields.push(label);
      }
    }

    if (missingFields.length > 0) {
      const errorMessage =
        missingFields.length === 1
          ? `${missingFields[0]} is required in Olivia's response`
          : `The following fields are required in Olivia's response: ${missingFields.join(", ")}`;

      return res.status(StatusCodes.BAD_REQUEST).json({
        error: errorMessage,
      });
    }

    // Ensure olivia-scenes agent exists for the user
    const { openaiKey, userAgent } = await ensureUserAgentAssistant({
      user,
      agentName: "olivia_scenes",
    });

    const storyBibleAuthorLegacy =
      typeof novelData.storyBibleAuthor === "string" &&
      novelData.storyBibleAuthor.trim()
        ? novelData.storyBibleAuthor.trim()
        : undefined;

    // Create novel
    const novel = await Novel.create({
      user: userId,
      name: novelData.name || "Untitled Novel",
      bookIdea: novelData.bookIdea || "",
      setting: novelData.setting,
      narrativeStyle: novelData.narrativeStyle,
      genre: novelData.genre,
      storyBibleAuthor: storyBibleAuthorLegacy,
      wordCount: novelData.wordCount,
      protagonist: novelData.protagonist,
      protagonistDescription: novelData.protagonistDescription,
      antagonist: novelData.antagonist,
      antagonistMotivation: novelData.antagonistMotivation,
      theme: novelData.theme,
      themeExploration: novelData.themeExploration,
      supportingCharacters: novelData.supportingCharacters,
      subplot: novelData.subplot,
      summary: novelData.summary,
      compTitles: novelData.compTitles,
    });

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "Novel created from Olivia response (legacy)",
      metadata: { novelId: String(novel._id) },
    });
    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Start generating scenes (legacy Assistants API)
    await generateScenesFromOliviaResponse_old(
      { ...novelData, novelId: novel._id },
      userId,
      res,
      openaiKey,
      userAgent.assistantId
    );

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: "Internal Server Error",
        message: error.message,
      });
    } else {
      res.write(
        `data: ${JSON.stringify({ error: "Internal Server Error: " + error.message })}\n\n`
      );
      res.end();
    }
  }
};

export const updateNovel = async (req, res) => {
  try {
    const {
      novelId,
      protagonist,
      antagonist,
      supportingCharacters,
      ...otherUpdates
    } = req.body;

    const userId = req.user._id;

    const novel = await Novel.findOne({ _id: novelId, user: userId });
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: "Novel not found" });
    }

    const updateFields = {};
    for (const key in otherUpdates) {
      if (otherUpdates[key] !== undefined) {
        updateFields[key] = otherUpdates[key];
      }
    }

    // ✅ Handle protagonist
    if (protagonist !== undefined && protagonist !== "") {
      updateFields.protagonist = protagonist;

      await Character.findOneAndUpdate(
        { novel: novelId, character: "protagonist" },
        { name: protagonist, character: "protagonist" },
        { upsert: true, new: true }
      );
    }

    // ✅ Handle antagonist
    if (antagonist !== undefined && antagonist !== "") {
      updateFields.antagonist = antagonist;

      await Character.findOneAndUpdate(
        { novel: novelId, character: "antagonist" },
        { name: antagonist, character: "antagonist" },
        { upsert: true, new: true }
      );
    }

    // ✅ Handle supporting characters
    const updatedSupporting = [];

    if (supportingCharacters && Array.isArray(supportingCharacters)) {
      for (const char of supportingCharacters) {
        const existing = await Character.findOneAndUpdate(
          {
            novel: novelId,
            name: char.name,
            character: "supporting character",
          },
          {
            $set: {
              role: char.role,
              name: char.name,
              character: "supporting character",
              significance: char.significance,
            },
          },
          { upsert: true, new: true }
        );

        updatedSupporting.push({
          _id: existing._id,
          name: existing.name,
          role: existing.role,
          significance: existing.significance,
        });
      }

      updateFields.supportingCharacters = updatedSupporting;
    }

    // ✅ Save updates to novel (atomic)
    await Novel.findByIdAndUpdate(
      novelId,
      { $set: updateFields },
      { new: true }
    );

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Novel updated",
      metadata: { novelId: String(novelId) },
    });

    if (isOliviaMemoryV2Enabled()) {
      // Tell the invalidator which fields actually changed so it can
      // skip the StoryState bump on cosmetic edits.
      const fieldsChanged = Object.keys(updateFields);
      memoryOnNovelEdit({ novelId: String(novelId), fieldsChanged });
    }

    return res
      .status(StatusCodes.OK)
      .json({ message: "Novel updated successfully" });
  } catch (error) {
    console.error("Update error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: error.message });
  }
};

export const getNovelDetails = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    let novel = await Novel.findById(novelId).lean();
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const storedWb = String(novel.worldBuilding || "").trim();
    const storedSe = String(novel.specialElements || "").trim();
    const storedWbLen = storedWb.length;
    const storedSeLen = storedSe.length;
    const hasMaster =
      novel.masterPrompt && String(novel.masterPrompt).trim().length > 0;

    // Backfill missing fields, or re-extract when stored text may be truncated (e.g. cut at
    // inline **bold** due to older section parsing). Skip parse when both blocks already look
    // substantial (avoids work on every GET for healthy novels).
    const suspectSeTruncated =
      storedSeLen > 0 && /:\s*$/.test(storedSe) && storedSeLen < 1200;
    const suspectWbTruncated =
      storedWbLen > 0 && /:\s*$/.test(storedWb) && storedWbLen < 1200;
    const looksFullyHydrated = storedWbLen >= 800 && storedSeLen >= 800;
    const shouldExtractWorldFields =
      hasMaster &&
      (!storedWbLen ||
        !storedSeLen ||
        suspectSeTruncated ||
        suspectWbTruncated ||
        !looksFullyHydrated);

    if (shouldExtractWorldFields) {
      const extracted = extractNovelDataFromResponse(novel.masterPrompt);
      const wb = extracted.worldBuilding?.trim() || "";
      const se = extracted.specialElements?.trim() || "";
      const sba =
        typeof extracted.storyBibleAuthor === "string"
          ? extracted.storyBibleAuthor.trim()
          : "";
      const patch = {};
      if (wb && (!storedWbLen || wb.length > storedWbLen)) patch.worldBuilding = wb;
      if (se && (!storedSeLen || se.length > storedSeLen)) patch.specialElements = se;
      if (
        sba &&
        !String(novel.storyBibleAuthor || "").trim()
      ) {
        patch.storyBibleAuthor = sba;
      }
      if (Object.keys(patch).length > 0) {
        await Novel.findByIdAndUpdate(novelId, patch);
        novel = { ...novel, ...patch };
      }
    }

    // Lazy-populate `storyBible` (dossier-free Story Bible) from `masterPrompt`
    // on first read. Every prompt-assembly path reads this field, so once it
    // exists the embedded 17-Point dossier section in `masterPrompt` can no
    // longer leak character ages or other stale dossier prose into Olivia's
    // context. Subsequent loads short-circuit.
    if (!String(novel.storyBible || "").trim() && hasMaster) {
      await ensureNovelStoryBible(novel);
    }

    const user = await User.findById(userId).select("fname lname").lean();
    const author = user ? `${user.fname} ${user.lname}` : "Unknown Author";

    // Heal any user-added scenes that lack a promptKey (legacy data added before
    // the distinct `user_*` namespace was introduced). Without this, the client
    // would fall through to a spine-pattern key (scene1…scene15) and saves
    // would collide with the Olivia-generated scene in the same slot.
    const unkeyed = await UserContent.find({
      novelId,
      isUserAdded: true,
      $or: [{ promptKey: { $exists: false } }, { promptKey: null }, { promptKey: "" }],
    }).select("_id");
    if (unkeyed.length > 0) {
      await UserContent.bulkWrite(
        unkeyed.map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { promptKey: `user_${doc._id}` } },
          },
        }))
      );
    }

    await healNovelSceneIndices(novelId, userId);

    if (novel.uploaded) {
      await consolidateUploadedManuscriptChapters({ novelId, userId });
    }

    const storyResponses = await StoryResponse.find({ novel: novelId })
      .select("promptKey responseText createdAt")
      .sort({ createdAt: 1 });

    const userContents = await UserContent.find({ novelId: novelId })
      .select(
        "promptKey userContent sceneTitle actNumber sceneIndex isUserAdded chapterNumber chapterSuffix chapterLabel pov timeline archivedAt updatedAt"
      )
      .sort({ createdAt: 1 });

    res.status(StatusCodes.OK).json({
      ...novel,
      storyResponses,
      userContents,
      author,
    });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const getNovelReviewDetails = async (req, res) => {
  try {
    const { novelId } = req.params;

    const novel = await Novel.findById(novelId).lean();
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const storyResponses = await StoryResponse.find({ novel: novelId })
      .select("promptKey responseText createdAt")
      .sort({ createdAt: 1 });

    const userContents = await UserContent.find({ novelId: novelId })
      .select(
        "promptKey userContent sceneTitle actNumber sceneIndex isUserAdded chapterNumber chapterSuffix chapterLabel pov timeline archivedAt updatedAt"
      )
      .sort({ createdAt: 1 });

    const reviews = await ReviewPillar.find({ novelId: novelId }).sort({
      createdAt: 1,
    });

    res
      .status(StatusCodes.OK)
      .json({ ...novel, storyResponses, userContents, reviews });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Dashboard threads only — excludes Book Editor Olivia threads and Ellis
 * per-manuscript threads (same rules as getUserNovels).
 */
const DASHBOARD_THREAD_EXCLUDE_FILTER = {
  $nor: [
    {
      agentName: {
        $in: [
          "olivia_editor",
          "olivia_scene_chat",
          "olivia_coaching",
          "ellis_editor",
          "ellis_editorial_letter",
        ],
      },
    },
    { threadId: { $regex: /^thread_olivia_(editor|scene|coaching)_/ } },
    { threadId: { $regex: /^thread_ellis_(editor|letter)_/ } },
  ],
};

const DASHBOARD_THREAD_BASE_FILTER = {
  $and: [
    {
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    },
    DASHBOARD_THREAD_EXCLUDE_FILTER,
    {
      $or: [
        { agentName: "simone" },
        { agentName: "olivia" },
        { assistantName: "Olivia" },
      ],
    },
  ],
};

function mapThreadToRecentWork(thread) {
  const isSimone = thread.agentName === "simone";
  const isOlivia =
    thread.agentName === "olivia" || thread.assistantName === "Olivia";
  const kind = isSimone ? "simone" : isOlivia ? "olivia" : null;
  if (!kind) return null;
  return {
    kind,
    _id: thread._id,
    threadId: thread.threadId || String(thread._id),
    name: thread.title || "Untitled",
    updatedAt: thread.updatedAt,
  };
}

function mapNovelToRecentWork(novel) {
  return {
    kind: novel.uploaded ? "ellis" : "novel",
    _id: novel._id,
    name: novel.name,
    uploaded: !!novel.uploaded,
    status: novel.status || null,
    updatedAt: novel.updatedAt,
  };
}

function toLegacyNovelPayload(work) {
  if (!work || (work.kind !== "novel" && work.kind !== "ellis")) return null;
  return {
    _id: work._id,
    name: work.name,
    updatedAt: work.updatedAt,
    uploaded: !!work.uploaded,
  };
}

async function resolveLastOpenedWork(lastOpened, userId) {
  if (!lastOpened?.resourceId || !lastOpened?.kind) return null;

  if (lastOpened.kind === "simone" || lastOpened.kind === "olivia") {
    const thread = await Thread.findOne({
      _id: lastOpened.resourceId,
      userId,
      ...DASHBOARD_THREAD_BASE_FILTER,
    })
      .select("_id threadId title agentName assistantName updatedAt")
      .lean();
    if (!thread) return null;
    const mapped = mapThreadToRecentWork(thread);
    if (!mapped || mapped.kind !== lastOpened.kind) return null;
    return {
      ...mapped,
      name: lastOpened.name || mapped.name,
      openedAt: lastOpened.openedAt || null,
    };
  }

  const novel = await Novel.findOne({
    _id: lastOpened.resourceId,
    user: userId,
  })
    .select("_id name updatedAt uploaded status")
    .lean();
  if (!novel) return null;
  const mapped = mapNovelToRecentWork(novel);
  const expectedKind = novel.uploaded ? "ellis" : "novel";
  if (expectedKind !== lastOpened.kind) return null;
  return {
    ...mapped,
    name: lastOpened.name || mapped.name,
    openedAt: lastOpened.openedAt || null,
  };
}

async function getMostRecentlyUpdatedWork(userId) {
  const [recentNovel, recentThread] = await Promise.all([
    Novel.findOne({ user: userId })
      .select("_id name updatedAt uploaded status")
      .sort({ updatedAt: -1 })
      .lean(),
    Thread.findOne({ userId, ...DASHBOARD_THREAD_BASE_FILTER })
      .select("_id threadId title agentName assistantName updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const novelWork = recentNovel ? mapNovelToRecentWork(recentNovel) : null;
  const threadWork = recentThread ? mapThreadToRecentWork(recentThread) : null;

  if (!novelWork) return threadWork;
  if (!threadWork) return novelWork;

  const novelTs = new Date(novelWork.updatedAt || 0).getTime();
  const threadTs = new Date(threadWork.updatedAt || 0).getTime();
  return threadTs >= novelTs ? threadWork : novelWork;
}

/**
 * Most recently opened (or updated) project for the logged-in user — drives
 * the dashboard "Your recent work" banner across novels, Simone, Olivia, and Ellis.
 */
export const getMostRecentNovel = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("lastOpenedWork").lean();

    let work = null;
    if (user?.lastOpenedWork?.resourceId) {
      work = await resolveLastOpenedWork(user.lastOpenedWork, userId);
    }
    if (!work) {
      work = await getMostRecentlyUpdatedWork(userId);
    }

    return res.status(StatusCodes.OK).json({
      work: work || null,
      novel: toLegacyNovelPayload(work),
    });
  } catch (error) {
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Record which project the user last opened so the dashboard can resume it.
 */
export const recordRecentWorkAccess = async (req, res) => {
  try {
    const userId = req.user._id;
    const { kind, resourceId, threadId, name, uploaded, status } = req.body;

    if (!kind || !resourceId || !name || !String(name).trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "kind, resourceId, and name are required",
      });
    }

    const allowedKinds = new Set(["novel", "simone", "olivia", "ellis"]);
    if (!allowedKinds.has(kind)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid kind" });
    }

    if (kind === "simone" || kind === "olivia") {
      const thread = await Thread.findOne({
        _id: resourceId,
        userId,
        ...DASHBOARD_THREAD_BASE_FILTER,
      })
        .select("_id threadId title agentName assistantName")
        .lean();
      if (!thread) {
        return res.status(StatusCodes.NOT_FOUND).json({ error: "Thread not found" });
      }
      const mapped = mapThreadToRecentWork(thread);
      if (!mapped || mapped.kind !== kind) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid thread kind" });
      }
    } else {
      const novel = await Novel.findOne({ _id: resourceId, user: userId })
        .select("_id name uploaded status")
        .lean();
      if (!novel) {
        return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
      }
      const expectedKind = novel.uploaded ? "ellis" : "novel";
      if (expectedKind !== kind) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid novel kind" });
      }
    }

    await User.findByIdAndUpdate(userId, {
      lastOpenedWork: {
        kind,
        resourceId,
        threadId: threadId || null,
        name: String(name).trim().slice(0, 200),
        uploaded: !!uploaded,
        status: status || null,
        openedAt: new Date(),
      },
    });

    return res.status(StatusCodes.OK).json({ ok: true });
  } catch (error) {
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const getUserNovels = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);
    const agent = req.query.agent;

    const isPaginated = !isNaN(page) && !isNaN(limit) && page > 0 && limit > 0;

    // Fields the card UI actually needs — excludes heavy unused fields (bookIdea omitted: large text, not needed for list cards)
    const NOVEL_CARD_FIELDS = "_id name status pinned createdAt threadId uploaded";
    const THREAD_CARD_FIELDS = "_id title assistantName agentName threadId pinned createdAt";

    const activeThreadBase = {
      userId,
      $or: [
        { isActive: true },
        { isActive: { $exists: false } },
      ],
    };

    /**
     * Book Editor Olivia threads (layering, scene chat, Office 3 coaching) must not appear in dashboard lists.
     * Scene/coaching threads may use assistantName "Olivia" and would match the Olivia tab without this filter.
     */
    const excludeBookEditorOliviaThreads = {
      $nor: [
        {
          agentName: {
            $in: ["olivia_editor", "olivia_scene_chat", "olivia_coaching"],
          },
        },
        { threadId: { $regex: /^thread_olivia_(editor|scene|coaching)_/ } },
      ],
    };

    /**
     * Ellis per-manuscript threads (Ask Ellis, editorial letter refine) — internal to an uploaded novel.
     * The Novel (uploaded: true) is the dashboard Ellis project, not these threads.
     */
    const excludeEllisManuscriptThreads = {
      $nor: [
        { agentName: { $in: ["ellis_editor", "ellis_editorial_letter"] } },
        { threadId: { $regex: /^thread_ellis_(editor|letter)_/ } },
      ],
    };

    const excludeInternalEditorThreads = {
      $and: [excludeBookEditorOliviaThreads, excludeEllisManuscriptThreads],
    };

    const buildQueries = async () => {
      if (agent === "simone") {
        const threadFilter = { ...activeThreadBase, agentName: "simone" };
        return {
          novelQuery: null,
          threadQuery: threadFilter,
        };
      }
      if (agent === "olivia") {
        const threadFilter = {
          $and: [
            activeThreadBase,
            { $or: [{ agentName: "olivia" }, { assistantName: "Olivia" }] },
            excludeInternalEditorThreads,
          ],
        };
        return {
          novelQuery: null,
          threadQuery: threadFilter,
        };
      }
      if (agent === "ellis") {
        const ellisNovelIds = await EllisSceneReview.distinct("novel", { user: userId });
        return {
          novelQuery: {
            user: userId,
            $or: [
              ...(ellisNovelIds.length ? [{ _id: { $in: ellisNovelIds } }] : []),
              { uploaded: true },
            ],
          },
          threadQuery: null,
        };
      }
      if (agent === "novels") {
        return {
          novelQuery: { user: userId, uploaded: { $ne: true } },
          threadQuery: null,
        };
      }
      return {
        novelQuery: { user: userId },
        threadQuery: {
          $and: [activeThreadBase, excludeInternalEditorThreads],
        },
      };
    };

    const { novelQuery, threadQuery } = await buildQueries();
    // Captured idea notepads appear on the All tab (and unfiltered list) only.
    const includeIdeas = !agent || agent === "all";
    const ideaQuery = includeIdeas ? { user: userId } : null;

    const mapIdeaToCard = (idea) => ({
      _id: idea._id,
      name: idea.title || "Untitled Idea",
      title: idea.title || "Untitled Idea",
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
      pinned: false,
      isIdea: true,
    });

    const sortMergedCards = (a, b) => {
      const pinnedA = a.pinned ? 1 : 0;
      const pinnedB = b.pinned ? 1 : 0;
      if (pinnedB !== pinnedA) return pinnedB - pinnedA;
      return new Date(b.createdAt) - new Date(a.createdAt);
    };

    if (!isPaginated) {
      const [novels, threads, ideas] = await Promise.all([
        novelQuery
          ? Novel.find(novelQuery)
              .select(NOVEL_CARD_FIELDS)
              .sort({ pinned: -1, createdAt: -1 })
          : Promise.resolve([]),
        threadQuery
          ? Thread.find(threadQuery)
              .select(THREAD_CARD_FIELDS)
              .sort({ createdAt: -1 })
          : Promise.resolve([]),
        ideaQuery
          ? Idea.find(ideaQuery)
              .select("title createdAt updatedAt")
              .sort({ updatedAt: -1 })
              .lean()
          : Promise.resolve([]),
      ]);

      const merged = [
        ...novels,
        ...threads,
        ...ideas.map(mapIdeaToCard),
      ].sort(sortMergedCards);

      return res.status(StatusCodes.OK).json(merged);
    }

    const [totalNovels, totalThreads, totalIdeas] = await Promise.all([
      novelQuery ? Novel.countDocuments(novelQuery) : Promise.resolve(0),
      threadQuery ? Thread.countDocuments(threadQuery) : Promise.resolve(0),
      ideaQuery ? Idea.countDocuments(ideaQuery) : Promise.resolve(0),
    ]);

    const total = totalNovels + totalThreads + totalIdeas;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.min(Math.max(1, page), totalPages);
    const skip = (safePage - 1) * limit;
    // Merged list needs at most (skip+limit) items from each sorted source; use safePage*limit not page*limit.
    const fetchLimit = safePage * limit;

    const [novels, threads, ideas] = await Promise.all([
      novelQuery
        ? Novel.find(novelQuery)
            .select(NOVEL_CARD_FIELDS)
            .sort({ pinned: -1, createdAt: -1 })
            .limit(fetchLimit)
        : Promise.resolve([]),
      threadQuery
        ? Thread.find(threadQuery)
            .select(THREAD_CARD_FIELDS)
            .sort({ pinned: -1, createdAt: -1 })
            .limit(fetchLimit)
        : Promise.resolve([]),
      ideaQuery
        ? Idea.find(ideaQuery)
            .select("title createdAt updatedAt")
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(fetchLimit)
            .lean()
        : Promise.resolve([]),
    ]);

    const merged = [
      ...novels,
      ...threads,
      ...ideas.map(mapIdeaToCard),
    ].sort(sortMergedCards);

    const results = merged.slice(skip, skip + limit);

    res.status(StatusCodes.OK).json({
      data: results,
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * First non-empty line, stripped of simple markdown bold — for Novel.protagonist / .antagonist labels.
 */
const castNameFromNovelField = (value) => {
  if (!value || typeof value !== "string") return "";
  const line = value.split(/\r?\n/).find((l) => l.trim()) || "";
  return line.replace(/^\*+|\*+$/g, "").trim().slice(0, 300);
};

/**
 * When no Character documents exist (e.g. novel created without parsed 17-point dossiers),
 * expose protagonist / antagonist / supporting cast from Novel fields so the Character tab is useful.
 */
/** Shorten extracted "Role in the Story" to core label (e.g. "Protagonist") */
const shortRoleForAccordionHeader = (roleInStory, characterType) => {
  const fallback =
    characterType === "protagonist"
      ? "Protagonist"
      : characterType === "antagonist"
        ? "Antagonist"
        : "Supporting";
  if (!roleInStory || typeof roleInStory !== "string") return fallback;
  const trimmed = roleInStory.trim();
  if (!trimmed) return fallback;
  const beforeSemicolon = trimmed.split(";")[0].trim();
  const label = beforeSemicolon.split(/\b(?:whose|who|that|which|and|with)\b/i)[0].replace(/[,\s]+$/, "").trim();
  return label || fallback;
};

const buildFallbackCastFromNovel = (novel, novelId) => {
  const out = [];
  const idPrefix = `cast-${String(novelId)}`;

  const pName = castNameFromNovelField(novel.protagonist);
  if (pName) {
    out.push({
      _id: `${idPrefix}-protagonist`,
      novel: novelId,
      name: pName,
      character: "protagonist",
      role: novel.protagonistDescription ? castNameFromNovelField(novel.protagonistDescription).slice(0, 120) : undefined,
      responseText: novel.protagonistDescription?.trim() || "",
      syntheticFromNovel: true,
    });
  }

  const aName = castNameFromNovelField(novel.antagonist);
  if (aName) {
    const motivation = novel.antagonistMotivation?.trim() || "";
    out.push({
      _id: `${idPrefix}-antagonist`,
      novel: novelId,
      name: aName,
      character: "antagonist",
      role: motivation ? motivation.slice(0, 120) : undefined,
      responseText: motivation,
      syntheticFromNovel: true,
    });
  }

  const supporting = Array.isArray(novel.supportingCharacters) ? novel.supportingCharacters : [];
  supporting.forEach((sc, idx) => {
    const name = (sc?.name && String(sc.name).trim()) || "";
    if (!name) return;
    const bits = [sc.role, sc.significance].filter(Boolean).join(" — ");
    out.push({
      _id: `${idPrefix}-supporting-${idx}`,
      novel: novelId,
      name,
      character: "supporting character",
      role: sc.role || undefined,
      responseText: bits || "",
      syntheticFromNovel: true,
    });
  });

  return out;
};

export const getAllCharacters = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    // Prefer persisted Character documents so edits hit the DB directly (single source of truth).
    // One-shot lazy heal from masterPrompt, then latch `characterDossiersHydrated` so later
    // writer deletes are not resurrected on the next list fetch.
    // Last resort: synthetic cast built from the Novel's own fields.
    let characters = await Character.find({ novel: novelId }).lean();

    const fromMaster = extractCharacterDossierBlocksFromMasterPrompt(novel.masterPrompt || "");
    if (!novel.characterDossiersHydrated) {
      if (fromMaster.length > characters.length) {
        for (const entry of fromMaster) {
          await safeUpsertDossierCharacter(novelId, entry);
        }
        characters = await Character.find({ novel: novelId }).lean();
      }
      await Novel.updateOne(
        { _id: novelId },
        { $set: { characterDossiersHydrated: true } }
      );
    }

    // Cleanup only true Olivia double-emits (section-1 AND Summary Note both appear twice).
    // Writer-imported bios that mention "1. Archetype" again must not be truncated.
    const freshByName = new Map();
    for (const entry of fromMaster) {
      const key = (entry.name || "").trim().toLowerCase();
      if (key) freshByName.set(key, entry);
    }
    let dirty = false;
    for (const c of characters) {
      if (!c.responseText || !isOliviaDuplicatedDossier(c.responseText)) continue;

      const normalized = normalizeDossierText(c.responseText);
      if (normalized && normalized !== c.responseText) {
        await Character.updateOne(
          { _id: c._id },
          { $set: { responseText: normalized } }
        );
        c.responseText = normalized;
        dirty = true;
      }

      if (isOliviaDuplicatedDossier(c.responseText)) {
        const fresh = freshByName.get((c.name || "").trim().toLowerCase());
        if (
          fresh &&
          fresh.dossierText &&
          !isOliviaDuplicatedDossier(fresh.dossierText)
        ) {
          await Character.updateOne(
            { _id: c._id },
            { $set: { responseText: fresh.dossierText } }
          );
          c.responseText = fresh.dossierText;
          dirty = true;
        }
      }
    }
    if (dirty) {
      characters = await Character.find({ novel: novelId }).lean();
    }

    if (!characters.length) {
      characters = buildFallbackCastFromNovel(novel, novelId);
    } else {
      characters = sortCharactersByUserOrder(characters);
    }

    res.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.status(StatusCodes.OK).json({ characters: characters || [] });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const getCharacterDetails = async (req, res) => {
  try {
    const { characterId } = req.params;

    const character = await Character.findById(characterId).lean();

    if (!character) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Character not found" });
    }

    res.status(StatusCodes.OK).json({ character });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const saveUserContent = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, userContent, expectedUpdatedAt: expectedRaw, force } = req.body;

    let expectedUpdatedAt = null;
    if (expectedRaw != null && expectedRaw !== "") {
      expectedUpdatedAt = parseExpectedUpdatedAt(expectedRaw);
      if (expectedUpdatedAt === undefined) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ message: "expectedUpdatedAt is invalid" });
      }
    }

    const filter = buildUserContentSaveFilter({
      id,
      userId,
      expectedUpdatedAt,
      force: Boolean(force),
    });

    const updatedContent = await UserContent.findOneAndUpdate(
      filter,
      { userContent },
      { new: true }
    );

    if (!updatedContent) {
      const current = await UserContent.findOne({ _id: id, user: userId });
      const miss = classifyUserContentSaveMiss({
        current,
        expectedUpdatedAt,
        force: Boolean(force),
      });
      if (miss === "stale") {
        return res.status(StatusCodes.CONFLICT).json({
          code: STALE_CONTENT_CODE,
          message: "Content was updated on another device",
          userContent: current.userContent,
          updatedAt: current.updatedAt,
        });
      }
      return res
        .status(404)
        .json({ message: "Content not found or unauthorized" });
    }

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "User scene content saved",
      metadata: { contentId: String(id), novelId: String(updatedContent.novelId) },
    });

    // Draft prose (Drafting Space) is persisted only — SceneMemory workers run
    // on outline paths (saveOliviaScene, insertLayeredScene), not here.

    res.status(200).json({
      message: "Your response has been saved successfully",
      userContent: updatedContent.userContent,
      updatedAt: updatedContent.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getUserContentById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const doc = await UserContent.findOne({ _id: id, user: userId })
      .select("userContent updatedAt")
      .lean();

    if (!doc) {
      return res.status(404).json({ message: "No saved content found" });
    }

    res.status(200).json({
      userContent: doc.userContent,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getUserContent = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, promptKey } = req.params;

    const userContent = await UserContent.findOne({
      novelId,
      user: userId,
      promptKey,
    });

    if (!userContent) {
      return res.status(404).json({ message: "No saved content found" });
    }

    res.status(200).json({ userContent });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const renameScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id, sceneTitle } = req.body;

    const trimmedTitle = typeof sceneTitle === "string" ? sceneTitle.trim() : "";
    if (!trimmedTitle) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Scene title is required" });
    }

    const scene = await UserContent.findOne({ _id: id, user: userId }).lean();
    if (!scene) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Scene not found" });
    }

    const { finalTitle, titleWasRenamed } = await resolveUniqueSceneTitle({
      novelId: scene.novelId,
      userId,
      desiredTitle: trimmedTitle,
      excludeSceneId: id,
    });

    // When the writer renames to a lettered chapter title, keep chapterSuffix in sync.
    const headerMeta = matchChapterHeader(finalTitle);
    const renameUpdate = {
      sceneTitle: finalTitle,
      // Uploaded manuscripts also surface chapterLabel in Ellis map/Q&A —
      // keep it in sync with the writer's rename.
      ...(scene.chapterNumber != null ? { chapterLabel: finalTitle } : {}),
    };
    if (
      scene.chapterNumber != null &&
      headerMeta?.chapterSuffix &&
      Number(headerMeta.chapterNumber) === Number(scene.chapterNumber)
    ) {
      renameUpdate.chapterSuffix = normalizeChapterSuffix(
        headerMeta.chapterSuffix
      );
    }

    await UserContent.findOneAndUpdate(
      { _id: id, user: userId },
      renameUpdate,
      { new: true }
    );

    const promptKey = scene.promptKey || null;
    let responseText;

    if (promptKey) {
      const storyResponse = await StoryResponse.findOne({
        novel: scene.novelId,
        user: userId,
        promptKey,
      });
      if (storyResponse?.responseText) {
        const patched = replaceSceneTitleInResponseText(
          storyResponse.responseText,
          finalTitle
        );
        if (patched !== storyResponse.responseText) {
          await StoryResponse.findOneAndUpdate(
            { novel: scene.novelId, user: userId, promptKey },
            { responseText: patched }
          );
        }
        responseText = patched;
      }
    }

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Scene renamed",
      metadata: { sceneContentId: String(id) },
    });

    if (isOliviaMemoryV2Enabled()) {
      memoryOnSceneRename({
        novelId: scene.novelId,
        sceneRef: {
          actNumber: scene.actNumber,
          sceneIndex: scene.sceneIndex,
          promptKey: scene.promptKey || promptKey || undefined,
        },
        newTitle: finalTitle,
      });
    }

    res.status(200).json({
      message: "Your response has been saved successfully",
      finalTitle,
      titleWasRenamed,
      ...(promptKey && responseText != null ? { promptKey, responseText } : {}),
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

const legacyNoteFilter = {
  $or: [{ userContentId: null }, { userContentId: { $exists: false } }],
};

export const addNote = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, note, userContentId, promptKey } = req.body;

    const filter = { novelId, user: userId };
    if (userContentId) {
      filter.userContentId = userContentId;
    } else {
      filter.$or = legacyNoteFilter.$or;
    }

    const update = { note };
    if (userContentId) {
      update.userContentId = userContentId;
    }
    if (promptKey) {
      update.promptKey = promptKey;
    }

    await Notes.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: userContentId ? "Scene note saved" : "Novel note saved",
      metadata: {
        novelId: String(novelId),
        ...(userContentId && { userContentId: String(userContentId) }),
      },
    });
    res.status(200).json({ message: "Note saved successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getNote = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;
    const { userContentId } = req.query;

    if (userContentId) {
      const sceneNote = await Notes.findOne({
        novelId,
        user: userId,
        userContentId,
      });

      return res.status(200).json({
        message: "Note retrieved successfully",
        note: sceneNote || null,
        isLegacyFallback: false,
      });
    }

    const note = await Notes.findOne({
      novelId,
      user: userId,
      ...legacyNoteFilter,
    });

    res.status(200).json({
      message: "Note retrieved successfully",
      note,
      isLegacyFallback: false,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const addScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, actNumber, sceneIndex: clientSceneIndex, sceneTitle } = req.body;

    const trimmedTitle = typeof sceneTitle === "string" ? sceneTitle.trim() : "";
    if (!trimmedTitle) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Scene title is required" });
    }

    const act = normalizeActNumber(actNumber);
    const finalSceneIndex = await nextSceneIndexForAct(novelId, userId, act);
    if (
      clientSceneIndex != null &&
      Number(clientSceneIndex) !== finalSceneIndex
    ) {
      console.warn(
        `addScene: client sceneIndex ${clientSceneIndex} overridden with ${finalSceneIndex} for novel ${novelId} act ${act}`
      );
    }

    const { finalTitle, titleWasRenamed } = await resolveUniqueSceneTitle({
      novelId,
      userId,
      desiredTitle: trimmedTitle,
    });

    // Distinct "user_*" namespace so the promptKey can NEVER collide with the
    // spine's 1-indexed keys (scene1…scene15) or the synthetic layering keys
    // (scene{act}_{idx}). If we reused those patterns, a Scene Design save for
    // a user-added scene at Act 1 Scene 2 would overwrite the spine's `scene2`
    // StoryResponse and bleed into the Olivia-generated scene.
    const created = new UserContent({
      novelId,
      user: userId,
      sceneTitle: finalTitle,
      sceneIndex: finalSceneIndex,
      actNumber: act,
      userContent: "",
      isUserAdded: true,
    });
    created.promptKey = `user_${created._id}`;
    await created.save();

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "User-added scene created",
      metadata: { novelId: String(novelId), promptKey: created.promptKey },
    });
    res.status(StatusCodes.CREATED).json({
      message: "Scene added successfully",
      scene: created,
      titleWasRenamed,
      finalTitle,
      finalSceneIndex,
    });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const deleteScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Scene not found" });
    }

    const { novelId, promptKey, actNumber, sceneIndex } = scene;

    const now = new Date();
    await UserContent.updateOne(
      { _id: id, user: userId },
      { $set: { deletedAt: now } }
    );
    await StoryResponse.updateOne(
      { novel: novelId, user: userId, promptKey },
      { $set: { deletedAt: now } }
    );

    // Re-index later active scenes in the same act to close the gap
    const laterScenes = await UserContent.find({
      novelId,
      user: userId,
      actNumber,
      archivedAt: null,
      sceneIndex: { $gt: sceneIndex },
    }).sort({ sceneIndex: 1 });

    for (const s of laterScenes) {
      s.sceneIndex -= 1;
      await s.save();
    }

    await healActSceneIndices(novelId, userId, actNumber);
    await syncExtraSlotPromptKeys(novelId, userId, actNumber);

    queueActivityLog({
      req,
      userId,
      action: "delete",
      module: "novel",
      description: "Scene deleted",
      metadata: { novelId: String(novelId), sceneId: String(id) },
    });

    if (isOliviaMemoryV2Enabled()) {
      const openaiKey = await getSharedOpenAIKey().catch(() => null);
      memoryOnSceneDelete({
        novelId: String(novelId),
        sceneRef: { actNumber, sceneIndex, promptKey },
        openaiKey,
      });
    }

    res.status(StatusCodes.OK).json({ success: true });
  } catch (error) {
    console.error("deleteScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const archiveScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Scene not found" });
    }
    if (scene.archivedAt) {
      return res.status(StatusCodes.OK).json({ message: "Scene archived", scene });
    }

    const novelId = scene.novelId;
    const actNumber = Number(scene.actNumber) || 1;
    const archivedIndex = Number(scene.sceneIndex);

    scene.archivedFromActNumber = actNumber;
    scene.archivedFromSceneIndex = Number.isFinite(archivedIndex)
      ? archivedIndex
      : null;
    scene.archivedAt = new Date();
    await scene.save();

    if (Number.isFinite(archivedIndex)) {
      await UserContent.updateMany(
        {
          novelId,
          user: userId,
          actNumber,
          archivedAt: null,
          sceneIndex: { $gt: archivedIndex },
          _id: { $ne: scene._id },
        },
        { $inc: { sceneIndex: -1 } }
      );
    }

    await healActSceneIndices(novelId, userId, actNumber);
    await syncExtraSlotPromptKeys(novelId, userId, actNumber);

    invalidateAssemblerCache((key) => key.startsWith(`${String(novelId)}|`));
    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Scene archived",
      metadata: { novelId: String(novelId), sceneId: String(id) },
    });
    res.status(StatusCodes.OK).json({ message: "Scene archived", scene });
  } catch (error) {
    console.error("archiveScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const unarchiveScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Scene not found" });
    }
    if (!scene.archivedAt) {
      return res.status(StatusCodes.OK).json({ message: "Scene restored", scene });
    }

    const novelId = scene.novelId;
    const targetAct =
      Number(scene.archivedFromActNumber) ||
      Number(scene.actNumber) ||
      1;
    // Prefer stashed slot; legacy archives (no archivedFrom*) still hold the
    // original index on sceneIndex — Number(null) is 0, so treat null/undefined
    // as missing and fall back to the live sceneIndex before appending.
    const fromStash = scene.archivedFromSceneIndex;
    const fromLive = scene.sceneIndex;
    const savedIndex =
      fromStash != null && Number.isFinite(Number(fromStash))
        ? Number(fromStash)
        : fromLive != null && Number.isFinite(Number(fromLive))
          ? Number(fromLive)
          : NaN;
    const appendIndex = await nextSceneIndexForAct(novelId, userId, targetAct);
    let targetIndex = Number.isFinite(savedIndex) ? savedIndex : appendIndex;
    if (targetIndex < 1 || targetIndex > appendIndex) {
      targetIndex = appendIndex;
    }

    await UserContent.updateMany(
      {
        novelId,
        user: userId,
        actNumber: targetAct,
        archivedAt: null,
        sceneIndex: { $gte: targetIndex },
        _id: { $ne: scene._id },
      },
      { $inc: { sceneIndex: 1 } }
    );

    scene.actNumber = targetAct;
    scene.sceneIndex = targetIndex;
    scene.archivedAt = null;
    scene.archivedFromActNumber = null;
    scene.archivedFromSceneIndex = null;
    await scene.save();

    await healActSceneIndices(novelId, userId, targetAct);
    await syncExtraSlotPromptKeys(novelId, userId, targetAct);

    invalidateAssemblerCache((key) => key.startsWith(`${String(novelId)}|`));
    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Scene unarchived",
      metadata: { novelId: String(novelId), sceneId: String(id) },
    });
    res.status(StatusCodes.OK).json({ message: "Scene restored", scene });
  } catch (error) {
    console.error("unarchiveScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const reorderScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const { sceneId, newSceneIndex, newActNumber } = req.body;

    const targetScene = await UserContent.findOne({
      _id: sceneId,
      user: userId,
    });
    if (!targetScene) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Scene not found" });
    }

    const { sceneIndex: oldIndex, actNumber: oldActNumber, novelId } = targetScene;
    const destActNumber = newActNumber != null ? Number(newActNumber) : oldActNumber;
    const isCrossAct = destActNumber !== oldActNumber;

    if (!isCrossAct && oldIndex === newSceneIndex) {
      return res.status(StatusCodes.OK).json({ message: "No change needed" });
    }

    const operations = [];

    if (isCrossAct) {
      // Close the gap in the source act
      operations.push({
        updateMany: {
          filter: {
            novelId,
            user: userId,
            actNumber: oldActNumber,
            archivedAt: null,
            sceneIndex: { $gt: oldIndex },
          },
          update: { $inc: { sceneIndex: -1 } },
        },
      });
      // Make room in the destination act
      operations.push({
        updateMany: {
          filter: {
            novelId,
            user: userId,
            actNumber: destActNumber,
            archivedAt: null,
            sceneIndex: { $gte: newSceneIndex },
          },
          update: { $inc: { sceneIndex: 1 } },
        },
      });
      // Move the scene to the new act and position
      operations.push({
        updateOne: {
          filter: { _id: sceneId },
          update: {
            actNumber: destActNumber,
            sceneIndex: newSceneIndex,
          },
        },
      });
    } else {
      // Same-act reorder (original logic)
      if (oldIndex < newSceneIndex) {
        operations.push({
          updateMany: {
            filter: {
              novelId,
              user: userId,
              actNumber: oldActNumber,
              archivedAt: null,
              sceneIndex: { $gt: oldIndex, $lte: newSceneIndex },
            },
            update: { $inc: { sceneIndex: -1 } },
          },
        });
      } else {
        operations.push({
          updateMany: {
            filter: {
              novelId,
              user: userId,
              actNumber: oldActNumber,
              archivedAt: null,
              sceneIndex: { $gte: newSceneIndex, $lt: oldIndex },
            },
            update: { $inc: { sceneIndex: 1 } },
          },
        });
      }
      operations.push({
        updateOne: {
          filter: { _id: sceneId },
          update: {
            sceneIndex: newSceneIndex,
          },
        },
      });
    }

    await UserContent.bulkWrite(operations);

    const actsToFix = isCrossAct
      ? [oldActNumber, destActNumber]
      : [oldActNumber];

    for (const actNum of actsToFix) {
      await healActSceneIndices(novelId, userId, actNum);
      await syncExtraSlotPromptKeys(novelId, userId, actNum);
    }

    invalidateAssemblerCache((key) => key.startsWith(`${String(novelId)}|`));

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: isCrossAct ? "Scene moved to another act" : "Scene reordered",
      metadata: { novelId: String(novelId), sceneId: String(sceneId) },
    });
    res
      .status(StatusCodes.OK)
      .json({ message: "Scene reordered successfully" });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Add a blank chapter to an uploaded manuscript (Ellis Manuscript Map).
 * Body: { novelId, sceneTitle?, afterChapterId? }
 * Inserts at end by default, or immediately after afterChapterId.
 * Renumbers chapterNumber / sceneIndex for subsequent chapters.
 */
export const addUploadedChapter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, sceneTitle, afterChapterId } = req.body;

    if (!novelId) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "novelId is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("uploaded")
      .lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }
    if (!novel.uploaded) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Chapter add is only supported for uploaded manuscripts",
      });
    }

    const allRows = await UserContent.find({ novelId, user: userId }).lean();
    const { getUploadedChapterRows } = await import(
      "../utils/uploadedChapterRows.js"
    );
    const chapters = getUploadedChapterRows(allRows);

    let insertAt = chapters.length;
    if (afterChapterId) {
      const afterIdx = chapters.findIndex(
        (c) => String(c._id) === String(afterChapterId)
      );
      if (afterIdx >= 0) insertAt = afterIdx + 1;
    }

    const trimmedTitle =
      typeof sceneTitle === "string" ? sceneTitle.trim() : "";
    const chapterNumber = insertAt + 1;
    const defaultLabel = `Chapter ${chapterNumber}`;
    const { finalTitle, titleWasRenamed } = await resolveUniqueSceneTitle({
      novelId,
      userId,
      desiredTitle: trimmedTitle || defaultLabel,
    });
    const finalLabel = finalTitle;

    const created = new UserContent({
      novelId,
      user: userId,
      sceneTitle: finalLabel,
      chapterLabel: finalLabel,
      chapterNumber,
      chapterSuffix: null,
      sceneIndex: chapterNumber,
      userContent: "",
      isUserAdded: true,
    });
    created.promptKey = `user_chapter_${created._id}`;
    await created.save();

    // Renumber existing chapters that shift right of the insert point.
    const {
      buildEllisAddChapterRemap,
      remapEllisReviewNumbers,
      remapEllisReviewMessageChapterNumbers,
    } = await import("../service/remapEllisReviewsAfterReorder.js");
    const remapPairs = buildEllisAddChapterRemap(
      chapters.slice(insertAt),
      insertAt
    );
    const ops = remapPairs.map((m) => ({
      updateOne: {
        filter: { _id: m.chapterId, user: userId },
        update: {
          chapterNumber: m.newNumber,
          sceneIndex: m.newNumber,
        },
      },
    }));
    if (remapPairs.length) {
      await remapEllisReviewNumbers({
        EllisChapterReview,
        novelId,
        userId,
        remap: remapPairs,
      });
      await remapEllisReviewMessageChapterNumbers({ remap: remapPairs });
    }
    if (ops.length) await UserContent.bulkWrite(ops);

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "User-added uploaded chapter created",
      metadata: { novelId: String(novelId), chapterId: String(created._id) },
    });

    res.status(StatusCodes.CREATED).json({
      message: "Chapter added successfully",
      chapter: created,
      chapterNumber,
      finalTitle: finalLabel,
      titleWasRenamed,
    });
  } catch (error) {
    console.error("addUploadedChapter error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Reorder a chapter in an uploaded manuscript by moving it before another
 * chapter (or to the end). Renumbers chapterNumber / sceneIndex 1..N and
 * remaps EllisChapterReview.chapterNumber to follow the same order.
 * Body: { novelId, chapterId, beforeChapterId? } — omit beforeChapterId to move to end.
 */
export const reorderUploadedChapter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, chapterId, beforeChapterId } = req.body;

    if (!novelId || !chapterId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "novelId and chapterId are required",
      });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("uploaded")
      .lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }
    if (!novel.uploaded) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Chapter reorder is only supported for uploaded manuscripts",
      });
    }

    const allRows = await UserContent.find({ novelId, user: userId }).lean();
    const { getUploadedChapterRows } = await import(
      "../utils/uploadedChapterRows.js"
    );
    const chapters = getUploadedChapterRows(allRows);
    const fromIdx = chapters.findIndex(
      (c) => String(c._id) === String(chapterId)
    );
    if (fromIdx < 0) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Chapter not found" });
    }

    const [moved] = chapters.splice(fromIdx, 1);
    let toIdx = chapters.length;
    if (beforeChapterId) {
      const beforeIdx = chapters.findIndex(
        (c) => String(c._id) === String(beforeChapterId)
      );
      if (beforeIdx >= 0) toIdx = beforeIdx;
    }
    chapters.splice(toIdx, 0, moved);

    // chapters[] still carry OLD chapterNumber values — remap reviews before
    // UserContent renumber so the old→new map is accurate.
    const { remapEllisReviewsAfterChapterReorder } = await import(
      "../service/remapEllisReviewsAfterReorder.js"
    );
    await remapEllisReviewsAfterChapterReorder({
      EllisChapterReview,
      novelId,
      userId,
      orderedChapters: chapters,
    });

    const ops = chapters.map((row, i) => ({
      updateOne: {
        filter: { _id: row._id, user: userId },
        update: {
          chapterNumber: i + 1,
          sceneIndex: i + 1,
        },
      },
    }));
    if (ops.length) await UserContent.bulkWrite(ops);

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Uploaded chapter reordered",
      metadata: {
        novelId: String(novelId),
        chapterId: String(chapterId),
        newChapterNumber: toIdx + 1,
      },
    });

    res.status(StatusCodes.OK).json({
      message: "Chapter reordered successfully",
      chapterId: String(chapterId),
      newChapterNumber: toIdx + 1,
    });
  } catch (error) {
    console.error("reorderUploadedChapter error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Soft-delete an uploaded-manuscript chapter (sets UserContent.deletedAt).
 * Remaining chapters are renumbered 1..N and Ellis reviews follow that order.
 * Params: :id = UserContent _id
 */
export const deleteUploadedChapter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Chapter not found" });
    }

    const novelId = scene.novelId;
    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("uploaded")
      .lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }
    if (!novel.uploaded) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Chapter delete is only supported for uploaded manuscripts",
      });
    }

    const { getUploadedChapterRows } = await import(
      "../utils/uploadedChapterRows.js"
    );
    const allRows = await UserContent.find({ novelId, user: userId }).lean();
    const chapters = getUploadedChapterRows(allRows);
    const remaining = chapters.filter(
      (row) => String(row._id) !== String(scene._id)
    );

    const chapterSuffix = String(scene.chapterSuffix || "")
      .trim()
      .toUpperCase();
    const suffix = /^[A-Z]$/.test(chapterSuffix) ? chapterSuffix : "";

    // Free the unique (novel, chapterNumber, suffix) slot before remaining
    // reviews shift into this chapter's old number.
    await EllisChapterReview.deleteMany({
      novel: novelId,
      user: userId,
      $or: [
        { chapterId: scene._id },
        { chapterNumber: Number(scene.chapterNumber), chapterSuffix: suffix },
      ],
    });

    const { remapEllisReviewsAfterChapterReorder } = await import(
      "../service/remapEllisReviewsAfterReorder.js"
    );
    await remapEllisReviewsAfterChapterReorder({
      EllisChapterReview,
      novelId,
      userId,
      orderedChapters: remaining,
    });

    const now = new Date();
    await UserContent.updateOne(
      { _id: scene._id, user: userId },
      { $set: { deletedAt: now } }
    );
    if (scene.promptKey) {
      await StoryResponse.updateOne(
        { novel: novelId, user: userId, promptKey: scene.promptKey },
        { $set: { deletedAt: now } }
      );
    }

    const ops = remaining.map((row, i) => ({
      updateOne: {
        filter: { _id: row._id, user: userId },
        update: {
          chapterNumber: i + 1,
          sceneIndex: i + 1,
        },
      },
    }));
    if (ops.length) await UserContent.bulkWrite(ops);

    queueActivityLog({
      req,
      userId,
      action: "delete",
      module: "novel",
      description: "Uploaded chapter soft-deleted",
      metadata: { novelId: String(novelId), chapterId: String(id) },
    });

    res.status(StatusCodes.OK).json({ success: true });
  } catch (error) {
    console.error("deleteUploadedChapter error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

const assertUploadedNovel = async (novelId, userId, actionLabel) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId })
    .select("uploaded")
    .lean();
  if (!novel) {
    return { error: { status: StatusCodes.NOT_FOUND, message: "Novel not found" } };
  }
  if (!novel.uploaded) {
    return {
      error: {
        status: StatusCodes.BAD_REQUEST,
        message: `${actionLabel} is only supported for uploaded manuscripts`,
      },
    };
  }
  return { novel };
};

const compactUploadedChapterWrites = (assigned, userId) =>
  (assigned || []).map(({ row, chapterNumber, sceneIndex }) => ({
    updateOne: {
      filter: { _id: row._id, user: userId },
      update: { chapterNumber, sceneIndex },
    },
  }));

/**
 * Archive an uploaded-manuscript chapter (sets archivedAt, parks the Ellis
 * review off the unique-index number, compact-renumbers remaining narrative
 * chapters). Front matter (0, -1…) keeps its parser identity.
 * Params: :id = UserContent _id
 */
export const archiveUploadedChapter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Chapter not found" });
    }
    if (scene.archivedAt) {
      return res
        .status(StatusCodes.OK)
        .json({ message: "Chapter archived", chapter: scene });
    }

    const novelId = scene.novelId;
    const uploaded = await assertUploadedNovel(
      novelId,
      userId,
      "Chapter archive"
    );
    if (uploaded.error) {
      return res
        .status(uploaded.error.status)
        .json({ error: uploaded.error.message });
    }

    const allRows = await UserContent.find({ novelId, user: userId }).lean();
    const chapters = getUploadedChapterRows(allRows);
    const plan = planUploadedChapterArchive(chapters, scene._id);
    if (!plan) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Chapter not found" });
    }

    const originalNumber = Number(scene.chapterNumber);
    scene.archivedFromActNumber = Number.isFinite(Number(scene.actNumber))
      ? Number(scene.actNumber)
      : 1;
    scene.archivedFromSceneIndex = plan.archivedFromSceneIndex;
    scene.archivedAt = new Date();
    await scene.save();

    const parkedReviews = await EllisChapterReview.find({
      novel: novelId,
      chapterNumber: { $lte: PARKED_CHAPTER_NUMBER_BASE },
    })
      .select("chapterNumber")
      .lean();
    const parkedNumber = nextParkedChapterNumber(parkedReviews);
    const {
      remapEllisReviewNumbers,
      remapEllisReviewMessageChapterNumbers,
    } = await import("../service/remapEllisReviewsAfterReorder.js");

    const parkRemap = [
      {
        oldNumber: originalNumber,
        newNumber: parkedNumber,
        chapterSuffix: scene.chapterSuffix,
        chapterId: scene._id,
      },
    ];
    await remapEllisReviewNumbers({
      EllisChapterReview,
      novelId,
      userId,
      remap: parkRemap,
    });
    await remapEllisReviewMessageChapterNumbers({ remap: parkRemap });

    const assigned = assignCompactChapterNumbers(plan.remaining);
    const remainingRemap = buildCompactChapterRemap(assigned);
    await remapEllisReviewNumbers({
      EllisChapterReview,
      novelId,
      userId,
      remap: remainingRemap,
    });
    await remapEllisReviewMessageChapterNumbers({ remap: remainingRemap });

    const ops = compactUploadedChapterWrites(assigned, userId);
    if (ops.length) await UserContent.bulkWrite(ops);

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Uploaded chapter archived",
      metadata: { novelId: String(novelId), chapterId: String(id) },
    });

    res.status(StatusCodes.OK).json({ message: "Chapter archived", chapter: scene });
  } catch (error) {
    console.error("archiveUploadedChapter error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Restore an archived uploaded-manuscript chapter to its original Map slot
 * (append if that slot is past the end). Front matter keeps 0/-1; narrative
 * compact 1..N. Params: :id = UserContent _id
 */
export const unarchiveUploadedChapter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const scene = await UserContent.findOne({ _id: id, user: userId });
    if (!scene) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Chapter not found" });
    }
    if (!scene.archivedAt) {
      return res
        .status(StatusCodes.OK)
        .json({ message: "Chapter restored", chapter: scene });
    }

    const novelId = scene.novelId;
    const uploaded = await assertUploadedNovel(
      novelId,
      userId,
      "Chapter restore"
    );
    if (uploaded.error) {
      return res
        .status(uploaded.error.status)
        .json({ error: uploaded.error.message });
    }

    const allRows = await UserContent.find({ novelId, user: userId }).lean();
    const chapters = getUploadedChapterRows(allRows);
    const plan = planUploadedChapterRestore(chapters, scene.toObject());
    const assigned = assignCompactChapterNumbers(plan.ordered);
    const restored = assigned.find(
      (item) => String(item.row._id) === String(scene._id)
    );

    scene.archivedAt = null;
    scene.archivedFromActNumber = null;
    scene.archivedFromSceneIndex = null;
    if (restored) {
      scene.chapterNumber = restored.chapterNumber;
      scene.sceneIndex = restored.sceneIndex;
    }
    await scene.save();

    const {
      remapEllisReviewNumbers,
      remapEllisReviewMessageChapterNumbers,
    } = await import("../service/remapEllisReviewsAfterReorder.js");
    const restoreRemap = buildCompactChapterRemap(assigned, {
      alwaysIncludeIds: [scene._id],
    });
    await remapEllisReviewNumbers({
      EllisChapterReview,
      novelId,
      userId,
      remap: restoreRemap,
    });
    await remapEllisReviewMessageChapterNumbers({ remap: restoreRemap });

    const ops = compactUploadedChapterWrites(assigned, userId);
    if (ops.length) await UserContent.bulkWrite(ops);

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Uploaded chapter restored",
      metadata: { novelId: String(novelId), chapterId: String(id) },
    });

    res.status(StatusCodes.OK).json({ message: "Chapter restored", chapter: scene });
  } catch (error) {
    console.error("unarchiveUploadedChapter error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Generate Ellis' Phase 1 global editorial letter for an uploaded manuscript
 * and persist it on the novel. Runs asynchronously (fire-and-forget) right
 * after upload; the viewer polls `editorialLetterStatus` until it is "ready".
 */
export const generateEllisEditorialLetter = async ({ novelId, userId }) => {
  try {
    await Novel.findByIdAndUpdate(novelId, {
      editorialLetterStatus: "generating",
      editorialLetterError: null,
    });

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("name genre subgenre compTitles storyBibleAuthor")
      .lean();
    if (!novel) {
      throw new Error("Novel not found");
    }

    const userContents = await UserContent.find({ novelId, user: userId })
      .select("userContent sceneTitle sceneIndex chapterNumber chapterSuffix chapterLabel pov timeline archivedAt")
      .sort({ createdAt: 1 })
      .lean();

    const manuscriptText = assembleManuscriptText(userContents);
    if (!manuscriptText.trim()) {
      throw new Error("No manuscript content available to evaluate.");
    }

    const instructions = await loadAgentPromptFromDb("ellis_editorial_letter");

    const metaContext = buildUploadedManuscriptMetaContext(novel);

    const openaiKey = await getSharedOpenAIKey();
    const openai = new OpenAI({ apiKey: openaiKey });

    const response = await callResponsesAPI({
      openai,
      model: ELLIS_MODEL,
      input: [
        {
          role: "user",
          content: `${instructions}${metaContext ? `\n\n${metaContext}` : ""}\n\nHere is the full manuscript to evaluate:\n\n${manuscriptText}`,
        },
      ],
      temperature: 0.4,
      logParams: { userId, endpoint: "ellis-editorial-letter" },
    });

    const letter = extractTextFromOutput(response.output);
    if (!letter || !letter.trim()) {
      throw new Error("Editorial letter generation returned empty content.");
    }

    await Novel.findByIdAndUpdate(novelId, {
      editorialLetter: letter,
      editorialLetterStatus: "ready",
      editorialLetterGeneratedAt: new Date(),
      editorialLetterError: null,
      coverEditorialLetterSummary: null,
    });

    // Manuscript enrichment is triggered from `saveEllisEditorialLetter` in the
    // consent/refine workflow. This legacy path (only reachable via the retry
    // endpoint) still kicks it off so a directly-generated letter enriches too.
    generateManuscriptEnrichment({ novelId, userId }).catch((e) =>
      console.error("generateManuscriptEnrichment async error:", e)
    );
  } catch (error) {
    console.error("generateEllisEditorialLetter error:", error);
    await Novel.findByIdAndUpdate(novelId, {
      editorialLetterStatus: "failed",
      editorialLetterError: error.message || "Editorial letter generation failed",
    }).catch(() => {});
  }
};

/**
 * Poll endpoint for the editorial letter generation lifecycle.
 */
export const getEditorialLetter = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select(
        "editorialLetter editorialLetterDraft editorialLetterStatus editorialLetterError editorialLetterGeneratedAt"
      )
      .lean();

    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    return res.status(StatusCodes.OK).json({
      status: novel.editorialLetterStatus || "pending",
      editorialLetter: novel.editorialLetter || null,
      editorialLetterDraft: novel.editorialLetterDraft || null,
      error: novel.editorialLetterError || null,
      generatedAt: novel.editorialLetterGeneratedAt || null,
    });
  } catch (error) {
    console.error("getEditorialLetter error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Manually (re)trigger editorial letter generation for an uploaded manuscript.
 * Used to retry after a failure.
 */
export const regenerateEditorialLetter = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id");
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    await Novel.findByIdAndUpdate(novelId, {
      editorialLetterStatus: "generating",
      editorialLetterError: null,
    });

    // Fire-and-forget; client polls for completion.
    generateEllisEditorialLetter({ novelId, userId }).catch((e) =>
      console.error("regenerateEditorialLetter async error:", e)
    );

    return res
      .status(StatusCodes.OK)
      .json({ message: "Editorial letter generation started", status: "generating" });
  } catch (error) {
    console.error("regenerateEditorialLetter error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Editorial letter consent + refine workflow (Phase 1 modal)
// ---------------------------------------------------------------------------

/** Lazily create the editorial letter refinement chat thread for a novel. */
const ensureEllisEditorialLetterThread = async ({ novel, userId }) => {
  if (novel.ellisEditorialLetterThreadId) {
    return novel.ellisEditorialLetterThreadId;
  }
  const threadId = `thread_ellis_letter_${uuidv4()}`;
  novel.ellisEditorialLetterThreadId = threadId;
  await novel.save();
  await Thread.create({
    userId,
    threadId,
    title: `Ellis' Editorial Letter - ${novel.name}`,
    assistantId: "responses-api",
    assistantName: "Ellis",
    agentName: "ellis_editorial_letter",
    isActive: true,
  });
  return threadId;
};

/** Resolve the editorial letter base prompt from Agent Prompts (DB only). */
const loadEditorialLetterBasePrompt = async () =>
  loadAgentPromptFromDb("ellis_editorial_letter");

/**
 * Streamed editorial letter generation + refinement (Phase 1 modal).
 *
 * - First call (no saved draft): generate the initial letter from the manuscript.
 * - Refine calls: the writer's feedback + current draft are sent so Ellis returns
 *   the full revised letter, which replaces the draft.
 *
 * The manuscript/draft context is passed as ephemeral model input; persisted
 * thread messages are flagged `excludeFromModelInput` so history never bloats or
 * re-feeds prior letters back into the model.
 */
export const getEditorialLetterChatHistory = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    if (!novel.ellisEditorialLetterThreadId) {
      return res.status(StatusCodes.OK).json({
        messages: [],
        threadId: null,
        hasMore: false,
      });
    }

    const { limit, before } = req.query;
    const { messages, hasMore } = await fetchThreadMessagePage({
      threadId: novel.ellisEditorialLetterThreadId,
      limit,
      before,
    });

    return res.status(StatusCodes.OK).json({
      messages,
      threadId: novel.ellisEditorialLetterThreadId,
      hasMore,
    });
  } catch (error) {
    console.error("getEditorialLetterChatHistory error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const ellisEditorialLetterChat = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const feedback = String(req.body?.message || "").trim();
    const attachments = Array.isArray(req.body?.attachments)
      ? req.body.attachments
      : [];

    if (!novelId) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "novelId is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const currentDraft =
      novel.editorialLetterDraft || novel.editorialLetter || "";
    const isRefine = Boolean(currentDraft) && Boolean(feedback);

    const userContents = await UserContent.find({ novelId, user: user._id })
      .select(
        "userContent sceneTitle sceneIndex chapterNumber chapterSuffix chapterLabel pov timeline"
      )
      .sort({ createdAt: 1 })
      .lean();

    const manuscriptText = assembleManuscriptText(userContents);
    if (!manuscriptText.trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "No manuscript content available to evaluate.",
      });
    }

    const threadId = await ensureEllisEditorialLetterThread({
      novel,
      userId: user._id,
    });

    const basePrompt = await loadEditorialLetterBasePrompt();
    const metaContext = buildUploadedManuscriptMetaContext(novel);

    // Ephemeral model input (never persisted): manuscript + optional draft/feedback.
    const ephemeralModelContext = [];
    ephemeralModelContext.push({
      role: "user",
      content: `${metaContext ? `${metaContext}\n\n` : ""}Here is the full manuscript to evaluate:\n\n${manuscriptText}`,
    });
    if (isRefine) {
      ephemeralModelContext.push({
        role: "user",
        content: `Here is the current editorial letter draft:\n\n${currentDraft}\n\nThe writer has requested the following changes:\n\n${feedback}\n\nReturn the complete revised editorial letter (full text, ready to save). Apply the requested changes while keeping the rest of the letter consistent. Do not include any commentary outside the letter itself.`,
      });
    } else {
      ephemeralModelContext.push({
        role: "user",
        content:
          "Write the full editorial letter for this manuscript now. Return only the letter text, ready to save.",
      });
    }

    // Only flip to "generating" for the very first draft; refine keeps "draft"
    // so a failed refine turn preserves the existing draft.
    if (!currentDraft) {
      novel.editorialLetterStatus = "generating";
      novel.editorialLetterError = null;
      await novel.save();
    }

    // Short, human-readable persisted user row (UI transcript). The real model
    // input is the ephemeral context above.
    const persistedUserMessage = isRefine
      ? feedback
      : "Generate my editorial letter";

    await chatWithResponsesAPIStream({
      openaiKey: await getSharedOpenAIKey(),
      threadId,
      userMessage: persistedUserMessage,
      attachments,
      userMessageMetadata: ellisUiMessageMetadata(
        ELLIS_METADATA_KIND_LETTER_REFINE,
        { isRefine }
      ),
      ephemeralModelContext,
      instructions: appendEllisSecuritySuffix(basePrompt),
      model: ELLIS_MODEL,
      res,
      userId: user._id,
      userEmail: user.email,
      usageEndpoint: "ellis-editorial-letter-chat",
      temperature: 0.4,
      resolveAssistantMetadata: async ({ fullText }) => {
        // Persist the streamed letter as the working draft.
        if (fullText && fullText.trim()) {
          await Novel.findByIdAndUpdate(novelId, {
            editorialLetterDraft: fullText,
            editorialLetterStatus: "draft",
            editorialLetterError: null,
          }).catch((e) =>
            console.error("editorial letter draft persist error:", e)
          );
        }
        return ellisUiMessageMetadata(ELLIS_METADATA_KIND_LETTER_DRAFT);
      },
    });
  } catch (error) {
    console.error("ellisEditorialLetterChat error:", error);
    if (!res.headersSent) {
      const status = error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        error: error.message || "Internal Server Error",
      });
    }
  }
};

/**
 * Save/accept the editorial letter draft. Copies the draft to the canonical
 * `editorialLetter`, flips status to "ready" (which unlocks scene-by-scene work),
 * and kicks off Manuscript Map enrichment.
 */
export const saveEllisEditorialLetter = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const overrideLetter = String(req.body?.letter || "").trim();

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).select(
      "editorialLetter editorialLetterDraft editorialLetterStatus"
    );
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const finalLetter =
      overrideLetter || novel.editorialLetterDraft || novel.editorialLetter || "";
    if (!finalLetter.trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "There is no editorial letter draft to save yet.",
      });
    }

    novel.editorialLetter = finalLetter;
    novel.editorialLetterStatus = "ready";
    novel.editorialLetterGeneratedAt = new Date();
    novel.editorialLetterError = null;
    novel.coverEditorialLetterSummary = null;
    await novel.save();

    // Manuscript Map enrichment (chapter summaries + acts) reflects the saved letter.
    generateManuscriptEnrichment({ novelId, userId: user._id }).catch((e) =>
      console.error("generateManuscriptEnrichment async error:", e)
    );

    return res.status(StatusCodes.OK).json({
      message: "Editorial letter saved",
      status: "ready",
      editorialLetter: finalLetter,
    });
  } catch (error) {
    console.error("saveEllisEditorialLetter error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Ellis developmental-editor chat (Phase 2: scene-by-scene, per chapter)
// ---------------------------------------------------------------------------

/**
 * Lazily create the Ellis editor chat thread for a novel. Mirrors
 * `ensureOliviaCoachingThread`.
 */
const ensureEllisWelcomeForThread = async (threadId) => {
  const hasWelcome = await Message.exists({
    threadId,
    "metadata.kind": ELLIS_METADATA_KIND_SCENE_WELCOME,
  });
  if (hasWelcome) return;

  const first = await Message.findOne({ threadId })
    .sort({ timestamp: 1 })
    .select("timestamp")
    .lean();
  const ts = first?.timestamp
    ? new Date(new Date(first.timestamp).getTime() - 2000)
    : new Date(Date.now() - 60000);

  await Message.create({
    threadId,
    role: "assistant",
    content: ELLIS_SCENE_WELCOME_TEXT,
    metadata: ellisUiMessageMetadata(ELLIS_METADATA_KIND_SCENE_WELCOME, {
      chapterNumber: 1,
    }),
    timestamp: ts,
  });
};

const ensureEllisEditorThread = async ({ novel, userId }) => {
  let threadId = novel.ellisEditorThreadId;
  if (threadId) {
    await ensureEllisWelcomeForThread(threadId);
    return threadId;
  }
  threadId = `thread_ellis_editor_${uuidv4()}`;
  novel.ellisEditorThreadId = threadId;
  await novel.save();
  await Thread.create({
    userId,
    threadId,
    title: `Ellis' Edits - ${novel.name}`,
    assistantId: "responses-api",
    assistantName: "Ellis",
    agentName: "ellis_editor",
    isActive: true,
  });
  await Message.create({
    threadId,
    role: "assistant",
    content: ELLIS_SCENE_WELCOME_TEXT,
    metadata: ellisUiMessageMetadata(ELLIS_METADATA_KIND_SCENE_WELCOME, {
      chapterNumber: 1,
    }),
    timestamp: new Date(Date.now() - 5000),
  });
  return threadId;
};

// ---------------------------------------------------------------------------
// Ellis scene-by-scene chat (Uploaded Manuscript viewer)
// ---------------------------------------------------------------------------

export const ellisChat = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const { message, attachments } = req.body;

    const resolvedAttachments = Array.isArray(attachments) ? attachments : [];
    const resolvedMessage =
      message?.trim() ||
      (resolvedAttachments.length > 0
        ? `[${resolvedAttachments.length} file${
            resolvedAttachments.length !== 1 ? "s" : ""
          } attached]`
        : "");

    if (!novelId || !resolvedMessage) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "novelId and message (or attachments) are required",
      });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const threadId = await ensureEllisEditorThread({ novel, userId: user._id });

    let turnContext;
    try {
      turnContext = await buildEllisChatTurnContext({
        novel,
        userId: user._id,
        novelId,
        threadId,
      });
    } catch (err) {
      const status = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
      return res.status(status).json({ error: err.message || "Internal Server Error" });
    }

    const {
      instructions,
      supplementBlockMessage,
      ephemeralModelContext,
      focusedChapter,
      userMessageMetadata,
    } = turnContext;

    const openaiKey = await getSharedOpenAIKey();
    const loadedChapterRef = { ids: [] };

    await chatWithResponsesAPIStream({
      openaiKey,
      threadId,
      userMessage: resolvedMessage,
      instructions,
      supplementBlockMessage,
      ephemeralModelContext,
      useMemoryPipeline: isEllisMemoryV2Enabled(),
      novelId,
      agentName: "ellis_editor",
      model: ELLIS_MODEL,
      res,
      userId: user._id,
      userEmail: user.email,
      attachments: resolvedAttachments,
      userMessageMetadata,
      usageEndpoint: "ellis-editor-chat",
      tools: buildEllisResponsesTools(),
      resolveFunctionCall: async (fc) => {
        if (fc?.name !== ELLIS_LOAD_MANUSCRIPT_CHAPTERS_NAME) {
          return JSON.stringify({ error: "Function not implemented." });
        }
        const parsed = parseEllisLoadChapterArgs(fc.arguments);
        if (parsed?.chapterIds?.length) loadedChapterRef.ids = parsed.chapterIds;
        return executeEllisLoadManuscriptChapters({
          args: parsed || fc.arguments,
          userContents: turnContext.userContents,
        });
      },
      transformAssistantText: ({ text }) => {
        const loadedRow =
          turnContext.userContents.find(
            (uc) => String(uc._id) === String(loadedChapterRef.ids[0] || "")
          ) || null;
        const deliveredFallback = loadedRow || focusedChapter;
        let stripped = stripEllisLeakedModeFraming(
          stripEllisOpenEndedOffers(stripEllisFalseInsertClaims(text))
        );
        const delivered = resolveEllisDeliveredReviewChapter({
          text: stripped,
          userContents: turnContext.userContents,
          fallback: deliveredFallback,
        });
        if (!delivered) return stampEllisRepeatedSceneOpenerLetters(stripped);
        return rewriteEllisReviewOpenersToChapterTitle(
          stripped,
          resolveChapterLabel(delivered),
          resolveEllisChapterPovName(delivered)
        );
      },
      resolveAssistantMetadata: async ({ fullText }) => {
        const loadedRow =
          turnContext.userContents.find(
            (uc) => String(uc._id) === String(loadedChapterRef.ids[0] || "")
          ) || null;
        const deliveredFallback = loadedRow || focusedChapter;
        const delivered = resolveEllisDeliveredReviewChapter({
          text: fullText,
          userContents: turnContext.userContents,
          fallback: deliveredFallback,
        });
        const readyForDelivered = findReadyReviewForChapter(
          turnContext.readyReviews,
          {
            chapterId: delivered?._id,
            chapterNumber: delivered?.chapterNumber ?? delivered?.sceneIndex,
            chapterSuffix: delivered?.chapterSuffix,
          }
        );
        const kind = resolveEllisAssistantTurnKind({
          text: fullText,
          hasOriginalPlan: Boolean(readyForDelivered),
        });
        const deliveredNum = delivered
          ? Number(delivered.chapterNumber ?? delivered.sceneIndex)
          : null;
        const deliveredId = delivered ? String(delivered._id) : null;
        if (
          kind === ELLIS_METADATA_KIND_CHAPTER_REVIEW &&
          Number.isFinite(deliveredNum) &&
          deliveredId
        ) {
          return ellisChapterReviewMetadata({
            chapterNumber: deliveredNum,
            chapterSuffix: delivered.chapterSuffix || "",
            chapterId: deliveredId,
            draftContentHash: hashEllisChapterDraft(delivered.userContent),
          });
        }
        if (kind === ELLIS_METADATA_KIND_REVISION_REVIEW) {
          if (Number.isFinite(deliveredNum) && deliveredId) {
            return ellisRevisionReviewMetadata({
              chapterNumber: deliveredNum,
              chapterSuffix: delivered.chapterSuffix || "",
              chapterId: deliveredId,
            });
          }
          return ellisUiMessageMetadata(ELLIS_METADATA_KIND_REVISION_REVIEW);
        }
        const named = extractLastChapterRefFromAssistantContent(fullText);
        const uniqueNamed = uniqueAssistantChapterNumbers(fullText);
        if (uniqueNamed.length === 1 && Number.isFinite(named?.chapterNumber)) {
          return {
            kind: ELLIS_METADATA_KIND_CONVERSATIONAL,
            chapterNumber: named.chapterNumber,
            chapterSuffix: named.chapterSuffix || "",
            ...(loadedRow?._id ? { chapterId: String(loadedRow._id) } : {}),
          };
        }
        const convChapter = loadedRow || focusedChapter;
        if (convChapter) {
          const convNum = Number(
            convChapter.chapterNumber ?? convChapter.sceneIndex
          );
          if (Number.isFinite(convNum)) {
            return {
              kind: ELLIS_METADATA_KIND_CONVERSATIONAL,
              chapterNumber: convNum,
              chapterSuffix: convChapter.chapterSuffix || "",
              chapterId: String(convChapter._id),
            };
          }
        }
        return { kind: ELLIS_METADATA_KIND_CONVERSATIONAL };
      },
    });
  } catch (error) {
    console.error("ellisChat error:", error);
    if (!res.headersSent) {
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal Server Error" });
    }
  }
};

export const getEllisChatHistory = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    if (!novel.ellisEditorThreadId) {
      const threadId = await ensureEllisEditorThread({ novel, userId: user._id });
      const { messages, hasMore } = await fetchThreadMessagePage({
        threadId,
        limit: req.query.limit,
        before: req.query.before,
      });
      return res.status(StatusCodes.OK).json({
        messages,
        threadId,
        hasMore,
      });
    }

    await ensureEllisWelcomeForThread(novel.ellisEditorThreadId);

    const { limit, before } = req.query;
    const { messages, hasMore } = await fetchThreadMessagePage({
      threadId: novel.ellisEditorThreadId,
      limit,
      before,
    });

    res.status(StatusCodes.OK).json({
      messages,
      threadId: novel.ellisEditorThreadId,
      hasMore,
    });
  } catch (error) {
    console.error("getEllisChatHistory error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Ellis Scene Architect — structured, per-chapter developmental review
// ---------------------------------------------------------------------------

/**
 * Generate Ellis' structured Scene Architect review for ONE chapter and
 * persist it (upsert) on `EllisChapterReview`. Runs asynchronously
 * (fire-and-forget); the viewer polls `getEllisChapterReview` until "ready".
 */
export const generateEllisChapterReview = async ({
  novelId,
  userId,
  chapterNumber,
  chapterSuffix = "",
}) => {
  const chapterNum = Number(chapterNumber);
  const chapterSuf = normalizeChapterSuffix(chapterSuffix);
  try {
    await markEllisChapterReviewGenerating({
      novelId,
      userId,
      chapterNumber: chapterNum,
      chapterSuffix: chapterSuf,
    });

    const payload = await buildEllisChapterReviewPayload({
      novelId,
      userId,
      chapterNumber: chapterNum,
      chapterSuffix: chapterSuf,
    });

    const openaiKey = await getSharedOpenAIKey();
    const openai = new OpenAI({ apiKey: openaiKey });

    const response = await callResponsesAPI({
      openai,
      model: ELLIS_MODEL,
      instructions: payload.instructions,
      input: [
        {
          role: "user",
          content: payload.userInput,
        },
      ],
      temperature: 0.4,
      text: {
        format: {
          type: "json_schema",
          name: "EllisChapterReview",
          schema: ELLIS_CHAPTER_REVIEW_SCHEMA,
          strict: true,
        },
      },
      logParams: { userId, endpoint: "ellis-chapter-review" },
    });

    const raw = extractTextFromOutput(response.output);
    if (!raw?.trim()) {
      throw new Error("Scene review generation returned empty content.");
    }

    await upsertEllisChapterReview({
      novelId,
      userId,
      chapterNumber: chapterNum,
      chapterSuffix: payload.chapterSuffix || chapterSuf,
      reviewMarkdown: stripEllisLegacyWorkflowCta(
        rewriteEllisReviewOpenersToChapterTitle(
          raw,
          payload.chapterLabel,
          payload.pov
        )
      ),
      chapterLabel: payload.chapterLabel,
      pov: payload.pov,
      chapterId: payload.chapterId || null,
    });
  } catch (error) {
    console.error("generateEllisChapterReview error:", error);
    await markEllisChapterReviewFailed({
      novelId,
      userId,
      chapterNumber: chapterNum,
      chapterSuffix: chapterSuf,
      errorMessage: error.message,
    });
  }
};

/**
 * Explicit save (user clicks "Insert into Scene Edit" in Ellis chat).
 */
export const saveEllisChapterReview = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const { messageId, chapterNumber, chapterSuffix } = req.body;

    if (!messageId || !Number.isFinite(Number(chapterNumber))) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "messageId and chapterNumber are required",
      });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    if (!novel.ellisEditorThreadId) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Ellis chat thread not found" });
    }

    const msg = await Message.findOne({
      _id: messageId,
      threadId: novel.ellisEditorThreadId,
    }).lean();

    if (!msg || !msg.content) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Message not found" });
    }

    const rawContent = stripEllisLegacyWorkflowCta(msg.content);
    // Trust the review metadata kind (what the FE shows the Insert button from)
    // as the authoritative signal; fall back to the prose heuristic for older
    // messages that predate metadata tagging. Prose phrasing varies too much to
    // be the sole gate — see the loosened "leave feeling" match.
    const isTaggedFirstPass =
      msg.metadata?.kind === ELLIS_METADATA_KIND_CHAPTER_REVIEW;
    if (msg.metadata?.kind === ELLIS_METADATA_KIND_REVISION_REVIEW) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error:
          "Revision checks stay in chat and cannot be inserted into the Revision Plan.",
      });
    }
    if (
      !rawContent ||
      (!isTaggedFirstPass && !isEllisDevelopmentalReviewText(rawContent))
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Message does not contain a valid chapter review",
      });
    }

    const userContents = await UserContent.find({ novelId, user: user._id })
      .select(
        "chapterNumber chapterSuffix chapterLabel sceneTitle sceneIndex pov archivedAt"
      )
      .lean();

    if (
      msg.metadata?.chapterId &&
      isArchivedChapterRow(
        userContents.find(
          (uc) => String(uc._id) === String(msg.metadata.chapterId)
        )
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Cannot insert into an archived chapter. Restore it first.",
      });
    }

    const chapterRef = resolveEllisSavedReviewChapterRef({
      messageMetadata: msg.metadata,
      messageContent: rawContent,
      requestedChapterNumber: chapterNumber,
      requestedChapterSuffix: chapterSuffix,
      userContents,
    });
    if (!chapterRef || !Number.isFinite(chapterRef.chapterNumber)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Could not determine which chapter this review belongs to.",
      });
    }
    const chapterNum = chapterRef.chapterNumber;
    const rows = getUploadedChapterRows(userContents);
    const chapterRow =
      (msg.metadata?.chapterId
        ? rows.find(
            (uc) => String(uc._id) === String(msg.metadata.chapterId)
          )
        : null) ||
      rows.find((uc) => {
        const sameNum =
          Number(uc.chapterNumber ?? uc.sceneIndex) === chapterNum;
        const sameSuf =
          normalizeChapterSuffix(uc.chapterSuffix) ===
          normalizeChapterSuffix(chapterRef.chapterSuffix);
        return sameNum && sameSuf;
      }) ||
      rows.find(
        (uc) => Number(uc.chapterNumber ?? uc.sceneIndex) === chapterNum
      ) ||
      null;
    const resolvedSuffix = normalizeChapterSuffix(
      chapterRow?.chapterSuffix || chapterRef.chapterSuffix
    );
    const chapterLabel = chapterRow
      ? resolveChapterLabel(chapterRow)
      : `Chapter ${chapterNum}${resolvedSuffix ? ` ${resolvedSuffix}` : ""}`;
    const pov = chapterRow?.pov || null;

    const existingReview = await EllisChapterReview.findOne({
      novel: novelId,
      user: user._id,
      chapterNumber: chapterNum,
      chapterSuffix: resolvedSuffix,
    })
      .select("status reviewMarkdown")
      .lean();
    if (shouldPreserveOriginalEllisReview(existingReview)) {
      return res.status(StatusCodes.CONFLICT).json({
        error: "This chapter already has a review in your Revision Plan.",
      });
    }

    const review = await upsertEllisChapterReview({
      novelId,
      userId: user._id,
      chapterNumber: chapterNum,
      chapterSuffix: resolvedSuffix,
      reviewMarkdown: rawContent,
      chapterLabel,
      pov,
      draftContentHash: msg.metadata?.draftContentHash || null,
      chapterId: chapterRow?._id || msg.metadata?.chapterId || null,
    });

    const updatedNovel = await Novel.findOneAndUpdate(
      { _id: novelId, user: user._id },
      { $addToSet: { ellisSavedChapterReviewMessageIds: messageId } },
      { new: true, select: "ellisSavedChapterReviewMessageIds" }
    );

    const orderedChapters = getDistinctBaseChapterRows(userContents);
    const readyReviews = await EllisChapterReview.find({
      novel: novelId,
      user: user._id,
      status: "ready",
    })
      .select("chapterNumber chapterSuffix status chapterId")
      .lean();
    const readyChapterNumbers = collectReadyChapterNumbers(
      readyReviews,
      userContents
    );
    const isBackfillInsert = isEllisBackfillInsert({
      insertedChapterNumber: chapterNum,
      readyChapterNumbers,
    });
    const nextRow = resolveNextEllisOpenChapter(
      orderedChapters,
      readyChapterNumbers
    );
    const nextChapterNum = nextRow
      ? Number(nextRow.chapterNumber ?? nextRow.sceneIndex)
      : null;
    const nextChapterSuffix = nextRow
      ? normalizeChapterSuffix(nextRow.chapterSuffix)
      : "";
    const nextChapterLabel = nextRow ? resolveChapterLabel(nextRow) : null;

    const reviewedInThread = novel.ellisEditorThreadId
      ? await listReviewedEllisChaptersInThread(novel.ellisEditorThreadId)
      : [];
    const reviewedNumbers = new Set(
      reviewedInThread
        .map((r) => Number(r.chapterNumber))
        .filter((n) => isEllisManuscriptChapterNumber(n))
    );
    const nextChapterAlreadyReviewed =
      isEllisManuscriptChapterNumber(nextChapterNum) &&
      reviewedNumbers.has(nextChapterNum);

    const firstPassAlreadyComplete = novel.ellisEditorThreadId
      ? await hasEllisFirstPassWrapUpPosted(novel.ellisEditorThreadId)
      : false;
    const postingFirstPassWrapUp =
      nextChapterNum == null && !firstPassAlreadyComplete;

    let confirmationMessage = null;
    if (novel.ellisEditorThreadId) {
      const confirmContent = buildEllisInsertConfirmText({
        chapterLabel,
        nextChapterLabel,
        nextChapterNumber: nextChapterNum,
        isBackfill: isBackfillInsert,
        nextChapterAlreadyReviewed,
        firstPassAlreadyComplete,
      });
      const confirmDoc = await Message.create({
        threadId: novel.ellisEditorThreadId,
        role: "assistant",
        content: confirmContent,
        metadata: ellisUiMessageMetadata(ELLIS_METADATA_KIND_INSERT_CONFIRM, {
          excludeFromModelInput: false,
          chapterNumber: chapterNum,
          chapterSuffix: resolvedSuffix,
          chapterId: chapterRow?._id ? String(chapterRow._id) : null,
          nextChapterNumber: nextChapterNum,
          nextChapterId: nextRow ? String(nextRow._id) : null,
          nextChapterLabel,
          nextChapterSuffix,
          isBackfillInsert,
          nextChapterAlreadyReviewed,
          ...(postingFirstPassWrapUp ? { firstPassComplete: true } : {}),
        }),
        timestamp: new Date(),
      });
      confirmationMessage = {
        _id: confirmDoc._id,
        role: confirmDoc.role,
        content: confirmDoc.content,
        timestamp: confirmDoc.timestamp,
        metadata: confirmDoc.metadata,
      };
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      chapterNumber: chapterNum,
      chapterSuffix: resolvedSuffix,
      review,
      ellisSavedChapterReviewMessageIds:
        updatedNovel?.ellisSavedChapterReviewMessageIds || [],
      nextChapterNumber: nextChapterNum,
      nextChapterSuffix,
      nextChapterId: nextRow ? String(nextRow._id) : null,
      isBackfillInsert,
      confirmationMessage,
    });
  } catch (error) {
    console.error("saveEllisChapterReview error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Poll endpoint for a chapter's structured review.
 * GET /novel/:novelId/ellis-chapter-review/:chapterNumber
 */
export const getEllisChapterReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, chapterNumber } = req.params;
    const parsed = parseChapterRouteParam(chapterNumber);
    if (!parsed) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Valid chapterNumber is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id");
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const userContents = await UserContent.find({ novelId, user: userId })
      .select("chapterNumber chapterSuffix chapterLabel sceneTitle sceneIndex")
      .lean();

    const review = await findEllisChapterReviewForMapRow({
      novelId,
      userId,
      chapterNumber: parsed.chapterNumber,
      chapterSuffix: parsed.chapterSuffix,
      userContents,
    });

    return res.status(StatusCodes.OK).json({
      status: review?.status || "none",
      review: review || null,
    });
  } catch (error) {
    console.error("getEllisChapterReview error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Kick off (or retry) generation of a chapter's structured review.
 * POST /novel/:novelId/ellis-chapter-review/:chapterNumber/generate
 * Returns immediately; the client polls getEllisChapterReview.
 */
export const triggerEllisChapterReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, chapterNumber } = req.params;
    const parsed = parseChapterRouteParam(chapterNumber);

    if (!parsed) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Valid chapterNumber is required" });
    }

    const chapterNum = parsed.chapterNumber;
    const chapterSuf = parsed.chapterSuffix;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select(
      "editorialLetterStatus"
    );
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    if (novel.editorialLetterStatus !== "ready") {
      return res.status(StatusCodes.FORBIDDEN).json({
        error:
          "Ellis is finishing your editorial letter before scene-by-scene edits.",
      });
    }

    await EllisChapterReview.findOneAndUpdate(
      { novel: novelId, chapterNumber: chapterNum, chapterSuffix: chapterSuf },
      {
        $set: { status: "generating", error: null, user: userId },
        $setOnInsert: {
          novel: novelId,
          chapterNumber: chapterNum,
          chapterSuffix: chapterSuf,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    // Fire-and-forget; client polls for completion.
    generateEllisChapterReview({
      novelId,
      userId,
      chapterNumber: chapterNum,
      chapterSuffix: chapterSuf,
    }).catch(
      (e) => console.error("triggerEllisChapterReview async error:", e)
    );

    return res
      .status(StatusCodes.OK)
      .json({ message: "Scene review generation started", status: "generating" });
  } catch (error) {
    console.error("triggerEllisChapterReview error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/**
 * Map of progress keys (7, 7A) -> review status for an uploaded manuscript. Drives the
 * sidebar progress dots and the "ready for next chapter" advance.
 * GET /novel/:novelId/ellis-review-progress
 */
export const getEllisReviewProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id");
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const [reviews, userContents] = await Promise.all([
      EllisChapterReview.find({ novel: novelId, user: userId })
        .select("chapterNumber chapterSuffix status generatedAt chapterId")
        .lean(),
      UserContent.find({ novelId, user: userId })
        .select("chapterNumber chapterSuffix chapterLabel sceneTitle sceneIndex")
        .lean(),
    ]);

    return res.status(StatusCodes.OK).json({
      progress: buildEllisReviewProgressMap(reviews, userContents),
    });
  } catch (error) {
    console.error("getEllisReviewProgress error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Revision Plan (Ellis' Editing Plan)
// ---------------------------------------------------------------------------

export const saveRevisionPlanItem = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;
    const { content, source, chapterLabel, sceneLabel, title, sourceMessageId } =
      req.body;

    if (!content || !String(content).trim()) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "content is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id");
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const item = await RevisionPlanItem.create({
      novel: novelId,
      user: userId,
      content: String(content).trim(),
      source: [
        "editorial_letter",
        "ellis_chat",
        "scene_review",
        "creative_suggestion",
        "manual",
      ].includes(source)
        ? source
        : "ellis_chat",
      chapterLabel: chapterLabel || null,
      sceneLabel: sceneLabel || null,
      title: title || null,
      sourceMessageId: sourceMessageId || null,
    });

    res.status(StatusCodes.CREATED).json({ item });
  } catch (error) {
    console.error("saveRevisionPlanItem error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const getRevisionPlanItems = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).select("_id");
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const items = await RevisionPlanItem.find({ novel: novelId, user: userId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(StatusCodes.OK).json({ items });
  } catch (error) {
    console.error("getRevisionPlanItems error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const deleteRevisionPlanItem = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, itemId } = req.params;

    const deleted = await RevisionPlanItem.findOneAndDelete({
      _id: itemId,
      novel: novelId,
      user: userId,
    });

    if (!deleted) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Revision plan item not found" });
    }

    res.status(StatusCodes.OK).json({ message: "Deleted", itemId });
  } catch (error) {
    console.error("deleteRevisionPlanItem error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const uploadManuscript = async (req, res) => {
  try {
    const { name, bookIdea } = req.body;
    const userId = req.user._id;

    if (!req.file) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ message: "No file uploaded" });
    }

    // 1. Parse the manuscript into title-page metadata + ordered chapters.
    const { titlePage, chapters, warnings } = await parseManuscriptBuffer(
      req.file.buffer,
      req.file.originalname
    );

    // 2. Build one UserContent row per detected chapter. If no chapter
    //    headers were found (manuscript not formatted), fall back to a single
    //    chapter holding the whole body so nothing is lost. Chapter bodies
    //    use contentBlocks so DOCX uploads keep their rich formatting
    //    (alignment, bold/italic/underline/strike, headings, lists, links).
    let scenes = chapters.map((chapter, idx) => {
      const peeled = peelLeadingSceneTitleBlock(
        filterSceneBreakOrnamentBlocks(chapter.contentBlocks || [])
      );
      const chapterNumber =
        chapter.chapterNumber != null ? chapter.chapterNumber : idx + 1;
      const chapterSuffix = chapter.chapterSuffix || null;
      const chapterLabel = chapter.chapterLabel || `Chapter ${chapterNumber}`;
      const suffixKey = chapterSuffix ? `_${chapterSuffix}` : "";
      const bodyBlocks = stripRedundantChapterMetaBlocks(peeled.contentBlocks, {
        chapterLabel,
        pov: chapter.pov || null,
        timeline: chapter.timeline || null,
      });

      return {
        novelId: null,
        user: userId,
        promptKey: `chapter_${chapterNumber}${suffixKey}`,
        sceneTitle: peeled.sceneTitle || chapter.sceneTitle || chapterLabel,
        userContent: buildChapterContentHtmlFromBlocks(bodyBlocks),
        sceneIndex: idx + 1,
        chapterNumber,
        chapterSuffix,
        chapterLabel,
        pov: chapter.pov || null,
        timeline: chapter.timeline || null,
      };
    });

    if (!scenes.length) {
      const blocks = await extractManuscriptBlocks(
        req.file.buffer,
        req.file.originalname
      );
      const peeled = peelLeadingSceneTitleBlock(
        filterSceneBreakOrnamentBlocks(blocks)
      );
      scenes = [
        {
          novelId: null,
          user: userId,
          promptKey: "chapter_1",
          sceneTitle: peeled.sceneTitle || titlePage.title || name || "Chapter One",
          userContent: buildChapterContentHtmlFromBlocks(peeled.contentBlocks),
          sceneIndex: 1,
          chapterNumber: 1,
          chapterLabel: "Chapter One",
          pov: null,
          timeline: null,
        },
      ];
      warnings.push(
        "No chapter headers were detected; the manuscript was stored as a single chapter."
      );
    }

    const novel = await Novel.create({
      user: userId,
      name: name || titlePage.title || "Untitled Novel",
      bookIdea,
      genre: titlePage.genre || undefined,
      subgenre: titlePage.subgenre || undefined,
      storyBibleAuthor: titlePage.author || undefined,
      compTitles:
        titlePage.compTitles && titlePage.compTitles.length
          ? titlePage.compTitles
          : undefined,
      uploaded: true,
      editorialLetterStatus: "pending",
    });

    scenes.forEach((s) => (s.novelId = novel._id));
    if (scenes.length) await UserContent.insertMany(scenes);

    // The editorial letter is no longer auto-generated on upload. The Manuscript
    // Hub shows a consent modal where the writer permits generation, refines the
    // draft with Ellis, and saves it (Phase 1). Scene-by-scene work unlocks only
    // after the letter is saved (`editorialLetterStatus === "ready"`).

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "Manuscript uploaded and novel created",
      metadata: {
        novelId: String(novel._id),
        chapterCount: scenes.length,
        warnings: warnings.length ? warnings : undefined,
      },
    });
    res.status(StatusCodes.OK).json({
      message: "Manuscript uploaded successfully",
      novelId: String(novel._id),
      chapterCount: scenes.length,
      warnings,
    });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: "Upload failed", error: error.message });
  }
};

export const deleteNovel = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;
    const {
      source = "api_request",
      agentFilter = null,
      projectCardId = null,
      projectType = null,
    } = req.body || {};

    const novel = await Novel.findOneAndUpdate(
      { _id: novelId, user: userId },
      { $set: { deletedAt: new Date() } },
      { new: true, activityLogSkipModel: true }
    );

    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    queueActivityLog({
      req,
      userId,
      action: "delete",
      module: "novel",
      description: "Novel soft-deleted",
      metadata: {
        novelId: String(novelId),
        source: typeof source === "string" && source.trim() ? source.trim() : "api_request",
        agentFilter:
          typeof agentFilter === "string" && agentFilter.trim() ? agentFilter.trim() : null,
        projectCardId:
          typeof projectCardId === "string" && projectCardId.trim() ? projectCardId.trim() : null,
        projectType:
          typeof projectType === "string" && projectType.trim() ? projectType.trim() : null,
      },
    });
    res.status(StatusCodes.OK).json({ message: "Novel deleted successfully" });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const completeNovel = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const novel = await Novel.findOneAndUpdate(
      { _id: novelId, user: userId },
      { status: "completed" },
      { new: true }
    );

    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Novel marked completed",
      metadata: { novelId: String(novelId) },
    });
    res.status(StatusCodes.OK).json({
      message: "Novel marked as completed successfully",
      novel,
    });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const downloadManuscript = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const novel = await Novel.findOne({ _id: novelId, user: userId }).lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "Novel not found",
      });
    }

    if (novel.uploaded) {
      const { buffer, filename } = await generateUploadedManuscriptDocx({
        novelId,
        userId,
        user: req.user,
      });

      setDocxDownloadHeaders(res, buffer, filename);
      return res.send(buffer);
    }

    const userContents = await UserContent.find({
      novelId,
      user: userId,
      userContent: { $exists: true, $ne: "" },
    })
      .select(
        "promptKey sceneTitle userContent actNumber sceneIndex chapterNumber chapterSuffix chapterLabel pov timeline"
      )
      .sort({ actNumber: 1, sceneIndex: 1 })
      .lean();

    if (!userContents.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "No content found for this novel",
      });
    }

    const storyResponses = await StoryResponse.find({ novel: novelId, user: userId })
      .select("promptKey responseText")
      .lean();
    const responseByPromptKey = Object.fromEntries(
      storyResponses.map((sr) => [sr.promptKey, sr.responseText || ""])
    );

    const FONT = "Times New Roman";
    const novelTitle =
      stripMarkdownForDocx(String(novel.name || "")) || "Untitled Novel";
    const marginTwip = convertInchesToTwip(1);
    const pageMargins = {
      top: marginTwip,
      right: marginTwip,
      bottom: marginTwip,
      left: marginTwip,
      header: convertInchesToTwip(0.5),
      footer: convertInchesToTwip(0.5),
    };

    const storyBibleByline =
      typeof novel.storyBibleAuthor === "string"
        ? stripMarkdownForDocx(novel.storyBibleAuthor.trim())
        : "";
    const authorName =
      storyBibleByline ||
      [req.user?.fname, req.user?.lname].filter(Boolean).join(" ").trim() ||
      req.user?.username ||
      "";

    // Running header: "Surname / SHORT TITLE     {page}"
    const authorSurname = authorName
      ? authorName.trim().split(/\s+/).pop().toUpperCase()
      : "";
    const shortTitle = novelTitle.toUpperCase().slice(0, 40);
    const headerLeft = [authorSurname, shortTitle].filter(Boolean).join(" / ");

    // ---- Title page ----
    const tp = (text, opts = {}) =>
      new Paragraph({
        children: [new TextRun({ text, font: FONT, ...opts })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 480, lineRule: LineRuleType.AUTO },
      });

    const titlePageChildren = [
      tp(novelTitle, { bold: true, size: 64 }),
      tp(""),
      tp("by", { italics: true, size: 28 }),
      tp(authorName || "", { size: 32 }),
    ];

    if (novel.genre) {
      const genreDisplay = stripMarkdownForDocx(String(novel.genre));
      if (genreDisplay) {
        titlePageChildren.push(tp(""));
        titlePageChildren.push(tp(genreDisplay, { italics: true, size: 24 }));
      }
    }

    if (novel.wordCount != null && Number.isFinite(Number(novel.wordCount))) {
      const rounded =
        Math.round(Number(novel.wordCount) / 1000) * 1000 ||
        Number(novel.wordCount);
      titlePageChildren.push(
        tp(`Approximately ${rounded.toLocaleString()} words`, { size: 24 })
      );
    }

    // ---- Running header (body sections only) ----
    const runningHeader = new Header({
      children: [
        new Paragraph({
          tabStops: [
            {
              type: TabStopType.RIGHT,
              position: TabStopPosition.MAX,
            },
          ],
          children: [
            new TextRun({
              text: headerLeft,
              font: FONT,
              size: 20,
            }),
            new TextRun({
              children: ["\t", PageNumber.CURRENT],
              font: FONT,
              size: 20,
            }),
          ],
        }),
      ],
    });

    // ---- Act word map ----
    const ACT_WORDS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
    const actLabel = (n) => `ACT ${ACT_WORDS[n - 1] || n}`;

    const sections = [
      {
        properties: {
          page: { margin: pageMargins },
          verticalAlign: VerticalAlignSection.CENTER,
        },
        children: titlePageChildren,
      },
    ];

    const docxOffsets = computeActOffsets(userContents);
    const actsPresent = new Set(
      userContents.map((uc) => Number(uc.actNumber) || 1)
    );
    const actOrder = [1, 2, 3].filter((a) => actsPresent.has(a));
    const otherActs = [...actsPresent]
      .filter((a) => !actOrder.includes(a))
      .sort((x, y) => x - y);
    const orderedActs = [...actOrder, ...otherActs];

    const chapterHeaderParagraph = (title, { isFirstInAct = false } = {}) =>
      new Paragraph({
        children: [
          new TextRun({
            text: title,
            font: FONT,
            size: 26,
            bold: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: {
          before: isFirstInAct ? 480 : 0,
          after: 240,
          line: 480,
          lineRule: LineRuleType.AUTO,
        },
      });

    const sceneHeading = (title) =>
      new Paragraph({
        children: [
          new TextRun({
            text: title,
            font: FONT,
            size: 26,
            bold: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 480, line: 480, lineRule: LineRuleType.AUTO },
      });

    const sceneSeparator = () =>
      new Paragraph({
        children: [
          new TextRun({ text: "* * *", font: FONT, size: 24 }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 720, after: 720, line: 480, lineRule: LineRuleType.AUTO },
      });

    for (const act of orderedActs) {
      const actScenes = userContents.filter(
        (uc) => (Number(uc.actNumber) || 1) === act
      );
      if (!actScenes.length) continue;

      const bodyChildren = [
        // Act title — large, centered, generous top spacing
        new Paragraph({
          children: [
            new TextRun({
              text: actLabel(act),
              bold: true,
              size: 44,
              font: FONT,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: {
            before: convertInchesToTwip(2),
            after: convertInchesToTwip(1.5),
            line: 480,
            lineRule: LineRuleType.AUTO,
          },
        }),
      ];

      for (let i = 0; i < actScenes.length; i++) {
        const content = actScenes[i];
        const docxGlobal = getGlobalSceneNumber(Number(content.actNumber) || act, content.sceneIndex || (i + 1), docxOffsets);
        const rawSceneTitle = content.sceneTitle
          ? stripMarkdownForDocx(String(content.sceneTitle))
          : `Scene ${docxGlobal}`;

        // Scene-break separator before every scene after the first
        if (i > 0) {
          bodyChildren.push(sceneSeparator());
        }

        const { headerLine } = resolveChapterExportMeta(content, {
          globalSceneNum: docxGlobal,
          responseText: responseByPromptKey[content.promptKey] || "",
        });
        bodyChildren.push(
          chapterHeaderParagraph(headerLine, { isFirstInAct: i === 0 })
        );

        bodyChildren.push(sceneHeading(rawSceneTitle));

        const sceneParas = parseHtmlToDocxParagraphs(content.userContent || "");
        bodyChildren.push(...sceneParas);
      }

      sections.push({
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { margin: pageMargins },
        },
        headers: {
          default: runningHeader,
        },
        children: bodyChildren,
      });
    }

    const doc = new Document({
      numbering: getManuscriptNumberingConfig(),
      sections,
    });

    const buffer = await Packer.toBuffer(doc);

    const fileName = buildSafeDocxFilenameFromTitle(novel.name, "Manuscript", "Novel");
    setDocxDownloadHeaders(res, buffer, fileName);

    res.send(buffer);
  } catch (error) {
    if (error instanceof UploadedManuscriptExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download manuscript error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate manuscript",
    });
  }
};

export const downloadOutline = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateOutlineDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof OutlineExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download outline error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate outline",
    });
  }
};

export const downloadManuscriptMap = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateManuscriptMapDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof ManuscriptMapExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download manuscript map error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate manuscript map",
    });
  }
};

export const downloadEditorialLetter = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateEditorialLetterDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof EditorialLetterExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download editorial letter error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate editorial letter",
    });
  }
};

export const downloadCharacters = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateCharactersDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof CharactersExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download characters error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate characters export",
    });
  }
};

export const downloadStoryBible = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateStoryBibleDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof StoryBibleExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download story bible error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate Story Bible export",
    });
  }
};

export const downloadChapterPlan = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    const { buffer, filename } = await generateChapterPlanDocx({
      novelId,
      userId,
      user: req.user,
    });

    setDocxDownloadHeaders(res, buffer, filename);
    res.send(buffer);
  } catch (error) {
    if (error instanceof ChapterPlanExportError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Download Editing Plan error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to generate chapter plan",
    });
  }
};

export const getEllisSceneReviews = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    // Verify novel ownership
    const novel = await Novel.findOne({ _id: novelId, user: userId });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "Novel not found",
      });
    }

    const sceneReviews = await EllisSceneReview.find({
      novel: novelId,
      user: userId,
    })
      .sort({ scene_index: 1 })
      .lean();

    return res.status(StatusCodes.OK).json({
      message: "Ellis scene reviews retrieved successfully",
      data: sceneReviews,
    });
  } catch (error) {
    console.error("Get Ellis scene reviews error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};

// LEGACY: Assistants API Olivia scenes review
export const oliviaScenesReview_old = async (req, res) => {
  try {
    const user = req.user;
    const { novelId, name, bookIdea } = req.body;

    if (!req.file) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Document file is required" });
    }

    let novel;
    let novelIdToUse = novelId;

    if (novelIdToUse) {
      novel = await Novel.findOne({ _id: novelIdToUse, user: user._id }).lean();
      if (!novel) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ error: "Novel not found" });
      }
    } else {
      if (!name) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: "Novel name is required when creating a new novel" });
      }

      novel = await Novel.create({
        user: user._id,
        name: name || "Untitled Novel",
        bookIdea: bookIdea || "",
        uploaded: true,
      });
      novelIdToUse = novel._id;
    }

    const { openaiKey, userAgent } = await ensureUserAgentAssistant({
      user,
      agentName: "olivia_scenes",
    });

    const fileId = await uploadDocFileToOpenAI_old(
      req.file.buffer,
      openaiKey,
      req.file.originalname
    );

    const scenesResponse = await oliviaScenesByOpenAI_old(
      fileId,
      openaiKey,
      userAgent.assistantId,
      novelIdToUse,
      user._id
    );

    return res.status(StatusCodes.OK).json({ 
      message: "Olivia Scene Design completed successfully",
      data: scenesResponse,
      novelId: novelIdToUse,
    });
  } catch (error) {
    console.error("Olivia scenes review error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error", message: error.message });
  }
};

export const getOliviaSceneSuggestions = async (req, res) => {
  try {
    const { novelId } = req.params;
    const userId = req.user._id;

    // Verify novel ownership
    const novel = await Novel.findOne({ _id: novelId, user: userId });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "Novel not found",
      });
    }

    const sceneSuggestions = await OliviaSceneSuggestion.find({
      novel: novelId,
      user: userId,
    })
      .sort({ scene_index: 1 })
      .lean();

    return res.status(StatusCodes.OK).json({
      message: "Olivia Scene Design retrieved successfully",
      data: sceneSuggestions,
    });
  } catch (error) {
    console.error("Get Olivia Scene Design error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};

// =========================================================================
// NEW DEFAULT: Responses API implementations
// =========================================================================

export const generateStory = async (req, res) => {
  try {
    const userId = req.user._id;
    const openaiKey = await getSharedOpenAIKey();

    const {
      novelId,
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
      supportingCharacters,
      subplot,
      summary,
      compTitles,
    } = req.body;

    // When masterPrompt is present (Olivia flow), the prompt is self-contained
    // and individual fields may be incomplete — skip validation and update.
    if (!req.body.masterPrompt) {
      const requiredFields = {
        setting: "Setting",
        narrativeStyle: "Narrative Style",
        genre: "Genre",
        wordCount: "Word Count",
        protagonist: "Protagonist",
        protagonistDescription: "Protagonist Description",
        antagonist: "Antagonist",
        antagonistMotivation: "Antagonist Motivation",
        theme: "Theme",
        themeExploration: "Theme Exploration",
        supportingCharacters: "Supporting Characters",
        subplot: "Subplot",
        summary: "Summary",
        compTitles: "Comparative Titles",
      };

      const missingFields = [];
      for (const [field, label] of Object.entries(requiredFields)) {
        if (!req.body[field]) {
          missingFields.push(label);
        }
      }

      if (missingFields.length > 0) {
        const errorMessage =
          missingFields.length === 1
            ? `${missingFields[0]} is required`
            : `The following fields are required: ${missingFields.join(", ")}`;

        return res.status(StatusCodes.BAD_REQUEST).json({
          error: errorMessage,
        });
      }

      const updatedNovel = await Novel.findByIdAndUpdate(novelId, {
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
        supportingCharacters,
        subplot,
        summary,
        compTitles,
      });

      if (!updatedNovel) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: "Novel not found",
        });
      }
    } else {
      const novel = await Novel.findById(novelId);
      if (!novel) {
        return res.status(StatusCodes.NOT_FOUND).json({
          error: "Novel not found",
        });
      }
    }

    let storyInstructions = "";
    try {
      const promptDoc = await AgentPrompt.findOne({ agentName: "olivia_scenes" });
      if (promptDoc?.prompt) storyInstructions = promptDoc.prompt;
    } catch (_) {
      // proceed without extra instructions
    }

    if (req.body.masterPrompt) {
      storyInstructions += `\n\nSTRUCTURAL OVERLAY RULE (MANDATORY):\nThe writer's Story Bible specifies structural directives (Novel Structure, Structural Overlay, POV rotation, timeline alternation, flashback patterns, ensemble cast rotation). You MUST follow these structural directions for every scene. If the Story Bible says scenes alternate timelines, POVs, or use flashback patterns, each scene MUST follow that pattern in sequence. Read the Story Bible carefully for any structural instructions and apply them precisely.\n\nIf the Story Bible does not specify POV for a given scene position, choose the POV character whose perspective best serves that scene's function and prior outline context; vary POV across scenes when the cast supports it unless the novel specifies strict single-POV.\n`;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await generateStoryFromResponses(
      req.body,
      userId,
      res,
      openaiKey,
      storyInstructions,
      req.user.email,
      1
    );

    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ error: "Internal Server Error" })}\n\n`
    );
    res.end();
  }
};

export const reviewNovel = async (req, res) => {
  try {
    const userId = req.user._id;
    const openaiKey = await getSharedOpenAIKey();
    const { novelId, pillar } = req.body;
    const chapters = [];

    if (!novelId) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "All fields are required" });
    }

    const userContents = await UserContent.find({ novelId, user: userId });
    const reviewOffsets = computeActOffsets(userContents);

    const sceneContents = userContents
      .filter(
        (c) =>
          c.actNumber && c.sceneIndex && c.userContent && c.userContent.trim()
      )
      .sort((a, b) => {
        if (a.actNumber !== b.actNumber) {
          return a.actNumber - b.actNumber;
        }
        return a.sceneIndex - b.sceneIndex;
      })
      .map((c) => {
        const header = `Act ${c.actNumber} | Chapter ${getGlobalSceneNumber(c.actNumber, c.sceneIndex, reviewOffsets)}`;
        let tempBody = {
          name: header,
          actNumber: c.actNumber,
          sceneIndex: c.sceneIndex,
        };
        chapters.push(tempBody);
        const content = c.userContent.trim();
        return `${header}\n\n${content}`;
      })
      .join("\n\n\n");

    if (!sceneContents) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "No scene content found" });
    }

    const instructions = getReviewInstructions(pillar);

    const reviewResponse = await reviewByResponses(
      sceneContents,
      openaiKey,
      instructions,
      pillar,
      chapters,
      novelId,
      userId,
      req.user.email
    );

    res.status(StatusCodes.OK).json({ data: reviewResponse });
  } catch (error) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

export const ellisReview = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.body;

    if (!novelId) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "novelId is required" });
    }

    if (!req.file) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Document file is required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).lean();
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const openaiKey = await getSharedOpenAIKey();

    // Read file content as text for inline inclusion in Responses API
    const fileContent = await readFileContentAsText(
      req.file.buffer,
      req.file.originalname
    );

    let ellisInstructions = "";
    try {
      const promptDoc = await AgentPrompt.findOne({ agentName: "ellis" });
      if (promptDoc?.prompt) ellisInstructions = promptDoc.prompt;
    } catch (_) {
      // proceed without extra instructions
    }

    const reviewResponse = await ellisReviewByResponses(
      fileContent,
      openaiKey,
      ellisInstructions,
      novelId,
      user._id,
      user.email
    );

    return res.status(StatusCodes.OK).json({
      message: "Ellis review completed successfully",
      data: reviewResponse,
    });
  } catch (error) {
    console.error("Ellis review error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error", message: error.message });
  }
};

export const generateCharacter = async (req, res) => {
  try {
    const openaiKey = await getSharedOpenAIKey();
    const {
      _id,
      novelId,
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
      characterId,
    } = req.body;

    if (
      !_id ||
      !novelId ||
      !archetype ||
      !role ||
      !name ||
      !age ||
      !gender ||
      !occupation ||
      !ethnicity ||
      !appearance ||
      !style ||
      !traits ||
      !characterId
    ) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "All fields are required" });
    }

    const novel = await Novel.findById(novelId);

    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    let charInstructions = "";
    try {
      const promptDoc = await AgentPrompt.findOne({ agentName: "olivia_scenes" });
      if (promptDoc?.prompt) charInstructions = promptDoc.prompt;
    } catch (_) {
      // proceed without extra instructions
    }

    const characterResponse = await generateCharacterFromResponses(
      req.body,
      openaiKey,
      charInstructions,
      req.user._id,
      req.user.email
    );

    const updatedCharacter = await Character.findOneAndUpdate(
      { _id, novel: novelId },
      {
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
        responseText: characterResponse,
      },
      { new: true }
    );

    if (!updatedCharacter) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Character not found" });
    }

    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "novel",
      description: "Character generated/updated (Responses API)",
      metadata: { novelId: String(novelId), characterId: String(characterId) },
    });
    res.status(StatusCodes.OK).json(updatedCharacter);
  } catch (e) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

const normalizeOutlineTitle = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/**
 * Return the names of every outline novel created from a given Olivia thread,
 * scoped to the authenticated user. Used by the FE to auto-suggest a
 * version-bumped working title (e.g. "[Project Title] - Outline Version 2")
 * when the user opts to create another outline from the same Story Bible.
 *
 * GET /api/novel/by-thread/:threadId/outlines
 * Response: { outlines: [{ id, name }] }
 */
export const getOutlineSiblingsByThread = async (req, res) => {
  try {
    const userId = req.user._id;
    const threadIdStr =
      req.params?.threadId != null && String(req.params.threadId).trim()
        ? String(req.params.threadId).trim()
        : null;

    if (!threadIdStr) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "threadId is required" });
    }

    const siblings = await Novel.find({
      user: userId,
      sourceOliviaAgentThreadId: threadIdStr,
    })
      .select("_id name")
      .lean();

    return res.status(StatusCodes.OK).json({
      outlines: siblings.map((s) => ({ id: String(s._id), name: s.name })),
    });
  } catch (error) {
    console.error("getOutlineSiblingsByThread error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
};

export const createNovelFromOliviaResponse = async (req, res) => {
  try {
    const userId = req.user._id;
    const { oliviaResponse, sourceThreadId, forceNew, proposedNovelName } = req.body;
    const forceNewBool = forceNew === true || forceNew === "true";

    if (!oliviaResponse) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Olivia response is required",
      });
    }

    const novelData = extractNovelDataFromResponse(oliviaResponse);

    const wordCount = Number(novelData.wordCount);
    const safeWordCount = Number.isFinite(wordCount) && wordCount >= 0 ? wordCount : undefined;

    const storyBibleAuthor =
      typeof novelData.storyBibleAuthor === "string" &&
      novelData.storyBibleAuthor.trim()
        ? novelData.storyBibleAuthor.trim()
        : undefined;

    const baseNovelFields = {
      bookIdea: oliviaResponse,
      masterPrompt: oliviaResponse,
      // Pre-populate the dossier-free Story Bible so the assembler does not
      // depend on a getNovelDetails lazy-heal for fresh novels.
      storyBible: stripDossierBlocksFromMasterPrompt(oliviaResponse),
      setting: novelData.setting,
      narrativeStyle: novelData.narrativeStyle,
      genre: novelData.genre,
      storyBibleAuthor,
      wordCount: safeWordCount,
      protagonist: novelData.protagonist,
      protagonistDescription: novelData.protagonistDescription,
      antagonist: novelData.antagonist,
      antagonistMotivation: novelData.antagonistMotivation,
      theme: novelData.theme,
      themeExploration: novelData.themeExploration,
      supportingCharacters: novelData.supportingCharacters,
      subplot: novelData.subplot,
      worldBuilding: novelData.worldBuilding,
      specialElements: novelData.specialElements,
      summary: novelData.summary,
      compTitles: novelData.compTitles,
    };

    const persistDossiers = async (novel) => {
      const dossierCharacters = Array.isArray(novelData.characterDossiers)
        ? novelData.characterDossiers
        : [];
      for (const entry of dossierCharacters) {
        await safeUpsertDossierCharacter(novel._id, entry);
      }
      if (dossierCharacters.length > 0) {
        await Novel.updateOne(
          { _id: novel._id },
          { $set: { characterDossiersHydrated: true } }
        );
      }
      if (
        dossierCharacters.length === 0 &&
        /CHARACTER\s+DOSSIERS/i.test(oliviaResponse || "")
      ) {
        console.warn(
          `[createNovelFromOlivia] novelId=${novel._id} — CHARACTER DOSSIERS section present but 0 dossiers parsed (regex mismatch?)`
        );
      }
    };

    const threadIdStr =
      sourceThreadId != null && String(sourceThreadId).trim()
        ? String(sourceThreadId).trim()
        : null;

    // Legacy: no thread link — always create (no modal / sibling checks).
    if (!threadIdStr) {
      const novel = await Novel.create({
        user: userId,
        name: novelData.name || "Untitled Novel",
        ...baseNovelFields,
      });
      await persistDossiers(novel);
      queueActivityLog({
        req,
        userId,
        action: "create",
        module: "novel",
        description: "Novel created from Olivia response",
        metadata: { novelId: String(novel._id) },
      });
      return res.status(StatusCodes.OK).json({ novelId: novel._id });
    }

    const threadDoc = await Thread.findOne({
      threadId: threadIdStr,
      userId: userId,
      agentName: "olivia",
    });
    if (!threadDoc) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Invalid sourceThreadId for this user",
      });
    }

    if (threadDoc.outlineNovelId) {
      const primaryAlive = await Novel.findById(threadDoc.outlineNovelId)
        .select("_id")
        .lean();
      if (!primaryAlive) {
        await Thread.updateOne(
          { _id: threadDoc._id },
          { $set: { outlineNovelId: null } }
        );
        threadDoc.outlineNovelId = null;
      }
    }

    const rawName =
      proposedNovelName != null && String(proposedNovelName).trim() !== ""
        ? String(proposedNovelName).trim()
        : novelData.name || "Untitled Novel";

    if (forceNewBool) {
      const siblings = await Novel.find({
        user: userId,
        sourceOliviaAgentThreadId: threadIdStr,
      })
        .select("_id name")
        .lean();

      const norm = normalizeOutlineTitle(rawName);
      const conflict = siblings.some(
        (s) => normalizeOutlineTitle(s.name) === norm
      );
      if (conflict) {
        return res.status(StatusCodes.CONFLICT).json({
          code: "DUPLICATE_OUTLINE_TITLE",
          error: "DUPLICATE_OUTLINE_TITLE",
          message:
            "A novel with this title already exists for this chat. Choose a different working title.",
          siblings: siblings.map((s) => ({
            id: String(s._id),
            name: s.name,
          })),
        });
      }

      const novel = await Novel.create({
        user: userId,
        name: rawName,
        ...baseNovelFields,
        sourceOliviaAgentThreadId: threadIdStr,
      });
      await persistDossiers(novel);
      queueActivityLog({
        req,
        userId,
        action: "create",
        module: "novel",
        description: "New outline novel created from Olivia (force new)",
        metadata: { novelId: String(novel._id), sourceThreadId: threadIdStr },
      });
      return res.status(StatusCodes.OK).json({ novelId: novel._id });
    }

    if (threadDoc.outlineNovelId) {
      const primary = await Novel.findById(threadDoc.outlineNovelId)
        .select("_id")
        .lean();
      if (primary) {
        return res.status(StatusCodes.CONFLICT).json({
          code: "OUTLINE_ALREADY_EXISTS",
          error: "OUTLINE_ALREADY_EXISTS",
          message: "An outline already exists for this chat.",
          primaryNovelId: String(primary._id),
        });
      }
    }

    const novel = await Novel.create({
      user: userId,
      name: rawName,
      ...baseNovelFields,
      sourceOliviaAgentThreadId: threadIdStr,
    });
    await persistDossiers(novel);

    const updated = await Thread.findOneAndUpdate(
      { _id: threadDoc._id, outlineNovelId: null },
      { $set: { outlineNovelId: novel._id } },
      { new: true }
    );

    if (!updated) {
      const t = await Thread.findById(threadDoc._id).select("outlineNovelId").lean();
      const primaryId = t?.outlineNovelId ? String(t.outlineNovelId) : null;
      if (primaryId && primaryId !== String(novel._id)) {
        return res.status(StatusCodes.CONFLICT).json({
          code: "OUTLINE_ALREADY_EXISTS",
          error: "OUTLINE_ALREADY_EXISTS",
          message: "An outline already exists for this chat.",
          primaryNovelId: primaryId,
        });
      }
    }

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "Novel created from Olivia response (linked to thread)",
      metadata: { novelId: String(novel._id), sourceThreadId: threadIdStr },
    });
    return res.status(StatusCodes.OK).json({ novelId: novel._id });
  } catch (error) {
    console.error("createNovelFromOliviaResponse error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Internal Server Error",
      message: error.message || "Failed to create novel from Olivia response",
    });
  }
};

// ---------------------------------------------------------------------------
// Olivia Editor Chat (scene layering agentic flow)
// ---------------------------------------------------------------------------

/** Next unfilled Act 1–3 / Scene 1–5 slot for outline insert confirmations (mirrors Book Editor FE). */
const getNextEmptyOliviaCoreSlot = async (novelId, userId) => {
  const [contents, responses] = await Promise.all([
    UserContent.find({ novelId, user: userId }).lean(),
    StoryResponse.find({ novel: novelId, user: userId }).lean(),
  ]);
  return findNextEmptyOliviaCoreSlot(
    collectFilledOliviaCoreSlotKeys(contents, responses)
  );
};


export const oliviaEditorChat = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const {
      message,
      attachments,
      webSearch,
      outlineLayout,
      outlineRevision,
      outlineChange,
      targetScene,
      manuscriptDraft,
      draftScene,
    } = req.body;
    const resolvedAttachments = Array.isArray(attachments) ? attachments : [];
    const resolvedMessage =
      message?.trim() ||
      (resolvedAttachments.length > 0
        ? `[${resolvedAttachments.length} file${resolvedAttachments.length !== 1 ? "s" : ""} attached]`
        : "");

    if (!novelId || !resolvedMessage) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "novelId and message (or attachments) are required",
      });
    }

    const outlineTableRequested = isOutlineTableQuery(resolvedMessage);

    const resolvedManuscriptDraft =
      typeof manuscriptDraft === "string" ? manuscriptDraft.trim() : "";
    const draftSceneMeta =
      sceneMetaFromPayload(draftScene) ||
      (resolvedManuscriptDraft ? sceneMetaFromPayload(targetScene) : null);

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    let threadId = novel.oliviaEditorThreadId;
    const isFirstEditorContact = !threadId;

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    await ensureNovelStoryBible(novel);

    // Get or create thread scoped to this novel's Olivia editor
    threadId = novel.oliviaEditorThreadId;
    if (isFirstEditorContact && !threadId) {
      threadId = `thread_olivia_editor_${uuidv4()}`;
      novel.oliviaEditorThreadId = threadId;
      await novel.save();
      await Thread.create({
        userId: user._id,
        threadId,
        title: `Olivia Editor - ${novel.name}`,
        assistantId: "responses-api",
        assistantName: "Olivia",
        agentName: "olivia_editor",
        isActive: true,
      });

      // Persist the user's message so it shows up on history reload.
      const userMsg = await Message.create({
        threadId,
        role: "user",
        content: resolvedMessage,
        attachments: resolvedAttachments,
        timestamp: new Date(),
      });

      // Post the layering welcome as Olivia's reply for this very first turn.
      // We deliberately skip the LLM here so the writer sees only the welcome
      // (with its postamble inviting thoughts) before Phase 1 begins on the
      // next user message.
      const welcomeText = await buildLayeringWelcomeText(novelId, user._id, novel);
      const welcomeDoc = await Message.create({
        threadId,
        role: "assistant",
        content: welcomeText,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_LAYERING_WELCOME, {
          excludeFromModelInput: false,
          quickReplies: OLIVIA_LAYERING_QUICK_REPLIES,
        }),
        timestamp: new Date(userMsg.timestamp.getTime() + 1),
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(
        `data: ${JSON.stringify({
          done: true,
          message: {
            id: String(welcomeDoc._id),
            role: "assistant",
            content: welcomeText,
            created_at: welcomeDoc.timestamp,
            threadId,
          },
        })}\n\n`
      );
      res.end();
      return;
    }

    const useMemoryV2 = isOliviaMemoryV2Enabled();
    let manuscriptToolContents = [];
    const loadedDraftNeedRef = { value: null };

    const [promptResult, storyState, activeSceneState, carryDraftNeed] = await Promise.all([
      AgentPrompt.findOne({ agentName: "olivia_editor" }).catch(() => null),
      useMemoryV2 ? ensureStoryStateForNovel(novelId) : StoryState.findOne({ novelId }).lean(),
      useMemoryV2 ? ActiveSceneState.findOne({ novelId }).lean() : null,
      loadCarriedOliviaDraftNeed(threadId),
    ]);
    const baseInstructions = promptResult?.prompt || "";

    let structuralOverlay = "";
    if (novel.storyBible && !useMemoryV2) {
      // `storyBible` is dossier-free (lazy-populated from `masterPrompt`)
      // so the legacy chat path can ship it directly without re-stripping.
      structuralOverlay = `\n\nMASTER PROMPT (provided by the writer — honor all structural directives including Novel Structure, Structural Overlay, POV assignments, and ensemble rotation):\n${novel.storyBible}\n`;
    }

    let instructions;
    let memoryBlockMessage = null;
    let supplementBlockMessage = null;
    let chainHotMemoryBlockMessage = null;
    let lastMutationTs = null;
    let requiresCanonExpansion = false;

    if (useMemoryV2) {
      const [layeringState, resolvedFocus] = await Promise.all([
        buildLayeringStateForNovel(novelId, user._id),
        resolveFocusScene({
          novelId,
          userId: user._id,
          explicitTargetScene: targetScene || draftScene || null,
          activeSceneState,
        }),
      ]);
      const hasNewRows = (layeringState?.layeringRows?.length || 0) > 0;
      const focusScene =
        hasNewRows || targetScene || draftScene ? resolvedFocus : null;
      const storedPhase = storyState?.layeringPhase || "outlining";
      const activePhase =
        !hasNewRows &&
        (storedPhase === "outlining" || storedPhase === "phase1_table")
          ? "phase1_table"
          : storedPhase;
      const phaseRules = getLayeringRuntimeRulesForPhase(activePhase);

      const [{ outlineContext, povRotationBlock, outlineInventoryTable, userContents: editorUserContents }, assembled] = await Promise.all([
        buildOutlineAndPovContext(novelId, user._id, novel, focusScene),
        assembleOliviaContext({
          novel,
          novelId,
          userId: user._id,
          mode: "editor",
          targetScene: focusScene,
          userMessage: resolvedMessage,
          baseInstructions,
          runtimeRules: phaseRules,
        }),
      ]);
      const layeringQueue = buildLayeringQueueBlock(layeringState);

      instructions = assembled.instructions;
      lastMutationTs = assembled.lastMutationTs;
      requiresCanonExpansion = assembled.requiresCanonExpansion;
      memoryBlockMessage = assembled.memoryBlockMessage;
      chainHotMemoryBlockMessage = assembled.chainHotMemoryBlockMessage;

      const bibleSlice = assembled.fullCanonApplied
        ? ""
        : buildMasterPromptSlice(novel.storyBible, {
            layeringPhase: activePhase,
            focusScene,
            novel,
          });

      const editorSceneExtras = buildSceneExtrasBlock(
        applyOliviaAvatarDraftsToExtras({
          extrasArgs: {
            sceneContext: "",
            outlineChange,
            outlineLayout,
            outlineRevision,
            outlineInventoryQuery: outlineTableRequested,
            outlineInventoryTable: outlineTableRequested
              ? outlineInventoryTable
              : "",
          },
          userContents: editorUserContents,
          selectedDraft: resolvedManuscriptDraft,
          selectedMeta: draftSceneMeta,
          draftNeed: carryDraftNeed,
        })
      );
      manuscriptToolContents = editorUserContents;

      supplementBlockMessage = buildOliviaSupplementBlock({
        assembled,
        outlineContext,
        povRotationBlock,
        bibleSlice,
        sceneExtras: editorSceneExtras,
        layeringQueue,
        novel,
      });
    } else {
      const [layeringState, resolvedFocus] = await Promise.all([
        buildLayeringStateForNovel(novelId, user._id),
        resolveFocusScene({
          novelId,
          userId: user._id,
          explicitTargetScene: targetScene || draftScene || null,
          activeSceneState: null,
        }),
      ]);
      const hasNewRows = (layeringState?.layeringRows?.length || 0) > 0;
      const focusScene =
        hasNewRows || targetScene || draftScene ? resolvedFocus : null;
      const { outlineContext, povRotationBlock, outlineInventoryTable, userContents: editorUserContents } =
        await buildOutlineAndPovContext(
          novelId,
          user._id,
          novel,
          focusScene
        );
      const layeringQueue = buildLayeringQueueBlock(layeringState);
      const legacyEditorSceneExtras = buildSceneExtrasBlock(
        applyOliviaAvatarDraftsToExtras({
          extrasArgs: {
            sceneContext: "",
            outlineChange,
            outlineLayout,
            outlineRevision,
            outlineInventoryQuery: outlineTableRequested,
            outlineInventoryTable: outlineTableRequested
              ? outlineInventoryTable
              : "",
          },
          userContents: editorUserContents,
          selectedDraft: resolvedManuscriptDraft,
          selectedMeta: draftSceneMeta,
          draftNeed: carryDraftNeed,
        })
      );
      manuscriptToolContents = editorUserContents;
      instructions = `${baseInstructions}${structuralOverlay}${outlineContext}${povRotationBlock}${legacyEditorSceneExtras ? `\n\n${legacyEditorSceneExtras}` : ""}

${OLIVIA_EDITOR_LAYERING_RUNTIME_RULES}${layeringQueue ? `\n\n${layeringQueue}` : ""}`;
    }

    const tools = buildOliviaResponsesTools({
      webSearch: !!webSearch,
      vectorStoreIds: [novel.oliviaSceneMemoryVectorStoreId],
      loadManuscriptScenes: true,
    });

    await chatWithResponsesAPIStream({
      openaiKey,
      threadId,
      userMessage: resolvedMessage,
      instructions,
      res,
      userId: user._id,
      userEmail: user.email,
      attachments: resolvedAttachments,
      tools,
      resolveFunctionCall: resolveOliviaManuscriptToolCall({
        userContents: manuscriptToolContents,
        selectedDraft: resolvedManuscriptDraft,
        selectedMeta: draftSceneMeta,
        loadedDraftNeedRef,
      }),
      resolveAssistantMetadata: async () => {
        const need = loadedDraftNeedRef.value || carryDraftNeed;
        return need ? { loadedDraftNeed: need } : {};
      },
      useMemoryPipeline: useMemoryV2,
      novelId,
      memoryBlockMessage,
      supplementBlockMessage,
      chainHotMemoryBlockMessage,
      usageEndpoint: "olivia-editor-chat",
      lastMutationTs,
      requiresCanonExpansion,
      // Conversational/brainstorm turns must not be open-ended and must close
      // with the canonical CTA. Skip rich scene deliveries (their own format
      // and post-scene CTA are handled separately).
      transformAssistantText: ({ text }) => {
        if (isRichSceneResponse(text)) return text;
        return sanitizeCoachingConversationalClose(text);
      },
    });
  } catch (error) {
    console.error("oliviaEditorChat error:", error);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
    }
  }
};

export const getOliviaEditorHistory = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    if (!novel.oliviaEditorThreadId) {
      const threadId = `thread_olivia_editor_${uuidv4()}`;
      novel.oliviaEditorThreadId = threadId;
      await novel.save();
      await Thread.create({
        userId: user._id,
        threadId,
        title: `Olivia Editor - ${novel.name}`,
        assistantId: "responses-api",
        assistantName: "Olivia",
        agentName: "olivia_editor",
        isActive: true,
      });
      const welcomeText = await buildLayeringWelcomeText(novelId, user._id, novel);
      await Message.create({
        threadId,
        role: "assistant",
        content: welcomeText,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_LAYERING_WELCOME, {
          excludeFromModelInput: false,
          quickReplies: OLIVIA_LAYERING_QUICK_REPLIES,
        }),
        timestamp: new Date(Date.now() - 5000),
      });
    }

    const threadId = novel.oliviaEditorThreadId;
    const hasLayeringWelcome = await Message.exists({
      threadId,
      "metadata.kind": OLIVIA_METADATA_KIND_LAYERING_WELCOME,
    });
    if (!hasLayeringWelcome) {
      const first = await Message.findOne({ threadId })
        .sort({ timestamp: 1 })
        .select("timestamp")
        .lean();
      const ts = first?.timestamp
        ? new Date(new Date(first.timestamp).getTime() - 2000)
        : new Date(Date.now() - 60000);
      const welcomeText = await buildLayeringWelcomeText(novelId, user._id, novel);
      await Message.create({
        threadId,
        role: "assistant",
        content: welcomeText,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_LAYERING_WELCOME, {
          excludeFromModelInput: false,
          quickReplies: OLIVIA_LAYERING_QUICK_REPLIES,
        }),
        timestamp: ts,
      });
    }

    const { limit, before } = req.query;
    const { messages, hasMore } = await fetchThreadMessagePage({
      threadId,
      limit,
      before,
    });

    const layeringState = await buildLayeringStateForNovel(novelId, user._id);

    res.status(StatusCodes.OK).json({
      messages,
      threadId,
      hasMore,
      layeringState,
    });
  } catch (error) {
    console.error("getOliviaEditorHistory error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Olivia Office 3 Coaching (draft review — separate thread from editor)
// ---------------------------------------------------------------------------

const writeOliviaCoachingSseDone = (res, { threadId, messageDoc }) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const payload = {
    done: true,
    message: {
      id: String(messageDoc._id),
      role: messageDoc.role,
      content: messageDoc.content,
      created_at: messageDoc.timestamp,
      timestamp: messageDoc.timestamp,
      threadId,
    },
  };
  const qr = messageDoc.metadata?.quickReplies;
  if (Array.isArray(qr) && qr.length > 0) {
    payload.message.quickReplies = qr;
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  res.end();
};

const ensureOliviaCoachingThread = async ({ novel, userId }) => {
  let threadId = novel.oliviaCoachingThreadId;
  if (threadId) return threadId;
  threadId = `thread_olivia_coaching_${uuidv4()}`;
  novel.oliviaCoachingThreadId = threadId;
  await novel.save();
  await Thread.create({
    userId,
    threadId,
    title: `Olivia Coaching - ${novel.name}`,
    assistantId: "responses-api",
    assistantName: "Olivia Coaching",
    agentName: "olivia_coaching",
    isActive: true,
  });
  return threadId;
};

export const oliviaCoachingChat = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const {
      message,
      attachments,
      webSearch,
      outlineLayout,
      outlineRevision,
      outlineChange,
      targetScene,
      manuscriptDraft,
      manuscriptDraftMissing,
      coachingIntent,
    } = req.body;
    const resolvedAttachments = Array.isArray(attachments) ? attachments : [];
    const resolvedMessage =
      message?.trim() ||
      (resolvedAttachments.length > 0
        ? `[${resolvedAttachments.length} file${resolvedAttachments.length !== 1 ? "s" : ""} attached]`
        : "");

    if (!novelId || !resolvedMessage) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "novelId and message (or attachments) are required",
      });
    }

    const outlineTableRequested = isOutlineTableQuery(resolvedMessage);

    const resolvedManuscriptDraft =
      typeof manuscriptDraft === "string" ? manuscriptDraft.trim() : "";
    const draftMissingForCoachedScene =
      Boolean(manuscriptDraftMissing) && !resolvedManuscriptDraft;
    const coachSceneMeta = targetScene
      ? {
          actNumber: targetScene.actNumber,
          sceneIndex: targetScene.sceneIndex,
          globalSceneNumber: targetScene.globalSceneNumber,
          sceneTitle: targetScene.sceneTitle,
        }
      : null;
    const sceneIdForGate = targetScene?.sceneId != null ? String(targetScene.sceneId) : "";

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }
    await ensureNovelStoryBible(novel);

    const threadId = await ensureOliviaCoachingThread({ novel, userId: user._id });

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    const coachingPromptDoc = await AgentPrompt.findOne({
      agentName: "olivia_coaching",
    })
      .lean()
      .catch(() => null);
    const coachingPromptText = coachingPromptDoc?.prompt?.trim() || "";

    let coachingGateText = null;
    try {
      if (coachingPromptText) {
        coachingGateText = parseOliviaCoachingGateText(coachingPromptText);
      }
    } catch (parseErr) {
      console.error("olivia_coaching gate parse error:", parseErr);
    }

    const intent = coachingIntent || COACHING_INTENT.FOLLOW_UP;
    const coachTrigger = isCoachSceneTrigger({
      coachingIntent: intent,
      message: resolvedMessage,
    });

    const gateAlreadyAsked = sceneIdForGate
      ? await hasCoachingGateAskedForScene(threadId, sceneIdForGate)
      : false;
    const priorCoachingPass = sceneIdForGate
      ? await findLastCoachingFullPassForScene(threadId, sceneIdForGate)
      : null;
    const currentDraftHash = hashManuscriptDraft(resolvedManuscriptDraft);

    const gateFollowUpIntent = sceneIdForGate
      ? await resolveGateFollowUpIntent({
          threadId,
          sceneId: sceneIdForGate,
          message: resolvedMessage,
          coachingIntent: intent,
        })
      : null;

    let revisionReview = false;
    let draftUnchangedSinceFullPass = false;
    let effectiveCoachingIntent = intent;
    let fullCoachingPassRequested = false;

    if (gateFollowUpIntent === COACHING_INTENT.FULL_COACHING_PASS) {
      revisionReview = false;
      draftUnchangedSinceFullPass = false;
      effectiveCoachingIntent = COACHING_INTENT.FULL_COACHING_PASS;
      fullCoachingPassRequested = true;
    } else if (gateFollowUpIntent === COACHING_INTENT.BRAINSTORM) {
      revisionReview = false;
      draftUnchangedSinceFullPass = false;
      effectiveCoachingIntent = COACHING_INTENT.BRAINSTORM;
    } else if (gateFollowUpIntent === COACHING_INTENT.REVISION_REVIEW) {
      const revisionTrigger = true;
      revisionReview = shouldRunRevisionReview({
        priorPass: priorCoachingPass,
        currentDraftHash,
        trigger: revisionTrigger,
      });
      draftUnchangedSinceFullPass = isDraftUnchangedSinceFullPass({
        priorPass: priorCoachingPass,
        currentDraftHash,
        trigger: revisionTrigger,
      });
      if (revisionReview) {
        effectiveCoachingIntent = COACHING_INTENT.REVISION_REVIEW;
      }
    } else {
      // Fix 6 — auto-route revision when prior pass exists and draft changed,
      // or on re-click Coach after gate was already asked.
      const draftChangedSincePass = hasDraftChangedSincePriorPass({
        priorPass: priorCoachingPass,
        currentDraftHash,
      });
      const revisionTrigger =
        isRevisionReviewTrigger({
          message: resolvedMessage,
          coachingIntent: intent,
          coachTrigger,
          gateAlreadyAsked,
        }) || draftChangedSincePass;
      revisionReview = shouldRunRevisionReview({
        priorPass: priorCoachingPass,
        currentDraftHash,
        trigger: revisionTrigger,
      });
      draftUnchangedSinceFullPass = isDraftUnchangedSinceFullPass({
        priorPass: priorCoachingPass,
        currentDraftHash,
        trigger: revisionTrigger,
      });
      if (revisionReview) {
        effectiveCoachingIntent = COACHING_INTENT.REVISION_REVIEW;
      }
    }

    const showCompletionGate =
      coachTrigger &&
      effectiveCoachingIntent === COACHING_INTENT.COACH_SCENE &&
      sceneIdForGate &&
      !gateAlreadyAsked &&
      !revisionReview;

    if (showCompletionGate && !coachingGateText) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error:
          "Olivia coaching prompt is missing or invalid (SCENE COMPLETION GATE section). Update olivia_coaching in Agent Prompts.",
      });
    }

    if (showCompletionGate) {
      await Message.create({
        threadId,
        role: "user",
        content: resolvedMessage,
        attachments: resolvedAttachments,
        timestamp: new Date(),
      });
      const gateDoc = await Message.create({
        threadId,
        role: "assistant",
        content: coachingGateText,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_COACHING_GATE, {
          coachingGatePendingForSceneId: sceneIdForGate,
        }),
        timestamp: new Date(Date.now() + 1),
      });
      writeOliviaCoachingSseDone(res, { threadId, messageDoc: gateDoc });
      return;
    }

    const useMemoryV2 = isOliviaMemoryV2Enabled();

    const [storyState, activeSceneState] = await Promise.all([
      useMemoryV2 ? ensureStoryStateForNovel(novelId) : StoryState.findOne({ novelId }).lean(),
      useMemoryV2 ? ActiveSceneState.findOne({ novelId }).lean() : null,
    ]);
    const baseInstructions = coachingPromptText;

    let instructions;
    let memoryBlockMessage = null;
    let supplementBlockMessage = null;
    let chainHotMemoryBlockMessage = null;
    let lastMutationTs = null;
    let requiresCanonExpansion = false;

    if (useMemoryV2) {
      const focusScene = await resolveFocusScene({
        novelId,
        userId: user._id,
        explicitTargetScene: targetScene || null,
        activeSceneState,
      });

      const [{ outlineContext, povRotationBlock, outlineInventoryTable }, assembled] = await Promise.all([
        buildOutlineAndPovContext(novelId, user._id, novel, focusScene, "coaching"),
        assembleOliviaContext({
          novel,
          novelId,
          userId: user._id,
          mode: "coaching",
          targetScene: focusScene,
          userMessage: resolvedMessage,
          baseInstructions,
          runtimeRules: "",
        }),
      ]);

      instructions = assembled.instructions;
      lastMutationTs = assembled.lastMutationTs;
      requiresCanonExpansion = assembled.requiresCanonExpansion;
      memoryBlockMessage = assembled.memoryBlockMessage;
      chainHotMemoryBlockMessage = assembled.chainHotMemoryBlockMessage;

      const bibleSlice = assembled.fullCanonApplied
        ? ""
        : buildMasterPromptSlice(novel.storyBible, {
            layeringPhase: storyState?.layeringPhase || "drafting",
            focusScene,
            novel,
          });

      const coachingSceneExtras = buildSceneExtrasBlock({
        sceneContext: "",
        outlineChange,
        outlineLayout,
        outlineRevision,
        outlineInventoryQuery: outlineTableRequested,
        outlineInventoryTable: outlineTableRequested
          ? outlineInventoryTable
          : "",
        manuscriptDraft: resolvedManuscriptDraft,
        coachSceneMeta,
        revisionReview,
        priorCoachingPass,
        draftUnchangedSinceFullPass,
        manuscriptDraftMissing: draftMissingForCoachedScene,
        fullCoachingPassRequested,
      });

      supplementBlockMessage = buildOliviaSupplementBlock({
        assembled,
        outlineContext,
        povRotationBlock,
        bibleSlice,
        sceneExtras: coachingSceneExtras,
        novel,
      });
    } else {
      const focusScene = await resolveFocusScene({
        novelId,
        userId: user._id,
        explicitTargetScene: targetScene || null,
        activeSceneState: null,
      });
      const { outlineContext, povRotationBlock, outlineInventoryTable } =
        await buildOutlineAndPovContext(
        novelId,
        user._id,
        novel,
        focusScene,
        "coaching"
      );
      const legacyExtras = buildSceneExtrasBlock({
        sceneContext: "",
        outlineChange,
        outlineLayout,
        outlineRevision,
        outlineInventoryQuery: outlineTableRequested,
        outlineInventoryTable: outlineTableRequested
          ? outlineInventoryTable
          : "",
        manuscriptDraft: resolvedManuscriptDraft,
        coachSceneMeta,
        revisionReview,
        priorCoachingPass,
        draftUnchangedSinceFullPass,
        manuscriptDraftMissing: draftMissingForCoachedScene,
        fullCoachingPassRequested,
      });
      const structuralOverlay = novel.storyBible
        ? `\n\nMASTER PROMPT (provided by the writer — honor all structural directives):\n${novel.storyBible}\n`
        : "";
      instructions = `${baseInstructions}${structuralOverlay}${outlineContext}${povRotationBlock}${legacyExtras ? `\n\n${legacyExtras}` : ""}`;
    }

    const tools = buildOliviaResponsesTools({
      webSearch: !!webSearch,
      vectorStoreIds: [novel.oliviaSceneMemoryVectorStoreId],
    });

    const coachingSnapshotContext = {
      sceneId: sceneIdForGate,
      manuscriptDraft: resolvedManuscriptDraft,
      coachSceneMeta,
    };

    // Conversational/brainstorm turns must close with the canonical CTA and no
    // branching offers. Skip structured deliverables (six-part full pass /
    // Revision Assessment Template), which carry their own closes.
    const coachingConversationalTurn =
      !fullCoachingPassRequested && !revisionReview;

    await chatWithResponsesAPIStream({
      openaiKey,
      threadId,
      userMessage: resolvedMessage,
      instructions,
      res,
      userId: user._id,
      userEmail: user.email,
      attachments: resolvedAttachments,
      tools,
      useMemoryPipeline: useMemoryV2,
      novelId,
      memoryBlockMessage,
      supplementBlockMessage,
      chainHotMemoryBlockMessage,
      usageEndpoint: "olivia-coaching-chat",
      lastMutationTs,
      requiresCanonExpansion,
      transformAssistantText: ({ text }) => {
        if (!coachingConversationalTurn) return text;
        // Defensive: the model may still emit a full pass on a follow-up turn.
        if (isFullCoachingPass(text)) return text;
        return sanitizeCoachingConversationalClose(text);
      },
      resolveAssistantMetadata: async ({ fullText }) =>
        buildCoachingFullPassMetadata({
          fullText,
          manuscriptDraft: coachingSnapshotContext.manuscriptDraft,
          sceneId: coachingSnapshotContext.sceneId,
          coachSceneMeta: coachingSnapshotContext.coachSceneMeta,
        }),
    });
  } catch (error) {
    console.error("oliviaCoachingChat error:", error);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
    }
  }
};

export const getOliviaCoachingHistory = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    if (!novel.oliviaCoachingThreadId) {
      return res.status(StatusCodes.OK).json({
        messages: [],
        threadId: null,
        hasMore: false,
      });
    }

    const { limit, before } = req.query;
    const { messages, hasMore } = await fetchThreadMessagePage({
      threadId: novel.oliviaCoachingThreadId,
      limit,
      before,
    });

    res.status(StatusCodes.OK).json({
      messages,
      threadId: novel.oliviaCoachingThreadId,
      hasMore,
    });
  } catch (error) {
    console.error("getOliviaCoachingHistory error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

/**
 * Lightweight read-only endpoint that returns the current authoritative
 * layering state for the Olivia editor thread. Used by the frontend after
 * streamed rich-scene deliveries to keep the Insert button's Tier-0 target
 * fresh without a full history refetch.
 */
export const getOliviaLayeringState = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).select("_id").lean();
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    const layeringState = await buildLayeringStateForNovel(novelId, user._id);
    res.status(StatusCodes.OK).json({ layeringState });
  } catch (error) {
    console.error("getOliviaLayeringState error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Olivia Scene-by-Scene Chat (build outline one scene at a time)
// ---------------------------------------------------------------------------

const RICH_SCENE_MARKERS = [
  "📘 Book Coaching for Scene",
  "📝 Scene to Write",
  "🏰 Setting",
  "⚡ Significant Actions",
];

const isRichSceneResponse = (text) =>
  RICH_SCENE_MARKERS.filter((m) => text.includes(m)).length >= 3;

export const oliviaSceneChat = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const {
      message,
      attachments,
      targetScene,
      webSearch,
      outlineLayout,
      outlineRevision,
      outlineChange,
      manuscriptDraft,
      draftScene,
    } = req.body;
    const resolvedAttachments = Array.isArray(attachments) ? attachments : [];
    const resolvedMessage =
      message?.trim() ||
      (resolvedAttachments.length > 0
        ? `[${resolvedAttachments.length} file${resolvedAttachments.length !== 1 ? "s" : ""} attached]`
        : "");

    if (!novelId || !resolvedMessage) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "novelId and message (or attachments) are required",
      });
    }

    const outlineTableRequested = isOutlineTableQuery(resolvedMessage);

    const resolvedManuscriptDraft =
      typeof manuscriptDraft === "string" ? manuscriptDraft.trim() : "";
    const draftSceneMeta = sceneMetaFromPayload(draftScene);

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }
    await ensureNovelStoryBible(novel);

    // Get or create thread scoped to this novel's scene-by-scene chat
    let threadId = novel.oliviaSceneChatThreadId;
    if (!threadId) {
      threadId = `thread_olivia_scene_${uuidv4()}`;
      novel.oliviaSceneChatThreadId = threadId;
      await novel.save();
      await Thread.create({
        userId: user._id,
        threadId,
        title: `Olivia Scene Chat - ${novel.name}`,
        assistantId: "responses-api",
        assistantName: "Olivia",
        agentName: "olivia_scene_chat",
        isActive: true,
      });
      await Message.create({
        threadId,
        role: "assistant",
        content: OLIVIA_SCENE_WELCOME_TEXT,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_SCENE_WELCOME),
        timestamp: new Date(Date.now() - 5000),
      });
    }

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    const promptResult = await AgentPrompt.findOne({ agentName: "olivia_scenes" }).catch(() => null);
    const baseInstructions = promptResult?.prompt || "";

    const useMemoryV2 = isOliviaMemoryV2Enabled();
    let manuscriptToolContents = [];
    const loadedDraftNeedRef = { value: null };
    const carryDraftNeed = await loadCarriedOliviaDraftNeed(threadId);

    let outlineContext = "";
    let povRotationBlock = "";
    let sceneActOffsets = null;

    let structuralOverlay = "";
    if (novel.storyBible && !useMemoryV2) {
      // `storyBible` is dossier-free (lazy-populated from `masterPrompt`)
      // so the legacy chat path can ship it directly without re-stripping.
      structuralOverlay = `\n\nMASTER PROMPT (provided by the writer — honor all structural directives including Novel Structure, Structural Overlay, POV assignments, and ensemble rotation):\n${novel.storyBible}\n`;
    }

    let sceneContext = "";

    // Legacy-only beat hint (V2 uses PromptTemplate via assembleOliviaContext / getMethodologyBlock).
    let storyBeatHint = "";
    if (!useMemoryV2 && targetScene?.actNumber && targetScene?.sceneIndex) {
      const allPrompts = getStoryPrompts(novel);
      const promptIndex =
        (Number(targetScene.actNumber) - 1) * 5 + Number(targetScene.sceneIndex) + 1;
      if (allPrompts[promptIndex]) {
        storyBeatHint = `\n\nSTORY BEAT GUIDANCE FOR THIS SCENE:\nThis scene position calls for the following narrative beat. Use this as creative direction — adapt it to the characters, voice, and events of this specific novel rather than copying it verbatim:\n"${allPrompts[promptIndex]}"`;
      }
    }

    // Scene format spec used to be a multi-KB inline block here. It is now
    // the `OLIVIA_SCENE_FORMAT_RULE` constant, which the Phase 1.5A seed
    // script also appends onto the `olivia_scenes` AgentPrompt row. If the
    // AgentPrompt already contains the rule (post-migration), skip the
    // append to avoid duplication.
    const sceneFormatRule = baseInstructions.includes(
      "SCENE FORMAT RULE (MANDATORY):"
    )
      ? ""
      : `\n\n${OLIVIA_SCENE_FORMAT_RULE}`;

    let instructions;
    let memoryBlockMessage = null;
    let supplementBlockMessage = null;
    let chainHotMemoryBlockMessage = null;
    let lastMutationTs = null;
    let requiresCanonExpansion = false;

    if (useMemoryV2) {
      const [storyState, activeSceneState] = await Promise.all([
        ensureStoryStateForNovel(novelId),
        ActiveSceneState.findOne({ novelId }).lean(),
      ]);
      const activePhase = storyState?.layeringPhase || "outlining";
      const phaseRules = getLayeringRuntimeRulesForPhase(activePhase);

      const focusScene = await resolveFocusScene({
        novelId,
        userId: user._id,
        explicitTargetScene: targetScene,
        activeSceneState,
      });

      const outlinePov = await buildOutlineAndPovContext(
        novelId,
        user._id,
        novel,
        focusScene
      );
      outlineContext = outlinePov.outlineContext;
      povRotationBlock = outlinePov.povRotationBlock;
      sceneActOffsets = outlinePov.actOffsets;

      if (targetScene?.actNumber && targetScene?.sceneIndex) {
        const targetGlobalNum = getGlobalSceneNumber(
          targetScene.actNumber,
          targetScene.sceneIndex,
          sceneActOffsets
        );
        sceneContext = `\n\nCURRENT TARGET: The writer is working on Act ${targetScene.actNumber}, Chapter ${targetGlobalNum}. Build this specific scene when the writer is ready.`;
      }

      const stableBase = `${baseInstructions}${sceneFormatRule}`.trim();

      const assembled = await assembleOliviaContext({
        novel,
        novelId,
        userId: user._id,
        mode: "scene",
        targetScene: focusScene,
        userMessage: resolvedMessage,
        baseInstructions: stableBase,
        runtimeRules: phaseRules,
      });
      instructions = assembled.instructions;
      lastMutationTs = assembled.lastMutationTs;
      requiresCanonExpansion = assembled.requiresCanonExpansion;
      memoryBlockMessage = assembled.memoryBlockMessage;
      chainHotMemoryBlockMessage = assembled.chainHotMemoryBlockMessage;

      const bibleSlice = assembled.fullCanonApplied
        ? ""
        : buildMasterPromptSlice(novel.storyBible, {
            layeringPhase: activePhase,
            focusScene,
            novel,
          });

      const sceneExtras = buildSceneExtrasBlock(
        applyOliviaAvatarDraftsToExtras({
          extrasArgs: attachOliviaSceneSaveStatus(
            {
              sceneContext,
              outlineChange,
              outlineLayout,
              outlineRevision,
              outlineInventoryQuery: outlineTableRequested,
              outlineInventoryTable: outlineTableRequested
                ? outlinePov.outlineInventoryTable
                : "",
            },
            outlinePov,
            targetScene
          ),
          userContents: outlinePov.userContents,
          selectedDraft: resolvedManuscriptDraft,
          selectedMeta: draftSceneMeta,
          draftNeed: carryDraftNeed,
        })
      );
      manuscriptToolContents = outlinePov.userContents;

      supplementBlockMessage = buildOliviaSupplementBlock({
        assembled,
        outlineContext,
        povRotationBlock,
        bibleSlice,
        sceneExtras,
        novel,
      });
    } else {
      const outlinePov = await buildOutlineAndPovContext(
        novelId,
        user._id,
        novel,
        targetScene
      );
      outlineContext = outlinePov.outlineContext;
      povRotationBlock = outlinePov.povRotationBlock;
      sceneActOffsets = outlinePov.actOffsets;

      if (targetScene?.actNumber && targetScene?.sceneIndex) {
        const targetGlobalNum = getGlobalSceneNumber(
          targetScene.actNumber,
          targetScene.sceneIndex,
          sceneActOffsets
        );
        sceneContext = `\n\nCURRENT TARGET: The writer is working on Act ${targetScene.actNumber}, Chapter ${targetGlobalNum}. Build this specific scene when the writer is ready.`;
      }

      const legacySceneExtras = buildSceneExtrasBlock(
        applyOliviaAvatarDraftsToExtras({
          extrasArgs: attachOliviaSceneSaveStatus(
            {
              sceneContext,
              outlineChange,
              outlineLayout,
              outlineRevision,
              outlineInventoryQuery: outlineTableRequested,
              outlineInventoryTable: outlineTableRequested
                ? outlinePov.outlineInventoryTable
                : "",
            },
            outlinePov,
            targetScene
          ),
          userContents: outlinePov.userContents,
          selectedDraft: resolvedManuscriptDraft,
          selectedMeta: draftSceneMeta,
          draftNeed: carryDraftNeed,
        })
      );
      manuscriptToolContents = outlinePov.userContents;
      instructions = `${baseInstructions}${structuralOverlay}${outlineContext}${legacySceneExtras ? `\n\n${legacySceneExtras}` : ""}${storyBeatHint}${povRotationBlock}${sceneFormatRule}`;
    }

    const tools = buildOliviaResponsesTools({
      webSearch: !!webSearch,
      vectorStoreIds: [novel.oliviaSceneMemoryVectorStoreId],
      loadManuscriptScenes: true,
    });

    await chatWithResponsesAPIStream({
      openaiKey,
      threadId,
      userMessage: resolvedMessage,
      instructions,
      res,
      userId: user._id,
      userEmail: user.email,
      attachments: resolvedAttachments,
      tools,
      resolveFunctionCall: resolveOliviaManuscriptToolCall({
        userContents: manuscriptToolContents,
        selectedDraft: resolvedManuscriptDraft,
        selectedMeta: draftSceneMeta,
        loadedDraftNeedRef,
      }),
      resolveAssistantMetadata: async () => {
        const need = loadedDraftNeedRef.value || carryDraftNeed;
        return need ? { loadedDraftNeed: need } : {};
      },
      useMemoryPipeline: useMemoryV2,
      novelId,
      memoryBlockMessage,
      supplementBlockMessage,
      chainHotMemoryBlockMessage,
      usageEndpoint: "olivia-scene-chat",
      lastMutationTs,
      requiresCanonExpansion,
    });
  } catch (error) {
    console.error("oliviaSceneChat error:", error);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
    }
  }
};

// Emojis that mark the start of a recognised Olivia rich-scene section header
const SECTION_EMOJI_RE = /^[📘🎭🧩📝🏰⚡💔🔗📈]/u;

/**
 * Strip any conversational preamble that Olivia prepends before the rich scene.
 * Prefer starting at "Scene Title:" when present (matches olivia-scene prompt order) so
 * extractSceneTitle can read the labeled line; else first emoji section header.
 */
const stripScenePreamble = (text) => {
  if (!text) return text;
  const SCENE_TITLE_START_RE =
    /(?:^|\n)[ \t]*(?:[-*•]\s+)?(?:\*{0,2})?[ \t]*Scene Title[ \t]*(?:\*{0,2})?[ \t]*:/im;
  const EMOJI_SECTION_RE =
    /(?:^|\n)[ \t]*(?:[-*•]\s+)?\**\s*(?:📘\s*Book Coaching for Scene|🎭\s*Genre-Specific Coaching Note|🧩\s*Subplot Reminder|📝\s*Scene to Write|🏰\s*Setting|⚡\s*Significant Actions(?:\s*\([^)]*\))?|💔\s*Emotional Reactions(?:\s*\([^)]*\))?|🔗\s*Subplot Tie-In|📈\s*Character Arc Movement)\s*\**/im;

  const stMatch = SCENE_TITLE_START_RE.exec(text);
  const emMatch = EMOJI_SECTION_RE.exec(text);

  let match = null;
  if (stMatch && emMatch) {
    match = stMatch.index <= emMatch.index ? stMatch : emMatch;
  } else {
    match = stMatch || emMatch;
  }
  if (!match) return text;

  const startIdx = match.index + (match[0].startsWith("\n") ? 1 : 0);
  return text.slice(startIdx).trim();
};

/**
 * Strip any conversational follow-up that Olivia appends after the rich scene.
 * e.g. "Are you happy with this revised Scene 3, or would you like...?"
 * Removes trailing double-newline-separated paragraphs that:
 *   - do not start with a recognised section emoji header, AND
 *   - end with '?' OR match common follow-up phrases
 */
const stripSceneTrailing = (text) => {
  if (!text) return text;
  const FOLLOW_UP_RE =
    /^(are you (happy|satisfied|okay)|would you like|before we move|do you want|shall i|let me know|happy with this)/i;
  const blocks = text.split(/\n\n+/);
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1].trim();
    if (
      last &&
      !SECTION_EMOJI_RE.test(last) &&
      (last.endsWith("?") || FOLLOW_UP_RE.test(last))
    ) {
      blocks.pop();
    } else {
      break;
    }
  }
  return blocks.join("\n\n").trim();
};

/**
 * Remove Olivia post-scene UI so it is not stored in Scene Design.
 *
 * Primary rule: the first line that begins with 👉 is treated as the start of the chat CTA block
 * (e.g. "Insert in Outline"). That line and **everything after it** are dropped, regardless of
 * how the model phrases 🔁, "By the way…", or other trailing copy.
 *
 * Fallback when there is no 👉 line: strip known trailers from the end (🔁, ---, proactive table offer, etc.).
 *
 * Also handles 👉 appended on the same line as 📈 Character Arc Movement (no newline before CTA).
 */
const stripOliviaPostSceneCta = (text) => {
  if (!text) return text;
  let lines = text.replace(/\r\n/g, "\n").split("\n");

  const insertHandIdx = lines.findIndex((line) => /^\s*👉/.test(line));
  if (insertHandIdx !== -1) {
    lines = lines.slice(0, insertHandIdx);
    while (lines.length > 0) {
      const last = lines[lines.length - 1];
      if (/^\s*$/.test(last) || /^\s*\.\s*$/.test(last)) {
        lines.pop();
      } else {
        break;
      }
    }
    let t = lines.join("\n");
    t = t.replace(/([^\n])\s+👉[^\n]*(?:\n🔁[^\n]*)?\s*$/u, "$1");
    return t.trimEnd();
  }

  const isBlank = (line) => /^\s*$/.test(line);
  const isPostSceneLabel = (trimmed) => /POST-SCENE\s+CALL-TO-ACTION/i.test(trimmed);
  const isProactiveTableOfferLine = (trimmed) =>
    /^By the way,?\s/i.test(trimmed) &&
    /scene summary table|summary table|deliver your scenes in a scene summary|where to add depth/i.test(
      trimmed
    );

  let stripped = true;
  while (stripped && lines.length > 0) {
    stripped = false;
    while (lines.length > 0 && isBlank(lines[lines.length - 1])) {
      lines.pop();
      stripped = true;
    }
    if (!lines.length) break;
    const lastLine = lines[lines.length - 1];
    const trimmed = lastLine.trim();
    if (/^\s*👉/.test(lastLine) || /^\s*🔁/.test(lastLine)) {
      lines.pop();
      stripped = true;
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(trimmed)) {
      lines.pop();
      stripped = true;
      continue;
    }
    if (isPostSceneLabel(trimmed)) {
      lines.pop();
      stripped = true;
      continue;
    }
    if (isProactiveTableOfferLine(trimmed)) {
      lines.pop();
      stripped = true;
      continue;
    }
    if (/^just let me know when you/i.test(trimmed) && lines.length >= 2) {
      const prevTrimmed = lines[lines.length - 2].trim();
      if (/^By the way,?\s/i.test(prevTrimmed)) {
        lines.pop();
        lines.pop();
        stripped = true;
        continue;
      }
    }
  }

  let t = lines.join("\n");
  t = t.replace(/([^\n])\s+👉[^\n]*(?:\n🔁[^\n]*)?\s*$/u, "$1");

  return t.trimEnd();
};

export const getOliviaSceneChatHistory = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    if (!novel.oliviaSceneChatThreadId) {
      const threadId = `thread_olivia_scene_${uuidv4()}`;
      novel.oliviaSceneChatThreadId = threadId;
      await novel.save();
      await Thread.create({
        userId: user._id,
        threadId,
        title: `Olivia Scene Chat - ${novel.name}`,
        assistantId: "responses-api",
        assistantName: "Olivia",
        agentName: "olivia_scene_chat",
        isActive: true,
      });
      await Message.create({
        threadId,
        role: "assistant",
        content: OLIVIA_SCENE_WELCOME_TEXT,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_SCENE_WELCOME),
        timestamp: new Date(Date.now() - 5000),
      });
    }

    const threadId = novel.oliviaSceneChatThreadId;
    const hasSceneWelcome = await Message.exists({
      threadId,
      "metadata.kind": OLIVIA_METADATA_KIND_SCENE_WELCOME,
    });
    if (!hasSceneWelcome) {
      const first = await Message.findOne({ threadId })
        .sort({ timestamp: 1 })
        .select("timestamp")
        .lean();
      const ts = first?.timestamp
        ? new Date(new Date(first.timestamp).getTime() - 2000)
        : new Date(Date.now() - 60000);
      await Message.create({
        threadId,
        role: "assistant",
        content: OLIVIA_SCENE_WELCOME_TEXT,
        metadata: oliviaUiMessageMetadata(OLIVIA_METADATA_KIND_SCENE_WELCOME),
        timestamp: ts,
      });
    }

    const { limit, before } = req.query;
    const { messages, hasMore } = await fetchThreadMessagePage({
      threadId,
      limit,
      before,
    });

    res.status(StatusCodes.OK).json({ messages, threadId, hasMore });
  } catch (error) {
    console.error("getOliviaSceneChatHistory error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Explicit scene save (user clicks "Insert into Outline" in Olivia chat)
// ---------------------------------------------------------------------------

export const saveOliviaScene = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.params;
    const { messageId, targetScene } = req.body;

    if (!messageId || !targetScene?.actNumber || !targetScene?.sceneIndex) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "messageId and targetScene (actNumber, sceneIndex) are required",
      });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const msg = await Message.findById(messageId).lean();
    if (!msg || !msg.content) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Message not found" });
    }

    if (!isRichSceneResponse(msg.content)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Message does not contain a valid scene" });
    }

    let actNumber = Number(targetScene.actNumber);
    let sceneIndex = Number(targetScene.sceneIndex);
    let promptKey;

    if (targetScene.sceneId) {
      const ucById = await UserContent.findOne({
        _id: targetScene.sceneId,
        novelId,
        user: user._id,
      }).lean();
      if (ucById) {
        if (ucById.archivedAt) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            error: "Cannot insert into an archived scene. Restore it first.",
          });
        }
        actNumber = Number(ucById.actNumber);
        sceneIndex = Number(ucById.sceneIndex);
        if (ucById.promptKey) promptKey = ucById.promptKey;
      }
    }

    if (!promptKey) {
      promptKey = await resolvePromptKeyForOliviaSave(
        novelId,
        user._id,
        actNumber,
        sceneIndex
      );
    }

    const slotRow = await UserContent.findOne({
      novelId,
      user: user._id,
      actNumber,
      sceneIndex,
    })
      .select("archivedAt")
      .lean();
    if (isArchivedScene(slotRow)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "Cannot insert into an archived scene. Restore it first.",
      });
    }

    // Strip preamble, follow-ups, and fixed post-scene UI lines (👉 / 🔁) before storing
    const sceneContent = stripOliviaPostSceneCta(
      stripSceneTrailing(stripScenePreamble(msg.content))
    );

    const sceneTitle = await resolveSceneTitleForOutline({
      novelId,
      userId: user._id,
      promptKey,
      actNumber,
      sceneIndex,
      sceneContent,
    });

    const hadEmptyCoreSlot = Boolean(
      await getNextEmptyOliviaCoreSlot(novelId, user._id)
    );

    await StoryResponse.findOneAndUpdate(
      { novel: novelId, user: user._id, promptKey },
      { responseText: sceneContent },
      { upsert: true, new: true }
    );

    await UserContent.findOneAndUpdate(
      { novelId, user: user._id, promptKey },
      { sceneIndex, actNumber, sceneTitle },
      { upsert: true, new: true }
    );

    const convHistory = novel.outlineConversationHistory || [];
    const allContentsForConv = await UserContent.find({ novelId, user: user._id }).lean();
    const convOffsets = computeActOffsets(allContentsForConv);
    const convGlobalNum = getGlobalSceneNumber(actNumber, sceneIndex, convOffsets);
    convHistory.push(
      { role: "user", content: `Generate scene for Act ${actNumber}, Chapter ${convGlobalNum}` },
      { role: "assistant", content: sceneContent }
    );

    const updatedNovel = await Novel.findByIdAndUpdate(
      novelId,
      {
        $set: { outlineConversationHistory: convHistory },
        $addToSet: { oliviaSavedOutlineMessageIds: messageId },
      },
      { new: true, select: "oliviaSavedOutlineMessageIds" }
    ).lean();

    let confirmationMessage = null;
    if (novel.oliviaSceneChatThreadId) {
      const next = await getNextEmptyOliviaCoreSlot(novelId, user._id);
      let alreadyPostedSpineLock = false;
      if (!next && hadEmptyCoreSlot) {
        alreadyPostedSpineLock = Boolean(
          await Message.exists({
            threadId: novel.oliviaSceneChatThreadId,
            $or: [
              { "metadata.kind": OLIVIA_METADATA_KIND_CORE_SPINE_LOCKED },
              {
                content: { $regex: /All 15 core (?:scenes|chapters) are now locked/ },
              },
            ],
          })
        );
      }
      const confirm = resolveOliviaCoreSaveConfirm({
        nextEmptySlot: next,
        hadEmptyCoreSlot,
        alreadyPostedSpineLock,
      });
      const confirmDoc = await Message.create({
        threadId: novel.oliviaSceneChatThreadId,
        role: "assistant",
        content: confirm.content,
        metadata: oliviaUiMessageMetadata(confirm.kind, {
          excludeFromModelInput: false,
        }),
        timestamp: new Date(),
      });
      confirmationMessage = {
        _id: confirmDoc._id,
        role: confirmDoc.role,
        content: confirmDoc.content,
        timestamp: confirmDoc.timestamp,
        metadata: confirmDoc.metadata,
      };
    }

    queueActivityLog({
      req,
      userId: user._id,
      action: "update",
      module: "novel",
      description: "Olivia scene saved to outline",
      metadata: { novelId: String(novelId), promptKey, actNumber, sceneIndex },
    });

    // -----------------------------------------------------------------
    // Phase 2 — fire the memory worker to summarize the scene, update
    // story/active/character state, extract episodic events, and update
    // relationship edges. Fire-and-forget on next tick so the user's
    // "Save to Outline" response is never blocked. The worker is fully
    // self-contained: failures log + leave prior state intact.
    //
    // Guard: only run when V2 is on (parity with the Olivia chat path).
    // -----------------------------------------------------------------
    if (isOliviaMemoryV2Enabled()) {
      // Enqueue the worker fan-out behind the per-novel queue so two
      // simultaneous saves on the same novel can't race on
      // StoryState / RelationshipEdge writes. Fire-and-forget — the
      // queue logs failures itself.
      enqueueMemoryJob({
        key: String(novelId),
        label: `saveOliviaScene:A${actNumber}/S${sceneIndex}`,
        run: async () => {
          const openaiKey = await getSharedOpenAIKey();
          const characters = await Character.find({ novel: novelId })
            .select("_id name aliases")
            .lean();
          const characterLookup = {};
          for (const c of characters) {
            if (c.name) characterLookup[c.name.toLowerCase().trim()] = String(c._id);
            for (const a of c.aliases || []) {
              if (a) characterLookup[a.toLowerCase().trim()] = String(c._id);
            }
          }
          await fireSceneMemoryWorker({
            novelId,
            userId: user._id,
            userEmail: user.email,
            sceneRef: { actNumber, sceneIndex, promptKey },
            rawText: sceneContent,
            characterLookup,
            openaiKey,
          });
          // Phase 3 — push the freshly-summarized SceneMemory into the
          // novel's hosted vector store so file_search can recall it.
          // Provisioning is lazy inside the helper; first call creates
          // the store.
          if (isOliviaNovelVectorStoreEnabled()) {
            await syncSceneMemoryToVectorStore({
              novelId,
              sceneRef: { actNumber, sceneIndex },
              openaiKey,
            });
          }
          // Phase 3 — snapshot story-state at the scene boundary so
          // the writer can rewind to this point. No-op when the flag
          // is off; otherwise cap-and-rotate keeps storage bounded.
          if (isOliviaSceneCheckpointsEnabled()) {
            try {
              const { createCheckpoint } = await import(
                "./sceneCheckpointController.js"
              );
              await createCheckpoint({
                novelId,
                userId: user._id,
                sceneRef: { actNumber, sceneIndex },
                createdBy: "auto",
                threadId: novel.oliviaSceneChatThreadId || null,
              });
            } catch (err) {
              console.warn(
                "saveOliviaScene: auto-checkpoint failed (non-blocking):",
                err?.message || err
              );
            }
          }
        },
      });
    }

    res.status(StatusCodes.OK).json({
      success: true,
      actNumber,
      sceneIndex,
      promptKey,
      sceneTitle,
      oliviaSavedOutlineMessageIds: updatedNovel?.oliviaSavedOutlineMessageIds || [],
      confirmationMessage,
    });
  } catch (error) {
    console.error("saveOliviaScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

// ---------------------------------------------------------------------------
// Deferred blurb + synopsis generation (after all 15 scenes are complete)
// ---------------------------------------------------------------------------

export const generateBlurbAndSynopsis = async (req, res) => {
  try {
    const user = req.user;
    const { novelId } = req.body;

    if (!novelId) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "novelId is required" });
    }

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id });
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    const { OpenAI: OpenAIClass } = await import("openai");
    const { default: httpsModule } = await import("https");
    const httpsAgent = new httpsModule.Agent({ rejectUnauthorized: process.env.NODE_ENV === "production" });
    const openai = new OpenAIClass({ apiKey: openaiKey, httpAgent: httpsAgent, httpsAgent });

    const prompts = getStoryPrompts(novel);

    let storyInstructions = "";
    try {
      const promptDoc = await AgentPrompt.findOne({ agentName: "olivia_scenes" });
      if (promptDoc?.prompt) storyInstructions = promptDoc.prompt;
    } catch (_) {}

    // Reconstruct conversation history from outline
    let conversationHistory = novel.outlineConversationHistory || [];
    if (conversationHistory.length === 0) {
      // Rebuild minimal context from existing scenes
      const outlineContext = await buildOutlineContext(novelId, user._id, novel);
      conversationHistory = [
        { role: "user", content: prompts[0] || "" },
        { role: "assistant", content: "I've learned about your novel. Ready for prompts." },
        { role: "user", content: `Here is the current state of the full outline:${outlineContext}` },
        { role: "assistant", content: "I have the full outline context. Ready for the next step." },
      ];
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const logParams = { userId: user._id, userEmail: user.email, endpoint: "generateExtras" };

    // Generate blurb
    const blurbPrompt = prompts[17];
    if (blurbPrompt) {
      conversationHistory.push({ role: "user", content: blurbPrompt });
      const blurbResponse = await callResponsesAPI({
        openai,
        model: OLIVIA_MODEL,
        instructions: storyInstructions || undefined,
        input: conversationHistory,
        temperature: 0.3,
        logParams,
      });
      const blurbText = extractTextFromOutput(blurbResponse.output);
      conversationHistory.push({ role: "assistant", content: blurbText });

      let cleanBlurb = blurbText.replace(/^```json/, "").replace(/```$/, "").trim();
      let blurbJson;
      try { blurbJson = JSON.parse(cleanBlurb); } catch { blurbJson = { text: cleanBlurb }; }

      await StoryResponse.findOneAndUpdate(
        { novel: novelId, user: user._id, promptKey: "bookblurb" },
        { responseText: blurbText },
        { upsert: true, new: true }
      );
      res.write(`data: ${JSON.stringify(blurbJson)}\n\n`);
    }

    // Generate synopsis
    const synopsisPrompt = prompts[18];
    if (synopsisPrompt) {
      conversationHistory.push({ role: "user", content: synopsisPrompt });
      const synResponse = await callResponsesAPI({
        openai,
        model: OLIVIA_MODEL,
        instructions: storyInstructions || undefined,
        input: conversationHistory,
        temperature: 0.3,
        logParams,
      });
      const synText = extractTextFromOutput(synResponse.output);
      conversationHistory.push({ role: "assistant", content: synText });

      let cleanSyn = synText.replace(/^```json/, "").replace(/```$/, "").trim();
      let synJson;
      try { synJson = JSON.parse(cleanSyn); } catch { synJson = { text: cleanSyn }; }

      await StoryResponse.findOneAndUpdate(
        { novel: novelId, user: user._id, promptKey: "synopsis" },
        { responseText: synText },
        { upsert: true, new: true }
      );
      res.write(`data: ${JSON.stringify(synJson)}\n\n`);
    }

    // Generate character profiles if masterPrompt is present
    if (novel.masterPrompt) {
      try {
        const characters = await Character.find({ novel: novelId }).lean();
        for (const character of characters) {
          const profileText = await generateCharacterProfileFromContext({
            openai,
            conversationHistory,
            characterName: character.name,
            characterRole: character.character,
            characterDescription: character.responseText || "",
            instructions: storyInstructions,
            logParams,
          });
          if (profileText) {
            await Character.findByIdAndUpdate(character._id, { responseText: profileText });
            res.write(`data: ${JSON.stringify({
              characterProfile: { characterId: character._id.toString(), name: character.name, role: character.character },
            })}\n\n`);
          }
        }
      } catch (err) {
        console.error("Failed to generate character profiles:", err.message);
      }
    }

    // Update conversation history
    await Novel.findByIdAndUpdate(novelId, { outlineConversationHistory: conversationHistory });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("generateBlurbAndSynopsis error:", error);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Internal Server Error" })}\n\n`);
      res.end();
    }
  }
};

export const insertLayeredScene = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      novelId,
      actNumber,
      afterSceneIndex,
      sceneTitle,
      sceneSuggestionText,
      layeringStableKey,
      sourceMessageId,
      layeringNextCueSuffix,
    } = req.body;

    if (!novelId || actNumber == null || afterSceneIndex == null) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "novelId, actNumber, and afterSceneIndex are required" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId });
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    const newSceneIndex = Number(afterSceneIndex) + 1;

    // Shift all scenes in the act with sceneIndex >= newSceneIndex up by 1
    await UserContent.updateMany(
      {
        novelId,
        user: userId,
        actNumber: Number(actNumber),
        archivedAt: null,
        sceneIndex: { $gte: newSceneIndex },
      },
      { $inc: { sceneIndex: 1 } }
    );

    await syncExtraSlotPromptKeys(novelId, userId, Number(actNumber));

    // Create a unique promptKey for the new layered scene
    const promptKey = `layered_a${actNumber}_${Date.now()}`;

    const newScene = await UserContent.create({
      novelId,
      user: userId,
      sceneTitle: sceneTitle || "New Scene",
      sceneIndex: newSceneIndex,
      actNumber: Number(actNumber),
      promptKey,
      userContent: "",
    });

    let cleanedSuggestion = "";
    if (sceneSuggestionText) {
      cleanedSuggestion = stripOliviaPostSceneCta(
        stripSceneTrailing(stripScenePreamble(sceneSuggestionText))
      );
      await StoryResponse.create({
        novel: novelId,
        user: userId,
        promptKey,
        responseText: cleanedSuggestion,
      });
    }

    if (isOliviaMemoryV2Enabled() && cleanedSuggestion) {
      try {
        const openaiKey = await getSharedOpenAIKey();
        const characters = await Character.find({ novel: novelId })
          .select("_id name aliases")
          .lean();
        const characterLookup = {};
        for (const c of characters) {
          if (c.name) characterLookup[c.name.toLowerCase().trim()] = String(c._id);
          for (const a of c.aliases || []) {
            if (a) characterLookup[a.toLowerCase().trim()] = String(c._id);
          }
        }
        enqueueMemoryJob(() =>
          fireSceneMemoryWorker({
            novelId,
            userId,
            userEmail: req.user?.email,
            sceneRef: {
              actNumber: Number(actNumber),
              sceneIndex: newSceneIndex,
              promptKey,
            },
            rawText: cleanedSuggestion,
            characterLookup,
            openaiKey,
          })
        );
      } catch (memErr) {
        console.error(
          "insertLayeredScene: memory worker enqueue failed (non-blocking):",
          memErr?.message || memErr
        );
      }
    }

    if (layeringStableKey && typeof layeringStableKey === "string") {
      const normalized = layeringStableKey.trim().toLowerCase().slice(0, 256);
      if (normalized) {
        const list = [...(novel.oliviaLayeredInserts || [])];
        const existing = list.findIndex((e) => e.stableKey === normalized);
        const entry = { stableKey: normalized, promptKey };
        if (existing >= 0) list.splice(existing, 1, entry);
        else list.push(entry);
        novel.oliviaLayeredInserts = list;
        await novel.save();
      }
    }

    if (sourceMessageId && mongoose.Types.ObjectId.isValid(String(sourceMessageId))) {
      await Novel.findByIdAndUpdate(novelId, {
        $addToSet: { oliviaSavedOutlineMessageIds: sourceMessageId },
      });
    }

    const novelAfter = await Novel.findById(novelId)
      .select("oliviaSavedOutlineMessageIds oliviaLayeredInserts oliviaEditorThreadId")
      .lean();

    const layeringState = await buildLayeringStateForNovel(novelId, userId);

    let confirmationMessage = null;
    let allLayeringDone = Boolean(
      layeringState?.allDone && (layeringState?.layeringRows?.length || 0) > 0
    );
    const editorThreadId = novelAfter?.oliviaEditorThreadId;
    // Thread ids are custom strings (e.g. thread_olivia_editor_<uuid>), not Mongo ObjectIds.
    if (editorThreadId && String(editorThreadId).trim()) {
      let nextSuffix =
        typeof layeringNextCueSuffix === "string" && layeringNextCueSuffix.trim()
          ? layeringNextCueSuffix.trim()
          : null;
      if (!nextSuffix) {
        const editorMsgs = await Message.find({ threadId: editorThreadId })
          .sort({ timestamp: 1 })
          .select("role content")
          .lean();
        const tableText = findLatestLayeringTableTextFromMessages(editorMsgs);
        const userContentsForCue = await UserContent.find({ novelId, user: userId })
          .select("promptKey")
          .lean();
        nextSuffix = buildLayeringInsertNextCueSuffix(
          tableText,
          novelAfter?.oliviaLayeredInserts,
          userContentsForCue
        );
      }

      const confirmContent = allLayeringDone
        ? `That chapter is now layered into your outline.\n\n${OLIVIA_DRAFTING_TRANSITION_TEXT}`
        : `That chapter is now layered into your outline.\n\n${nextSuffix}`;
      const confirmMetadataKind = allLayeringDone
        ? OLIVIA_METADATA_KIND_DRAFTING_TRANSITION
        : OLIVIA_METADATA_KIND_LAYERING_OUTLINE_CONFIRM;
      const confirmDoc = await Message.create({
        threadId: editorThreadId,
        role: "assistant",
        content: confirmContent,
        metadata: oliviaUiMessageMetadata(confirmMetadataKind, { excludeFromModelInput: false }),
        timestamp: new Date(),
      });
      confirmationMessage = {
        _id: confirmDoc._id,
        role: confirmDoc.role,
        content: confirmDoc.content,
        timestamp: confirmDoc.timestamp,
        metadata: confirmDoc.metadata,
      };

      if (allLayeringDone) {
        await Novel.findByIdAndUpdate(novelId, { layeringComplete: true });
      }
    }

    queueActivityLog({
      req,
      userId,
      action: "create",
      module: "novel",
      description: "Layered scene inserted into outline",
      metadata: { novelId: String(novelId), promptKey },
    });
    res.status(StatusCodes.CREATED).json({
      message: "Scene inserted successfully",
      scene: newScene,
      promptKey,
      oliviaSavedOutlineMessageIds: novelAfter?.oliviaSavedOutlineMessageIds || [],
      oliviaLayeredInserts: novelAfter?.oliviaLayeredInserts || [],
      confirmationMessage,
      layeringComplete: allLayeringDone,
      layeringState,
    });
  } catch (error) {
    console.error("insertLayeredScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

const RICH_SCENE_FORMAT_SUFFIX = `
SCENE TITLE RULE (MANDATORY): The "Scene Title" field MUST be 3–8 words maximum. It is a short sidebar label, NOT a sentence. Examples of correct titles: "Lola's Miami Morning", "The Birthday Party Explosion", "First Meeting in the Rain". Never output a title longer than 8 words. If your draft title is longer, shorten it before responding.

POV RULE (MANDATORY): If the Story Bible specifies a rotating POV, ensemble cast, or alternating character structure, you MUST rotate POV according to that pattern. NEVER deliver more than 2 consecutive scenes from the same character's POV when the overlay specifies rotation. Check the POV ROTATION TRACKER above and choose a different character if the last 2 scenes used the same POV.
If the Story Bible does not specify POV for this scene position, choose the POV character whose perspective best serves this scene's function and the outline context above; vary POV across scenes when the cast supports it unless the novel specifies strict single-POV.`;

const normalizeRichSceneTitleInText = (text) => {
  if (!text || /Scene Title\s*:/i.test(text)) return text;
  const twcIdx = text.search(/📏\s*Target Word Count/i);
  const stwIdx = text.search(/📝\s*Scene to Write/i);
  if (twcIdx === -1 || stwIdx === -1 || twcIdx >= stwIdx) return text;
  const win = text.slice(twcIdx, stwIdx);
  const windowLines = win.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const candidate of windowLines) {
    if (/📏|Target Word Count|\d+\s*words/i.test(candidate)) continue;
    if (/^[*#\-_>|]/.test(candidate)) continue;
    const words = candidate.split(/\s+/).filter(Boolean).length;
    if (words >= 1 && words <= 12 && !candidate.includes(":")) {
      const onlyInWindow = win.replace(candidate, `Scene Title: ${candidate}`);
      return text.slice(0, twcIdx) + onlyInWindow + text.slice(stwIdx);
    }
  }
  return text;
};

const buildRichSceneGenreLabel = (novel) =>
  novel?.genre
    ? novel.genre
        .split(/\n/)[0]
        .replace(/^Genre:\s*/i, "")
        .replace(/\s*[|/]\s*.*$/i, "")
        .trim()
        .slice(0, 80) || "General"
    : "General";

/**
 * Build bounded instructions + input for rich scene generation (V2 assembler when enabled).
 */
const buildRichSceneGenerationPayload = async ({
  novel,
  novelId,
  userId,
  sceneTitle,
  sceneConcept,
  actNumber,
  sceneIndex,
}) => {
  const genreLabel = buildRichSceneGenreLabel(novel);
  const targetScene =
    actNumber && sceneIndex
      ? { actNumber: Number(actNumber), sceneIndex: Number(sceneIndex) }
      : null;

  const { outlineContext, povRotationBlock, actOffsets } =
    await buildOutlineAndPovContext(novelId, userId, novel, targetScene);
  const globalNum = targetScene
    ? getGlobalSceneNumber(targetScene.actNumber, targetScene.sceneIndex, actOffsets)
    : null;

  const sceneRequest = `Please generate a fully detailed scene for my novel with the following concept:\n\n"${sceneConcept}"\n\nScene Position: Act ${actNumber || "?"}, Chapter ${globalNum || sceneIndex || "?"}\n${sceneTitle ? `Scene Title suggestion (keep it 3–8 words): ${sceneTitle}` : ""}\n\nIMPORTANT: This scene must be fully aligned with the rest of the outline above. Reference existing scene progression, character arcs, and emotional beats already established.\n\nUse the exact section format specified in the instructions (Scene Title, POV, 📘 Book Coaching for Scene, 🎭 Genre-Specific Coaching Note (${genreLabel}), 🧩 Subplot Reminder, 📏 Target Word Count, 📝 Scene to Write, 🏰 Setting, ⚡ Significant Actions (Scene Beats), 💔 Emotional Reactions (Character Interiority), 🔗 Subplot Tie-In, 📈 Character Arc Movement).`;

  const tools = buildOliviaResponsesTools({
    webSearch: false,
    vectorStoreId: novel.oliviaSceneMemoryVectorStoreId,
  });

  if (isOliviaMemoryV2Enabled()) {
    const [promptResult, storyState, activeSceneState] = await Promise.all([
      AgentPrompt.findOne({ agentName: "olivia_scenes" }).catch(() => null),
      ensureStoryStateForNovel(novelId),
      ActiveSceneState.findOne({ novelId }).lean(),
    ]);
    const baseInstructions = promptResult?.prompt || "";
    const sceneFormatRule = baseInstructions.includes("SCENE FORMAT RULE (MANDATORY):")
      ? ""
      : `\n\n${OLIVIA_SCENE_FORMAT_RULE}`;
    const stableBase = `${baseInstructions}${sceneFormatRule}`.trim();
    const activePhase = storyState?.layeringPhase || "outlining";
    const phaseRules = getLayeringRuntimeRulesForPhase(activePhase);

    const focusScene = await resolveFocusScene({
      novelId,
      userId,
      explicitTargetScene: targetScene,
      activeSceneState,
    });

    const assembled = await assembleOliviaContext({
      novel,
      novelId,
      userId,
      mode: "scene",
      targetScene: focusScene,
      userMessage: sceneConcept,
      baseInstructions: stableBase,
      runtimeRules: phaseRules,
    });

    const bibleSlice = assembled.fullCanonApplied
      ? ""
      : buildMasterPromptSlice(novel.storyBible, {
          layeringPhase: activePhase,
          focusScene,
          novel,
        });

    const sceneContext =
      targetScene?.actNumber && targetScene?.sceneIndex
        ? `\n\nCURRENT TARGET: The writer is working on Act ${targetScene.actNumber}, Chapter ${globalNum || targetScene.sceneIndex}. Build this specific scene.`
        : "";

    const memoryBlockMessage = buildOliviaDynamicContext({
      assembled,
      outlineContext,
      povRotationBlock,
      bibleSlice,
      sceneExtras: sceneContext.trim(),
      novel,
    });

    const instructions = `${assembled.instructions}${RICH_SCENE_FORMAT_SUFFIX}`;
    const input = [];
    if (memoryBlockMessage) input.push(memoryBlockMessage);
    input.push({ role: "user", content: sceneRequest });

    return { instructions, input, tools };
  }

  const prompts = getStoryPrompts(novel);
  const instructions = `${prompts[1] || ""}${outlineContext}${povRotationBlock}${RICH_SCENE_FORMAT_SUFFIX}`;
  const input = [
    { role: "user", content: prompts[0] || "" },
    { role: "user", content: sceneRequest },
  ];

  return { instructions, input, tools };
};

export const generateRichScene = async (req, res) => {
  try {
    const user = req.user;
    const { novelId, sceneTitle, sceneConcept, actNumber, sceneIndex } = req.body;

    if (!novelId || !sceneConcept) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "novelId and sceneConcept are required" });
    }

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).lean();
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    const { OpenAI: OpenAIClass } = await import("openai");
    const { default: https } = await import("https");
    const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === "production" });
    const openai = new OpenAIClass({
      apiKey: openaiKey,
      httpAgent: httpsAgent,
      httpsAgent,
    });

    const { instructions, input, tools } = await buildRichSceneGenerationPayload({
      novel,
      novelId,
      userId: user._id,
      sceneTitle,
      sceneConcept,
      actNumber,
      sceneIndex,
    });

    const response = await callResponsesAPI({
      openai,
      model: OLIVIA_MODEL,
      instructions,
      input,
      tools,
      temperature: 0.3,
      logParams: {
        userId: user._id,
        userEmail: user.email,
        endpoint: "generateRichScene",
      },
    });

    let text = (response.output || [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("\n");

    text = normalizeRichSceneTitleInText(text);

    res.status(StatusCodes.OK).json({ text });
  } catch (error) {
    console.error("generateRichScene error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error", message: error.message });
  }
};

export const generateRichSceneStream = async (req, res) => {
  try {
    const user = req.user;
    const { novelId, sceneTitle, sceneConcept, actNumber, sceneIndex, promptKey } = req.body;

    if (!novelId || !sceneConcept) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "novelId and sceneConcept are required" });
    }

    let openaiKey;
    try {
      openaiKey = await getSharedOpenAIKey();
    } catch (error) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }

    const novel = await Novel.findOne({ _id: novelId, user: user._id }).lean();
    if (!novel) return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });

    const { OpenAI: OpenAIClass } = await import("openai");
    const { default: https } = await import("https");
    const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === "production" });
    const openai = new OpenAIClass({
      apiKey: openaiKey,
      httpAgent: httpsAgent,
      httpsAgent,
    });

    const { instructions, input, tools } = await buildRichSceneGenerationPayload({
      novel,
      novelId,
      userId: user._id,
      sceneTitle,
      sceneConcept,
      actNumber,
      sceneIndex,
    });

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    let fullText = "";
    let clientDisconnected = false;
    let streamUsage = null;

    const onClose = () => { clientDisconnected = true; };
    res.on("close", onClose);

    try {
      const stream = await openai.responses.create({
        model: OLIVIA_MODEL,
        instructions,
        input,
        tools: tools.length > 0 ? tools : undefined,
        temperature: 0.3,
        stream: true,
      });

      // Keep iterating the stream even after a client disconnect so the
      // final `response.completed` event (which carries usage) is always
      // captured. We just stop writing SSE deltas while disconnected.
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          fullText += event.delta;
          if (!clientDisconnected) {
            res.write(`data: ${JSON.stringify({ token: event.delta })}\n\n`);
          }
        }
        if (event.type === "response.completed" && event.response?.usage) {
          streamUsage = event.response.usage;
        }
      }

      if (user && streamUsage) {
        logApiUsageRaw({
          userId: user._id,
          userEmail: user.email,
          endpoint: "generateRichSceneStream",
          model: OLIVIA_MODEL,
          promptTokens: streamUsage.input_tokens || 0,
          cachedInputTokens:
            streamUsage.input_tokens_details?.cached_tokens || 0,
          completionTokens: streamUsage.output_tokens || 0,
        });
      }

      fullText = normalizeRichSceneTitleInText(fullText);

      // Persist the StoryResponse if promptKey was provided
      if (promptKey && fullText) {
        await StoryResponse.findOneAndUpdate(
          { novel: novelId, user: user._id, promptKey },
          { responseText: fullText },
          { upsert: true, new: true }
        );
      }

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ done: true, text: fullText })}\n\n`);
      }
    } catch (streamError) {
      console.error("generateRichSceneStream streaming error:", streamError);
      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ error: streamError.message || "Failed to generate scene" })}\n\n`);
      }
    } finally {
      res.off("close", onClose);
      if (!res.writableEnded) res.end();
    }
  } catch (error) {
    console.error("generateRichSceneStream error:", error);
    if (!res.headersSent) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error", message: error.message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message || "Internal Server Error" })}\n\n`);
      res.end();
    }
  }
};

export const updateSceneSuggestion = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, promptKey, responseText } = req.body;

    if (!novelId || !promptKey || responseText == null) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "novelId, promptKey, and responseText are required" });
    }

    // Upsert so user-added scenes (which have no StoryResponse yet) can author
    // their first Scene Design without a 404.
    const updated = await StoryResponse.findOneAndUpdate(
      { novel: novelId, user: userId, promptKey },
      { responseText },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Scene design / suggestion updated",
      metadata: { novelId: String(novelId), promptKey },
    });

    if (isOliviaMemoryV2Enabled() && String(responseText || "").trim()) {
      const slot = await UserContent.findOne({
        novelId,
        user: userId,
        promptKey,
      })
        .select("actNumber sceneIndex promptKey")
        .lean();
      if (
        slot?.actNumber != null &&
        slot?.sceneIndex != null &&
        slot?.promptKey
      ) {
        const openaiKey = await getSharedOpenAIKey().catch(() => null);
        memoryOnSceneEdit({
          novelId: String(novelId),
          userId: String(userId),
          userEmail: req.user?.email,
          sceneRef: {
            actNumber: slot.actNumber,
            sceneIndex: slot.sceneIndex,
            promptKey: slot.promptKey,
          },
          newText: responseText,
          openaiKey,
        });
      }
    }

    res.status(StatusCodes.OK).json({ message: "Scene design updated", data: updated });
  } catch (error) {
    console.error("updateSceneSuggestion error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

/** Update editable fields on a character dossier. `character` type is immutable to preserve unique indexes. */
export const updateCharacter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { characterId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(characterId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid characterId" });
    }

    const character = await Character.findById(characterId);
    if (!character) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Character not found" });
    }

    const novel = await Novel.findById(character.novel).select("user").lean();
    if (!novel || String(novel.user) !== String(userId)) {
      return res.status(StatusCodes.FORBIDDEN).json({ error: "Not authorized to update this character" });
    }

    const allowedFields = [
      "responseText",
      "name",
      "role",
      "age",
      "gender",
      "occupation",
      "ethnicity",
      "appearance",
      "style",
      "traits",
      "archetype",
    ];
    const update = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key) && req.body[key] != null) {
        update[key] = String(req.body[key]);
      }
    }

    // Writer is source of truth. Strip Olivia CTA / trailing --- only — do not
    // cut at a second "1. Archetype" (that truncated imported Sudowrite bios).
    if (typeof update.responseText === "string") {
      update.responseText = stripDossierTrailingBridge(update.responseText);
      if (!update.name) {
        const extractedName = extractCharacterNameFromDossier(update.responseText);
        if (extractedName) update.name = extractedName;
      }
    }

    if (typeof update.name === "string") {
      update.name = update.name.trim();
      if (!update.name) delete update.name;
    }

    if (
      update.name &&
      update.name.toLowerCase() !== String(character.name || "").trim().toLowerCase()
    ) {
      const siblings = await Character.find({
        novel: character.novel,
        _id: { $ne: character._id },
      })
        .select("name")
        .lean();
      if (findDuplicateCharacterByName(siblings, update.name)) {
        return res
          .status(StatusCodes.CONFLICT)
          .json({ error: "A character with this name already exists" });
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "No editable fields provided" });
    }

    const updated = await Character.findByIdAndUpdate(
      characterId,
      { $set: update },
      { new: true, runValidators: true }
    );

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Character dossier updated",
      metadata: { novelId: String(character.novel), characterId: String(characterId) },
    });

    if (isOliviaMemoryV2Enabled()) {
      memoryOnCharacterEdit({
        novelId: String(character.novel),
        characterId: String(characterId),
      });
    }

    res.status(StatusCodes.OK).json({ message: "Character updated", data: updated });
  } catch (error) {
    if (error?.code === 11000) {
      return res
        .status(StatusCodes.CONFLICT)
        .json({ error: "A character with this name already exists" });
    }
    console.error("updateCharacter error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

/** Persist Characters-tab accordion order (0-based sortOrder on each Character). */
export const reorderCharacters = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId, orderedIds } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(novelId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid novelId" });
    }
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "orderedIds must be a non-empty array" });
    }

    const novel = await Novel.findOne({ _id: novelId, user: userId })
      .select("_id")
      .lean();
    if (!novel) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    const characters = await Character.find({ novel: novelId }).select("_id").lean();
    if (!characters.length) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "No characters found" });
    }

    const finalOrder = buildCharacterOrderIds(
      characters.map((c) => c._id),
      orderedIds
    );

    await Character.bulkWrite(
      finalOrder.map((id, index) => ({
        updateOne: {
          filter: { _id: id, novel: novelId },
          update: { $set: { sortOrder: index } },
        },
      }))
    );

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Characters reordered",
      metadata: { novelId: String(novelId), count: finalOrder.length },
    });

    res
      .status(StatusCodes.OK)
      .json({ message: "Characters reordered", orderedIds: finalOrder });
  } catch (error) {
    console.error("reorderCharacters error:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error" });
  }
};

/** Insert a writer-created character with a seeded 17-point dossier template. */
export const createManualCharacter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;
    const { name, role, characterType } = req.body || {};

    const { character } = await createManualCharacterRecord({
      novelId,
      userId,
      name,
      role,
      characterType,
      req,
    });

    res.status(StatusCodes.CREATED).json({
      message: "Character created",
      character,
    });
  } catch (error) {
    if (error instanceof CharacterServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("createManualCharacter error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to create character",
    });
  }
};

/** Delete a character dossier the writer owns. */
export const deleteCharacter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { characterId } = req.params;

    const result = await deleteCharacterRecord({
      characterId,
      userId,
      req,
    });

    res.status(StatusCodes.OK).json({
      message: "Character deleted",
      ...result,
    });
  } catch (error) {
    if (error instanceof CharacterServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("deleteCharacter error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: "Failed to delete character",
    });
  }
};

/** Update the Story Bible master prompt for a novel. */
export const updateMasterPrompt = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;
    const { masterPrompt } = req.body;

    if (!mongoose.Types.ObjectId.isValid(novelId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid novelId" });
    }
    if (typeof masterPrompt !== "string") {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "masterPrompt must be a string" });
    }

    const updated = await Novel.findOneAndUpdate(
      { _id: novelId, user: userId },
      { $set: { masterPrompt } },
      { new: true }
    ).select("_id masterPrompt");

    if (!updated) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Story Bible master prompt updated",
      metadata: { novelId: String(novelId) },
    });

    if (isOliviaMemoryV2Enabled()) {
      memoryOnNovelEdit({
        novelId: String(novelId),
        fieldsChanged: ["masterPrompt"],
      });
    }

    res.status(StatusCodes.OK).json({ message: "Story Bible updated", data: updated });
  } catch (error) {
    console.error("updateMasterPrompt error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

/**
 * Update the dossier-free Story Bible for a novel. Writes only to
 * `Novel.storyBible`; `masterPrompt` (the original Olivia "Build this Novel"
 * snapshot used to lazy-heal Character documents) is intentionally left
 * untouched. Every prompt-assembly path reads `storyBible`, so writer edits
 * land immediately in Olivia's next turn.
 */
export const updateStoryBible = async (req, res) => {
  try {
    const userId = req.user._id;
    const { novelId } = req.params;
    const { storyBible } = req.body;

    if (!mongoose.Types.ObjectId.isValid(novelId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Invalid novelId" });
    }
    if (typeof storyBible !== "string") {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "storyBible must be a string" });
    }

    const normalizedStoryBible = ensureStoryBibleApproxOnOwnLine(storyBible);
    const extracted = extractNovelDataFromResponse(normalizedStoryBible);
    const updatePayload = { storyBible: normalizedStoryBible };
    const extractedWordCount = Number(extracted?.wordCount);
    if (Number.isFinite(extractedWordCount) && extractedWordCount > 0) {
      updatePayload.wordCount = extractedWordCount;
    }
    const extractedTitle = extractStoryBibleTitle(normalizedStoryBible);
    if (extractedTitle) {
      updatePayload.name = extractedTitle;
    }

    const updated = await Novel.findOneAndUpdate(
      { _id: novelId, user: userId },
      { $set: updatePayload },
      { new: true }
    )
      .select("_id storyBible wordCount name")
      .lean();

    if (!updated) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Novel not found" });
    }

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "novel",
      description: "Story Bible updated",
      metadata: { novelId: String(novelId) },
    });

    if (isOliviaMemoryV2Enabled()) {
      const fieldsChanged = ["storyBible"];
      if (updatePayload.wordCount !== undefined) fieldsChanged.push("wordCount");
      if (updatePayload.name) fieldsChanged.push("name");
      memoryOnNovelEdit({
        novelId: String(novelId),
        fieldsChanged,
      });
    }

    res.status(StatusCodes.OK).json({ message: "Story Bible updated", data: updated });
  } catch (error) {
    console.error("updateStoryBible error:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
  }
};

export const oliviaScenesReview = async (req, res) => {
  try {
    const user = req.user;
    const { novelId, name, bookIdea } = req.body;

    if (!req.file) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Document file is required" });
    }

    let novel;
    let novelIdToUse = novelId;

    if (novelIdToUse) {
      novel = await Novel.findOne({
        _id: novelIdToUse,
        user: user._id,
      }).lean();
      if (!novel) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .json({ error: "Novel not found" });
      }
    } else {
      if (!name) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: "Novel name is required when creating a new novel" });
      }

      novel = await Novel.create({
        user: user._id,
        name: name || "Untitled Novel",
        bookIdea: bookIdea || "",
        uploaded: true,
      });
      novelIdToUse = novel._id;
    }

    const openaiKey = await getSharedOpenAIKey();

    // Read file content as text for inline inclusion in Responses API
    const fileContent = await readFileContentAsText(
      req.file.buffer,
      req.file.originalname
    );

    let oliviaScenesInstructions = "";
    try {
      const promptDoc = await AgentPrompt.findOne({ agentName: "olivia_scenes" });
      if (promptDoc?.prompt) oliviaScenesInstructions = promptDoc.prompt;
    } catch (_) {
      // proceed without extra instructions
    }

    const scenesResponse = await oliviaScenesByResponses(
      fileContent,
      openaiKey,
      oliviaScenesInstructions,
      novelIdToUse,
      user._id,
      user.email
    );

    return res.status(StatusCodes.OK).json({
      message: "Olivia Scene Design completed successfully",
      data: scenesResponse,
      novelId: novelIdToUse,
    });
  } catch (error) {
    console.error("Olivia scenes review error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Internal Server Error", message: error.message });
  }
};

