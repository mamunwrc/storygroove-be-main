import OpenAI from "openai";
import Novel from "../models/novelModel.js";
import StoryResponse from "../models/storyResponseModel.js";
import UserContent from "../models/userContentModel.js";
import NovelCoverVersion from "../models/novelCoverVersionModel.js";
import NovelCoverMessage from "../models/novelCoverMessageModel.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import GeneratedImage from "../models/generatedImageModel.js";
import {
  OLIVIA_MODEL,
  COVER_CONTEXT_SUMMARY_MODEL,
} from "../constants/models.js";
import { extractTextFromOutput } from "../service/responsesApiService.js";
import { getSharedOpenAIKey } from "../controllers/chatController.js";
import { uploadToS3, deleteFromS3, getFileFromS3 } from "../service/s3Service.js";
import { logApiUsage, logApiUsageRaw } from "../utils/logApiUsage.js";
import {
  generateImages,
  editImages,
  clampPartialImages,
  clampCoverPartialImages,
} from "./openaiImageService.js";
import { runEdit } from "./imageGenerationService.js";
import { buildCoverEditPromptWithMetadata } from "./imagePromptEnhancementService.js";
import {
  buildUploadedManuscriptMetaLines,
} from "../utils/manuscriptText.js";
import {
  assertCanRender,
  getCoverRenderUsage,
  CoverRenderQuotaError,
} from "../utils/coverRenderQuota.js";
import { loadAgentPromptFromDb } from "../utils/loadAgentPrompt.js";
import { resolveCoverUserAction } from "./coverUserActionResolver.js";
import { stripCoverInternalLeaks } from "../utils/coverChatSanitize.js";
import {
  COVER_WELCOME_TEXT,
  COVER_METADATA_KIND_GENERATE_OFFER,
  coverWelcomeMetadata,
  coverGenerateOfferMetadata,
  coverRenderNoticeMetadata,
} from "../constants/coverUiMessages.js";

export { CoverRenderQuotaError, clampCoverPartialImages };

const COVER_LETTER_SUMMARY_INSTRUCTIONS = `You summarize an editorial letter into a compact book-cover brief for an image-concept designer.

Write 300–500 words of plain text (no markdown headings, no bullet lists required).
Focus only on cover-relevant signals:
- Genre, tone, and mood
- Visual motifs and imagery that fit the story's atmosphere
- Setting atmosphere (place, era, weather, light) when relevant
- Comp-title style cues if present
- What to avoid for safety (translate dark plot into aesthetic equivalents; do not describe violence, gore, weapons-on-people, self-harm, sexual content, or drug use)

Do NOT rewrite the editorial letter. Do NOT invent a different genre. Do NOT include title/author placement instructions.`;

export const normalizeS3Key = (raw) => {
  if (!raw) return null;
  let key = String(raw).trim();
  if (key.startsWith("http")) {
    const match = key.match(/\.amazonaws\.com\/(.+)$/);
    if (match) key = match[1];
    else {
      key = key.replace(/^https?:\/\/[^/]+\/?/, "");
    }
  }
  if (key.startsWith("/")) key = key.slice(1);
  return key || null;
};

export const coverUrlFromS3Key = (s3Key) => {
  const key = normalizeS3Key(s3Key);
  return key ? `/${key}` : null;
};

export const collectRawCoverContext = (novel, sceneDesigns) => {
  const parts = [];

  if (novel.genre) parts.push(`Genre: ${novel.genre}`);
  if (novel.name) parts.push(`Title: ${novel.name}`);
  if (novel.storyBibleAuthor) parts.push(`Author Name: ${novel.storyBibleAuthor}`);
  if (novel.setting) parts.push(`Setting: ${novel.setting}`);
  if (novel.protagonist && novel.protagonistDescription) {
    parts.push(`Protagonist: ${novel.protagonist} — ${novel.protagonistDescription}`);
  } else if (novel.protagonist) {
    parts.push(`Protagonist: ${novel.protagonist}`);
  }
  if (novel.theme) parts.push(`Central theme: ${novel.theme}`);
  if (novel.themeExploration) parts.push(`Theme exploration: ${novel.themeExploration}`);
  if (novel.worldBuilding) parts.push(`World-building: ${novel.worldBuilding}`);
  if (novel.specialElements) parts.push(`Special elements: ${novel.specialElements}`);
  if (novel.narrativeStyle) parts.push(`Narrative style: ${novel.narrativeStyle}`);

  const summary = novel.summary || novel.bookIdea;
  if (summary) parts.push(`Story summary: ${summary}`);

  if (Array.isArray(novel.compTitles) && novel.compTitles.length > 0) {
    parts.push(`Writer-supplied comp titles: ${novel.compTitles.join("; ")}`);
  }

  if (sceneDesigns.length > 0) {
    const sceneSnippets = sceneDesigns
      .slice(0, 5)
      .map((sr) => sr.responseText.substring(0, 300))
      .join("\n");
    parts.push(`Key scene summaries:\n${sceneSnippets}`);
  }

  return parts.join("\n\n");
};

export const collectEllisCoverContext = (novel, chapters, letterSummary) => {
  const parts = [];
  const metaLines = buildUploadedManuscriptMetaLines(novel);
  if (metaLines.length) {
    parts.push(metaLines.join("\n"));
  }

  if (letterSummary?.trim()) {
    parts.push(`Editorial letter cover brief:\n${letterSummary.trim()}`);
  }

  const chapterSnippets = (Array.isArray(chapters) ? chapters : [])
    .filter((ch) => ch?.chapterSummary?.trim())
    .slice(0, 8)
    .map((ch) => {
      const label =
        ch.chapterLabel ||
        ch.sceneTitle ||
        (ch.chapterNumber != null ? `Chapter ${ch.chapterNumber}` : "Chapter");
      return `${label}: ${ch.chapterSummary.trim()}`;
    });
  if (chapterSnippets.length > 0) {
    parts.push(`Chapter summaries:\n${chapterSnippets.join("\n")}`);
  }

  return parts.join("\n\n");
};

const ensureEllisCoverLetterSummary = async (openai, novel, logParams) => {
  const existing = String(novel.coverEditorialLetterSummary || "").trim();
  if (existing) return existing;

  const letter = String(novel.editorialLetter || "").trim();
  if (!letter) {
    throw new Error("Editorial letter is required to build a cover summary");
  }

  const response = await openai.responses.create({
    model: COVER_CONTEXT_SUMMARY_MODEL,
    instructions: COVER_LETTER_SUMMARY_INSTRUCTIONS,
    input: letter,
    temperature: 0.3,
  });

  if (logParams) {
    logApiUsage(response, {
      ...logParams,
      model: COVER_CONTEXT_SUMMARY_MODEL,
      endpoint: "ensureEllisCoverLetterSummary",
    });
  }

  const summary = extractTextFromOutput(response.output).trim();
  if (!summary || summary.length < 40) {
    throw new Error("Cover letter summary was empty");
  }

  novel.coverEditorialLetterSummary = summary;
  await novel.save();
  return summary;
};

const buildFallbackCoverPrompt = (novel) => {
  const genreParts = [novel.genre, novel.subgenre].filter(
    (s) => typeof s === "string" && s.trim()
  );
  const genre = genreParts.length
    ? genreParts.map((s) => s.trim()).join(" / ")
    : "literary fiction";
  const title =
    novel.coverWorkingConcept?.displayTitle?.trim() ||
    novel.name ||
    "a novel";
  const author = novel.storyBibleAuthor
    ? ` Author name "${novel.storyBibleAuthor}" centered across the bottom in a complementary typeface.`
    : "";
  return (
    `Professional book cover illustration for a ${genre} novel. ` +
    `Render the title "${title}" prominently in genre-appropriate typography.${author} ` +
    "Evocative artwork using industry-standard genre cues for imagery, typography, and color palette."
  );
};

export const buildFallbackCoverConcept = (novel) => ({
  imagePrompt: buildFallbackCoverPrompt(novel),
  typographyPalette: [],
  comparables: [],
  displayTitle: novel.coverWorkingConcept?.displayTitle?.trim() || null,
});

export const appendCoverTitleOverride = (rawContext, { displayTitle } = {}) => {
  const title = String(displayTitle || "").trim();
  if (!title) return rawContext;
  return (
    `${rawContext}\n\n---\n\n` +
    `COVER TITLE FOR RENDERING (use exactly on cover; overrides Title metadata): ${title}`
  );
};

const mergeCoverConcept = (priorConcept, parsed) => ({
  imagePrompt: parsed.imagePrompt,
  typographyPalette: parsed.typographyPalette,
  comparables: parsed.comparables,
  displayTitle:
    (parsed.displayTitle && String(parsed.displayTitle).trim()) ||
    (priorConcept?.displayTitle && String(priorConcept.displayTitle).trim()) ||
    null,
});

const parseCoverConceptJson = (raw) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Sanitization returned empty result");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Sanitizer response was not JSON");
    parsed = JSON.parse(match[0]);
  }

  const imagePrompt = typeof parsed.imagePrompt === "string" ? parsed.imagePrompt.trim() : "";
  if (!imagePrompt || imagePrompt.length < 20) {
    throw new Error("Sanitizer returned empty imagePrompt");
  }
  if (imagePrompt === "NO_TITLE") {
    throw new Error("Sanitizer reported missing title");
  }

  const typographyPalette = Array.isArray(parsed.typographyPalette)
    ? parsed.typographyPalette
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    : [];
  const comparables = Array.isArray(parsed.comparables)
    ? parsed.comparables
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    : [];

  const displayTitle =
    typeof parsed.displayTitle === "string" && parsed.displayTitle.trim()
      ? parsed.displayTitle.trim()
      : null;

  return { imagePrompt, typographyPalette, comparables, displayTitle };
};

export const sanitizeCoverPrompt = async (openai, rawContext, logParams) => {
  const instructions = await loadAgentPromptFromDb("cover_image_concept");
  const response = await openai.responses.create({
    model: OLIVIA_MODEL,
    instructions,
    input: rawContext,
    temperature: 0.3,
  });

  if (logParams) {
    logApiUsage(response, { ...logParams, model: OLIVIA_MODEL });
  }

  const raw = extractTextFromOutput(response.output).trim();
  return parseCoverConceptJson(raw);
};

export const refineCoverConcept = async (
  openai,
  { rawContext, priorConcept, userFeedback, refinementMode, displayTitle },
  logParams
) => {
  const parts = [
    appendCoverTitleOverride(rawContext, {
      displayTitle: displayTitle || priorConcept?.displayTitle || null,
    }),
  ];

  if (refinementMode === "incremental" && priorConcept?.imagePrompt) {
    parts.unshift(
      "REFINEMENT MODE: INCREMENTAL — Preserve prior composition, imagery, palette, and mood from the prior concept. Apply only title/typography changes described in writer feedback. Do not reinvent the visual concept."
    );
  }

  if (priorConcept?.imagePrompt) {
    parts.push(
      `PRIOR CONCEPT JSON:\n${JSON.stringify(priorConcept, null, 2)}`
    );
  }
  if (userFeedback?.trim()) {
    parts.push(`WRITER FEEDBACK FOR NEXT RENDER:\n${userFeedback.trim()}`);
  }

  const parsed = await sanitizeCoverPrompt(
    openai,
    parts.join("\n\n---\n\n"),
    {
      ...logParams,
      endpoint: logParams?.endpoint || "refineCoverConcept",
    }
  );

  return mergeCoverConcept(priorConcept, parsed);
};

const resolveCoverRenderInput = async ({
  novelId,
  message,
  sourceMessageId,
  offerMsg = null,
}) => {
  let userPrompt = String(message || "").trim();
  let refinementMode = "full";

  let offer = offerMsg;
  if (!offer && sourceMessageId) {
    offer = await NovelCoverMessage.findOne({
      _id: sourceMessageId,
      novelId,
      role: "assistant",
      "metadata.kind": COVER_METADATA_KIND_GENERATE_OFFER,
    }).lean();
  }

  if (offer?.metadata) {
    if (!userPrompt && offer.metadata.renderFeedback) {
      userPrompt = String(offer.metadata.renderFeedback).trim();
    }
    if (offer.metadata.refinementMode === "incremental") {
      refinementMode = "incremental";
    }
    if (!userPrompt && offer.createdAt) {
      const priorUser = await NovelCoverMessage.findOne({
        novelId,
        role: "user",
        kind: "chat",
        createdAt: { $lt: offer.createdAt },
      })
        .sort({ createdAt: -1 })
        .select("text")
        .lean();
      userPrompt = String(priorUser?.text || "").trim();
    }
  }

  return { userPrompt, refinementMode, offerMsg: offer };
};

export async function buildCoverRawContext(novel, novelId, userId, openai, logParams) {
  if (novel.uploaded) {
    const letter = String(novel.editorialLetter || "").trim();
    if (novel.editorialLetterStatus !== "ready" || !letter) {
      const err = new Error(
        "Save Ellis' editorial letter before generating a book cover concept."
      );
      err.statusCode = 400;
      err.code = "EDITORIAL_LETTER_REQUIRED";
      throw err;
    }

    const letterSummary = await ensureEllisCoverLetterSummary(
      openai,
      novel,
      logParams
    );

    const chapters = await UserContent.find({
      novelId,
      user: userId,
    })
      .select("chapterNumber chapterSuffix chapterLabel sceneTitle chapterSummary")
      .sort({ chapterNumber: 1, createdAt: 1 })
      .lean();

    return {
      rawContext: collectEllisCoverContext(novel, chapters, letterSummary),
      sourceHint: "manuscript",
    };
  }

  const sceneDesigns = await StoryResponse.find({
    novel: novelId,
    user: userId,
  })
    .sort({ createdAt: 1 })
    .lean();

  return {
    rawContext: collectRawCoverContext(novel, sceneDesigns),
    sourceHint: "outline",
  };
}

export async function renderCoverImage(
  openai,
  {
    concept,
    novel,
    novelId,
    userId,
    coverImageModel,
    logParams,
    refinementMode = "full",
    priorS3Key = null,
    partialImages = 0,
    onPartialImage = null,
  }
) {
  const settings = {
    model: coverImageModel,
    n: 1,
    size: "1024x1536",
    quality: "high",
    outputFormat: "png",
    background: "auto",
    moderation: "auto",
    partialImages: clampPartialImages(partialImages),
    stream: partialImages > 0,
  };

  const renderWithGenerateFallback = async (prompt) => {
    try {
      return await generateImages(openai, {
        prompt,
        settings,
        onPartialImage,
      });
    } catch (imageErr) {
      if (imageErr.status === 400 || imageErr.code === "content_policy_violation") {
        console.error(
          "Safety rejection on sanitized prompt, retrying with fallback:",
          imageErr.message
        );
        return generateImages(openai, {
          prompt: buildFallbackCoverPrompt(novel),
          settings,
          onPartialImage,
        });
      }
      throw imageErr;
    }
  };

  const tryIncrementalEdit = async () => {
    if (refinementMode !== "incremental" || !priorS3Key) {
      return null;
    }

    let priorBuffer;
    try {
      priorBuffer = await getFileFromS3(priorS3Key);
    } catch (loadErr) {
      console.error(
        "Cover incremental edit: could not load prior image, falling back to generate:",
        loadErr.message
      );
      return null;
    }

    if (!priorBuffer?.length) {
      return null;
    }

    try {
      return await editImages(openai, {
        prompt: concept.imagePrompt,
        settings,
        imageBuffers: [priorBuffer],
        onPartialImage,
      });
    } catch (editErr) {
      console.error(
        "Cover incremental edit failed, falling back to generate:",
        editErr.message
      );
      return null;
    }
  };

  const imageResponse =
    (await tryIncrementalEdit()) ||
    (await renderWithGenerateFallback(concept.imagePrompt));

  const imageBase64 = imageResponse.data[0].b64_json;
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const s3Key = `userData/${userId}/covers/${novelId}-${Date.now()}.png`;
  await uploadToS3(s3Key, imageBuffer, "image/png");

  logApiUsageRaw({
    ...logParams,
    model: coverImageModel,
    imageCount: imageResponse.imageCount,
    ...imageResponse.usageBucket,
  });

  return s3Key;
}

const serializeVersion = (v, activeS3Key) => ({
  id: String(v._id),
  versionNumber: v.versionNumber,
  coverUrl: coverUrlFromS3Key(v.s3Key),
  s3Key: v.s3Key,
  typographyPalette: v.typographyPalette || [],
  comparables: v.comparables || [],
  userPrompt: v.userPrompt || null,
  assistantNote: v.assistantNote || null,
  sourceHint: v.sourceHint || "outline",
  parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null,
  operation: v.operation || "generate",
  generatedImageId: v.generatedImageId ? String(v.generatedImageId) : null,
  promptEnhanced: v.promptEnhanced || null,
  settings: v.settings || null,
  createdAt: v.createdAt,
  isActive: normalizeS3Key(v.s3Key) === normalizeS3Key(activeS3Key),
});

const serializeMessage = (m, coverUrlByVersionId = {}) => ({
  id: String(m._id),
  role: m.role,
  text: m.text,
  kind: m.kind,
  coverVersionId: m.coverVersionId ? String(m.coverVersionId) : null,
  coverUrl: m.coverVersionId
    ? coverUrlByVersionId[String(m.coverVersionId)] || null
    : null,
  attachments: Array.isArray(m.metadata?.attachments)
    ? m.metadata.attachments
    : [],
  metadata: m.metadata || null,
  createdAt: m.createdAt,
});

const sanitizeCoverAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a && a.fileUrl)
    .slice(0, 5)
    .map((a) => ({
      fileUrl: a.fileUrl,
      fileKey: a.fileKey || null,
      fileType: a.fileType || null,
      fileName: a.fileName || "attachment",
    }));
};

const buildCoverUrlMapForMessages = async (messages) => {
  const versionIds = [
    ...new Set(
      messages
        .filter((m) => m.coverVersionId)
        .map((m) => String(m.coverVersionId))
    ),
  ];
  if (!versionIds.length) return {};

  const versions = await NovelCoverVersion.find({ _id: { $in: versionIds } })
    .select("s3Key")
    .lean();

  return Object.fromEntries(
    versions.map((v) => [String(v._id), coverUrlFromS3Key(v.s3Key)])
  );
};

export async function listCoverMessages({ novel, before, limit = 50 }) {
  const safeLimit = Math.min(100, Math.max(10, parseInt(limit, 10) || 50));
  const filter = { novelId: novel._id };
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) {
      filter.createdAt = { $lt: beforeDate };
    }
  }

  const rows = await NovelCoverMessage.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit + 1)
    .lean();

  const hasMore = rows.length > safeLimit;
  const page = (hasMore ? rows.slice(0, safeLimit) : rows).reverse();
  const coverUrlMap = await buildCoverUrlMapForMessages(page);

  return {
    messages: page.map((m) => serializeMessage(m, coverUrlMap)),
    hasMore,
  };
}

export async function listCoverVersions({ novel, page = 1, limit = 12 }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(24, Math.max(6, parseInt(limit, 10) || 12));
  const skip = (safePage - 1) * safeLimit;

  const filter = { novelId: novel._id };
  const [total, versions] = await Promise.all([
    NovelCoverVersion.countDocuments(filter),
    NovelCoverVersion.find(filter)
      .sort({ versionNumber: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  const activeS3Key = novel.coverImage;

  return {
    versions: versions.map((v) => serializeVersion(v, activeS3Key)),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

export async function backfillLegacyCoverVersion(novel, userId) {
  const count = await NovelCoverVersion.countDocuments({ novelId: novel._id });
  if (count > 0) return null;

  const s3Key = normalizeS3Key(novel.coverImage);
  if (!s3Key) return null;

  const version = await NovelCoverVersion.create({
    novelId: novel._id,
    userId,
    s3Key,
    versionNumber: 1,
    typographyPalette: [],
    comparables: [],
    sourceHint: novel.uploaded ? "manuscript" : "outline",
  });

  const msgCount = await NovelCoverMessage.countDocuments({ novelId: novel._id });
  if (msgCount === 0) {
    await NovelCoverMessage.create({
      novelId: novel._id,
      userId,
      role: "assistant",
      text: COVER_WELCOME_TEXT,
      kind: "welcome",
      metadata: coverWelcomeMetadata(),
    });
  }

  return version;
}

/** Ensure the novel's active coverImage has a NovelCoverVersion row (repair partial saves). */
export async function ensureCoverVersionForActiveImage(novel, userId) {
  const s3Key = normalizeS3Key(novel.coverImage);
  if (!s3Key) return null;

  const existing = await NovelCoverVersion.findOne({
    novelId: novel._id,
    s3Key,
  }).lean();
  if (existing) return existing;

  const lastVersion = await NovelCoverVersion.findOne({ novelId: novel._id })
    .sort({ versionNumber: -1 })
    .select("versionNumber")
    .lean();
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  const version = await NovelCoverVersion.create({
    novelId: novel._id,
    userId,
    s3Key,
    versionNumber,
    typographyPalette: novel.coverWorkingConcept?.typographyPalette || [],
    comparables: novel.coverWorkingConcept?.comparables || [],
    sourceHint: novel.uploaded ? "manuscript" : "outline",
    assistantNote: `Recovered cover version ${versionNumber}.`,
  });

  const hasRenderNotice = await NovelCoverMessage.exists({
    novelId: novel._id,
    coverVersionId: version._id,
  });
  if (!hasRenderNotice) {
    await NovelCoverMessage.create({
      novelId: novel._id,
      userId,
      role: "assistant",
      text: `Cover version ${versionNumber} is ready.`,
      kind: "render_notice",
      coverVersionId: version._id,
      metadata: coverRenderNoticeMetadata(version._id),
    });
  }

  return version;
}

export async function ensureCoverWelcomeMessage(novelId, userId) {
  const existing = await NovelCoverMessage.findOne({ novelId, kind: "welcome" });
  if (existing) {
    const isLegacyWelcome =
      existing.text !== COVER_WELCOME_TEXT ||
      /I'm Olivia|I am Olivia/i.test(existing.text) ||
      /Olivia, your book-cover/i.test(existing.text) ||
      /no separate steps/i.test(existing.text) ||
      /Welcome to Book Cover Studio/i.test(existing.text);
    if (isLegacyWelcome) {
      existing.text = COVER_WELCOME_TEXT;
      existing.metadata = coverWelcomeMetadata();
      await existing.save();
    } else if (!existing.metadata?.kind) {
      existing.metadata = coverWelcomeMetadata();
      await existing.save();
    }
    return existing;
  }
  return NovelCoverMessage.create({
    novelId,
    userId,
    role: "assistant",
    text: COVER_WELCOME_TEXT,
    kind: "welcome",
    metadata: coverWelcomeMetadata(),
  });
}

export async function getCoverSessionData({ novel, userId, userRole, messageLimit = 100 }) {
  await backfillLegacyCoverVersion(novel, userId);
  await ensureCoverVersionForActiveImage(novel, userId);
  await ensureCoverWelcomeMessage(novel._id, userId);

  const safeLimit = Math.min(200, Math.max(20, parseInt(messageLimit, 10) || 100));

  const [versionCount, totalMessages, recentMessages, quota] = await Promise.all([
    NovelCoverVersion.countDocuments({ novelId: novel._id }),
    NovelCoverMessage.countDocuments({ novelId: novel._id }),
    NovelCoverMessage.find({ novelId: novel._id })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean(),
    getCoverRenderUsage(userId, { role: userRole }),
  ]);

  const messages = recentMessages.reverse();

  const activeS3Key = novel.coverImage;
  const workingConcept = novel.coverWorkingConcept || {
    imagePrompt: null,
    typographyPalette: [],
    comparables: [],
    displayTitle: null,
  };

  const activeVersion = activeS3Key
    ? await NovelCoverVersion.findOne({
        novelId: novel._id,
        s3Key: activeS3Key,
      }).lean()
    : await NovelCoverVersion.findOne({ novelId: novel._id })
        .sort({ versionNumber: -1 })
        .lean();

  const coverUrlMap = await buildCoverUrlMapForMessages(messages);

  return {
    activeCoverUrl: coverUrlFromS3Key(activeS3Key),
    activeVersionId: activeVersion ? String(activeVersion._id) : null,
    activeVersion: activeVersion
      ? serializeVersion(activeVersion, activeS3Key)
      : null,
    versionCount,
    workingConcept: {
      imagePrompt: workingConcept.imagePrompt || null,
      typographyPalette: workingConcept.typographyPalette || [],
      comparables: workingConcept.comparables || [],
      displayTitle: workingConcept.displayTitle || null,
    },
    messages: messages.map((m) => serializeMessage(m, coverUrlMap)),
    hasMoreMessages: totalMessages > messages.length,
    messageCount: totalMessages,
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      unlimited: quota.unlimited,
      resetsAt: quota.resetsAt,
    },
  };
}

export async function runCoverChat({ novel, userId, userEmail, userRole, message, attachments }) {
  const trimmed = String(message || "").trim();
  const cleanAttachments = sanitizeCoverAttachments(attachments);
  if (!trimmed && cleanAttachments.length === 0) {
    const err = new Error("Message is required");
    err.statusCode = 400;
    throw err;
  }

  const effectiveText =
    trimmed ||
    `Shared ${cleanAttachments.length} reference file${
      cleanAttachments.length === 1 ? "" : "s"
    }.`;

  const userMsg = await NovelCoverMessage.create({
    novelId: novel._id,
    userId,
    role: "user",
    text: effectiveText,
    kind: "chat",
    metadata: cleanAttachments.length
      ? { attachments: cleanAttachments }
      : null,
  });

  const openaiKey = await getSharedOpenAIKey();
  const openai = new OpenAI({ apiKey: openaiKey });

  const logParams = {
    userId,
    userEmail,
    endpoint: "coverChat",
  };

  const priorMessages = await NovelCoverMessage.find({ novelId: novel._id })
    .sort({ createdAt: 1 })
    .select("role text kind metadata")
    .lean();

  const chatHistory = priorMessages
    .filter((m) => m.kind === "chat" || m.kind === "welcome")
    .slice(-12)
    .map((m) => `${m.role === "user" ? "Writer" : "Studio"}: ${m.text}`)
    .join("\n\n");

  const { action, refinementMode = "full" } = await resolveCoverUserAction({
    message: effectiveText,
    priorMessages,
    hasAttachments: cleanAttachments.length > 0,
    hasWorkingConcept: Boolean(novel.coverWorkingConcept?.imagePrompt),
    openai,
    model: OLIVIA_MODEL,
  });

  let rawContext;
  try {
    ({ rawContext } = await buildCoverRawContext(
      novel,
      novel._id,
      userId,
      openai,
      { ...logParams, endpoint: "coverChatContext" }
    ));
  } catch (e) {
    if (e.code === "EDITORIAL_LETTER_REQUIRED") {
      const assistantText =
        "Before we design your cover, please save Ellis' editorial letter. Once that's ready, Cover Studio can help you explore cover direction and generate concepts.";
      const assistantMsg = await NovelCoverMessage.create({
        novelId: novel._id,
        userId,
        role: "assistant",
        text: assistantText,
        kind: "chat",
      });
      return {
        userMessage: serializeMessage(userMsg),
        message: serializeMessage(assistantMsg),
        workingConcept: novel.coverWorkingConcept,
      };
    }
    throw e;
  }

  const attachmentNote = cleanAttachments.length
    ? `\n\n---\n\nThe writer attached ${cleanAttachments.length} reference file${
        cleanAttachments.length === 1 ? "" : "s"
      }: ${cleanAttachments.map((a) => a.fileName).join(", ")}. Acknowledge them as visual references for the cover direction.`
    : "";

  const modeNote =
    action === "offer_generation"
      ? refinementMode === "incremental"
        ? "\n\n---\n\nMODE: GENERATION OFFER (INCREMENTAL REVISION). Reply in 3–5 sentences plus up to 3 short bullets (mood, palette, exact cover title spelling, what stays the same from the prior version). Note the next version will follow the same direction with their fix. No JSON or imagePrompt."
        : "\n\n---\n\nMODE: GENERATION OFFER. Reply in 3–5 sentences plus up to 3 short bullets (mood, palette, cover title spelling, one visual anchor). Confirm they can click Generate cover image on your message. No JSON or imagePrompt."
      : "";

  const coverChatInstructions = await loadAgentPromptFromDb("cover_studio");

  const chatResponse = await openai.responses.create({
    model: OLIVIA_MODEL,
    instructions: coverChatInstructions,
    input: `STORY METADATA:\n${rawContext}\n\n---\n\nRECENT CONVERSATION:\n${chatHistory}\n\n---\n\nWriter's latest message:\n${effectiveText}${attachmentNote}${modeNote}`,
    temperature: 0.5,
  });

  logApiUsage(chatResponse, { ...logParams, model: OLIVIA_MODEL });

  let assistantText = stripCoverInternalLeaks(
    extractTextFromOutput(chatResponse.output).trim()
  );
  if (!assistantText) {
    const err = new Error("Cover chat returned empty response");
    err.statusCode = 500;
    throw err;
  }

  let workingConcept = {
    imagePrompt: novel.coverWorkingConcept?.imagePrompt || null,
    typographyPalette: novel.coverWorkingConcept?.typographyPalette || [],
    comparables: novel.coverWorkingConcept?.comparables || [],
    displayTitle: novel.coverWorkingConcept?.displayTitle || null,
  };

  if (action === "refine_concept" || action === "offer_generation") {
    try {
      const refined = await refineCoverConcept(
        openai,
        {
          rawContext,
          priorConcept: workingConcept.imagePrompt ? workingConcept : null,
          userFeedback: effectiveText,
          refinementMode:
            action === "offer_generation" ? refinementMode : undefined,
          displayTitle: workingConcept.displayTitle,
        },
        { ...logParams, endpoint: "coverChatRefine" }
      );
      workingConcept = refined;
      novel.coverWorkingConcept = refined;
      await novel.save();
    } catch (refineErr) {
      console.error("coverChat refine failed (non-fatal):", refineErr.message);
    }
  }

  const quota = await getCoverRenderUsage(userId, { role: userRole });
  const offerGeneration = action === "offer_generation";

  const assistantMsg = await NovelCoverMessage.create({
    novelId: novel._id,
    userId,
    role: "assistant",
    text: assistantText,
    kind: "chat",
    metadata: offerGeneration
      ? coverGenerateOfferMetadata({
          quotaAvailable: quota.unlimited || (quota.remaining ?? 0) > 0,
          renderFeedback: effectiveText,
          refinementMode,
        })
      : null,
  });

  return {
    userMessage: serializeMessage(userMsg),
    message: serializeMessage(assistantMsg),
    workingConcept,
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      unlimited: quota.unlimited,
      resetsAt: quota.resetsAt,
    },
  };
}

export async function runCoverRender({
  novel,
  userId,
  userEmail,
  userRole,
  message,
  sourceMessageId,
  sseWrite = null,
}) {
  await assertCanRender(userId, { role: userRole });

  let offerMsg = null;
  if (sourceMessageId) {
    offerMsg = await NovelCoverMessage.findOne({
      _id: sourceMessageId,
      novelId: novel._id,
      role: "assistant",
      "metadata.kind": COVER_METADATA_KIND_GENERATE_OFFER,
    }).lean();
    if (offerMsg?.metadata?.generationConsumed) {
      const err = new Error("This cover generation offer was already used.");
      err.statusCode = 409;
      throw err;
    }
  }

  const openaiKey = await getSharedOpenAIKey();
  const openai = new OpenAI({ apiKey: openaiKey });

  const coverLogParams = {
    userId,
    userEmail,
    endpoint: "renderBookCover",
  };

  const { rawContext, sourceHint } = await buildCoverRawContext(
    novel,
    novel._id,
    userId,
    openai,
    coverLogParams
  );

  const { userPrompt, refinementMode } = await resolveCoverRenderInput({
    novelId: novel._id,
    message,
    sourceMessageId,
    offerMsg,
  });

  const prior = novel.coverWorkingConcept || {};

  let concept;
  try {
    if (prior?.imagePrompt || userPrompt) {
      concept = await refineCoverConcept(
        openai,
        {
          rawContext,
          priorConcept: prior.imagePrompt ? prior : null,
          userFeedback: userPrompt,
          refinementMode,
          displayTitle: prior.displayTitle || null,
        },
        coverLogParams
      );
    } else {
      concept = await sanitizeCoverPrompt(
        openai,
        appendCoverTitleOverride(rawContext, {
          displayTitle: prior.displayTitle || null,
        }),
        coverLogParams
      );
    }
  } catch (sanitizeErr) {
    console.error("Cover prompt sanitization failed, using fallback:", sanitizeErr.message);
    concept = buildFallbackCoverConcept(novel);
  }

  const globalSettings = await ApiUsageSettings.getSettings();
  const coverImageModel = globalSettings?.coverImageModel || "gpt-image-2";
  const partialImages = clampCoverPartialImages(
    globalSettings?.coverImagePartialImages ?? 0
  );

  const onPartialImage =
    sseWrite && partialImages > 0
      ? (b64, index) => {
          sseWrite({ partial: true, index, b64 });
        }
      : null;

  const s3Key = await renderCoverImage(openai, {
    concept,
    novel,
    novelId: novel._id,
    userId,
    coverImageModel,
    logParams: coverLogParams,
    refinementMode,
    priorS3Key: novel.coverImage || null,
    partialImages,
    onPartialImage,
  });

  const lastVersion = await NovelCoverVersion.findOne({ novelId: novel._id })
    .sort({ versionNumber: -1 })
    .select("versionNumber")
    .lean();
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  const assistantNote = `Cover version ${versionNumber} is ready.`;
  const coverOperation =
    refinementMode === "incremental" && novel.coverImage ? "edit" : "generate";

  const generatedImage = await GeneratedImage.create({
    userId,
    rootId: new GeneratedImage()._id,
    parentId: null,
    versionNumber: 1,
    operation: coverOperation,
    promptOriginal: userPrompt || concept.imagePrompt || "",
    promptEnhanced: null,
    promptSent: concept.imagePrompt,
    model: coverImageModel,
    settings: {
      size: "1024x1536",
      quality: "high",
      partialImages,
    },
    sourceImageKey: coverOperation === "edit" ? novel.coverImage : null,
    outputImageKey: s3Key,
    outputImageKeys: [s3Key],
    novelId: novel._id,
    status: "completed",
  });
  generatedImage.rootId = generatedImage._id;
  await generatedImage.save();

  let version;
  let renderMsg;
  try {
    version = await NovelCoverVersion.create({
      novelId: novel._id,
      userId,
      s3Key,
      versionNumber,
      typographyPalette: concept.typographyPalette || [],
      comparables: concept.comparables || [],
      userPrompt: userPrompt || null,
      assistantNote,
      sourceHint,
      operation: coverOperation,
      generatedImageId: generatedImage._id,
      settings: generatedImage.settings,
    });

    novel.coverImage = s3Key;
    novel.coverWorkingConcept = concept;
    await novel.save();

    renderMsg = await NovelCoverMessage.create({
      novelId: novel._id,
      userId,
      role: "assistant",
      text: assistantNote,
      kind: "render_notice",
      coverVersionId: version._id,
      metadata: coverRenderNoticeMetadata(version._id),
    });

    if (sourceMessageId) {
      await NovelCoverMessage.updateOne(
        {
          _id: sourceMessageId,
          novelId: novel._id,
          "metadata.kind": COVER_METADATA_KIND_GENERATE_OFFER,
        },
        {
          $set: {
            "metadata.generationConsumed": true,
            "metadata.consumedCoverVersionId": String(version._id),
          },
        }
      );
    }
  } catch (persistErr) {
    try {
      await deleteFromS3(s3Key);
    } catch (cleanupErr) {
      console.error(
        "Failed to delete orphan cover image after DB error:",
        cleanupErr.message
      );
    }
    throw persistErr;
  }

  const quota = await getCoverRenderUsage(userId, { role: userRole });

  const coverUrl = coverUrlFromS3Key(s3Key);
  const coverUrlMap = { [String(version._id)]: coverUrl };

  return {
    coverUrl,
    version: serializeVersion(version, s3Key),
    typographyPalette: concept.typographyPalette || [],
    comparables: concept.comparables || [],
    message: serializeMessage(renderMsg, coverUrlMap),
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      unlimited: quota.unlimited,
      resetsAt: quota.resetsAt,
    },
  };
}

export async function runCoverEdit({
  novel,
  userId,
  userEmail,
  userRole,
  baseVersionId,
  prompt,
  maskBuffer = null,
  enhancePrompt = false,
  sseWrite = null,
}) {
  await assertCanRender(userId, { role: userRole });

  const baseVersion = await NovelCoverVersion.findOne({
    _id: baseVersionId,
    novelId: novel._id,
    userId,
  }).lean();

  if (!baseVersion) {
    const err = new Error("Cover version not found.");
    err.statusCode = 404;
    throw err;
  }

  const globalSettings = await ApiUsageSettings.getSettings();
  const partialImages = clampPartialImages(
    globalSettings?.coverImagePartialImages ?? 0
  );
  const settingsOverrides = {
    model: globalSettings?.coverImageModel || "gpt-image-2",
    size: "1024x1536",
    quality: "high",
    outputFormat: "png",
    partialImages,
    stream: Boolean(sseWrite) && partialImages > 0,
  };

  const parentRecord = baseVersion.generatedImageId
    ? await GeneratedImage.findOne({
        _id: baseVersion.generatedImageId,
        userId,
      })
    : null;

  const sourceBuffer = await getFileFromS3(baseVersion.s3Key);
  const coverKeyStamp = Date.now();

  const displayTitle =
    novel.coverWorkingConcept?.displayTitle?.trim() ||
    novel.name?.trim() ||
    null;
  const authorName = novel.storyBibleAuthor?.trim() || null;
  const editPrompt = buildCoverEditPromptWithMetadata(prompt, {
    displayTitle,
    authorName,
  });

  const generated = await runEdit({
    userId,
    userEmail,
    prompt: editPrompt,
    sourceBuffer,
    maskBuffer,
    settingsOverrides,
    enhancePrompt,
    parentRecord,
    novelId: novel._id,
    sourceImageKeyOverride: baseVersion.s3Key,
    onPartialImage: sseWrite
      ? (b64, index) => sseWrite({ partial: true, index, b64 })
      : null,
    endpoint: maskBuffer ? "coverEditWithMask" : "coverEdit",
    outputKeyBuilder: ({ userId: uid, novelId: nid }) =>
      `userData/${uid}/covers/${nid || novel._id}-${coverKeyStamp}.png`,
  });

  const lastVersion = await NovelCoverVersion.findOne({ novelId: novel._id })
    .sort({ versionNumber: -1 })
    .select("versionNumber")
    .lean();
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  const s3Key = String(generated.imageUrl || "").replace(/^\//, "");
  const assistantNote = `Cover version ${versionNumber} is ready.`;
  const operation = maskBuffer ? "edit_with_mask" : "edit";

  const version = await NovelCoverVersion.create({
    novelId: novel._id,
    userId,
    s3Key,
    versionNumber,
    userPrompt: prompt,
    assistantNote,
    sourceHint: baseVersion.sourceHint || "outline",
    parentVersionId: baseVersion._id,
    operation,
    generatedImageId: generated.id,
    promptEnhanced: generated.promptEnhanced,
    settings: generated.settings,
  });

  novel.coverImage = s3Key;
  await novel.save();

  const coverUrl = coverUrlFromS3Key(s3Key);
  const coverUrlMap = { [String(version._id)]: coverUrl };

  // Persist the edit prompt + result so both appear in the Studio chat thread.
  const userEditMsg = await NovelCoverMessage.create({
    novelId: novel._id,
    userId,
    role: "user",
    text: prompt,
    kind: "chat",
    metadata: {
      kind: "cover_edit_request",
      baseVersionId: String(baseVersion._id),
      operation,
    },
  });

  const editNote = `Cover version ${versionNumber} is ready (edited from version ${baseVersion.versionNumber}).`;
  const renderMsg = await NovelCoverMessage.create({
    novelId: novel._id,
    userId,
    role: "assistant",
    text: editNote,
    kind: "render_notice",
    coverVersionId: version._id,
    metadata: coverRenderNoticeMetadata(version._id),
  });

  const quota = await getCoverRenderUsage(userId, { role: userRole });

  return {
    coverUrl,
    version: serializeVersion(version, s3Key),
    generatedImage: generated,
    userMessage: serializeMessage(userEditMsg),
    message: serializeMessage(renderMsg, coverUrlMap),
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      unlimited: quota.unlimited,
      resetsAt: quota.resetsAt,
    },
  };
}
