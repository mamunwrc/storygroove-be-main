import { StatusCodes } from "http-status-codes";
import Novel from "../models/novelModel.js";
import ApiUsageSettings from "../models/apiUsageSettingsModel.js";
import {
  getCoverSessionData,
  runCoverChat,
  runCoverRender,
  runCoverEdit,
  listCoverVersions,
  listCoverMessages,
  coverUrlFromS3Key,
  CoverRenderQuotaError,
  clampCoverPartialImages,
} from "../service/coverGenerationService.js";
import { formatOpenAIImageErrorResponse } from "../utils/openaiImageErrors.js";

const loadUserNovel = async (novelId, userId) => {
  const novel = await Novel.findOne({ _id: novelId, user: userId });
  if (!novel) return null;
  return novel;
};

const writeCoverRenderSse = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const handleCoverRenderError = (error, res, { streaming = false } = {}) => {
  if (error instanceof CoverRenderQuotaError) {
    const body = {
      error: "Cover render quota exceeded",
      message: `You've used all ${error.limit} cover renders for this billing period. You can still chat and reuse versions from your gallery. Resets ${error.resetsAt?.toISOString?.() || "next billing cycle"}.`,
      used: error.used,
      limit: error.limit,
      resetsAt: error.resetsAt,
    };
    if (streaming) {
      writeCoverRenderSse(res, body);
      res.end();
      return;
    }
    return res.status(StatusCodes.TOO_MANY_REQUESTS).json(body);
  }
  if (error.code === "EDITORIAL_LETTER_REQUIRED") {
    const body = {
      error: "Editorial letter required",
      message: error.message,
    };
    if (streaming) {
      writeCoverRenderSse(res, body);
      res.end();
      return;
    }
    return res.status(StatusCodes.BAD_REQUEST).json(body);
  }
  if (error.statusCode === 409) {
    const body = {
      error: "Cover generation already used",
      message: error.message,
    };
    if (streaming) {
      writeCoverRenderSse(res, body);
      res.end();
      return;
    }
    return res.status(StatusCodes.CONFLICT).json(body);
  }
  console.error("renderBookCover error:", error);
  const body = {
    error: "Failed to generate book cover",
    message: error.message,
  };
  if (streaming) {
    writeCoverRenderSse(res, body);
    res.end();
    return;
  }
  return res
    .status(StatusCodes.INTERNAL_SERVER_ERROR)
    .json(body);
};

export const getCoverSession = async (req, res) => {
  try {
    const { novelId } = req.params;
    const user = req.user;

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const session = await getCoverSessionData({
      novel,
      userId: user._id,
      userRole: user.role,
    });
    return res.status(StatusCodes.OK).json(session);
  } catch (error) {
    console.error("getCoverSession error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to load cover session", message: error.message });
  }
};

export const coverChat = async (req, res) => {
  try {
    const { novelId } = req.params;
    const user = req.user;
    const message = req.body?.message;

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const result = await runCoverChat({
      novel,
      userId: user._id,
      userEmail: user.email,
      userRole: user.role,
      message,
      attachments: req.body?.attachments,
    });

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    console.error("coverChat error:", error);
    const status = error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
    return res.status(status).json({
      error: error.message || "Cover chat failed",
      message: error.message,
    });
  }
};

export const renderBookCover = async (req, res) => {
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  try {
    const { novelId } = req.params;
    const user = req.user;
    const message = req.body?.message;
    const sourceMessageId = req.body?.sourceMessageId;

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const globalSettings = await ApiUsageSettings.getSettings();
    const partialImages = clampCoverPartialImages(
      globalSettings?.coverImagePartialImages ?? 0
    );
    const useStream = wantsStream && partialImages > 0;

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const result = await runCoverRender({
      novel,
      userId: user._id,
      userEmail: user.email,
      userRole: user.role,
      message,
      sourceMessageId,
      sseWrite: useStream
        ? (payload) => writeCoverRenderSse(res, payload)
        : null,
    });

    if (useStream) {
      writeCoverRenderSse(res, { done: true, ...result });
      return res.end();
    }

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    if (wantsStream && !res.headersSent) {
      return handleCoverRenderError(error, res, { streaming: false });
    }
    if (wantsStream && res.headersSent) {
      return handleCoverRenderError(error, res, { streaming: true });
    }
    return handleCoverRenderError(error, res, { streaming: false });
  }
};

/** Legacy alias for POST /:novelId/generate-cover */
export const generateBookCover = renderBookCover;

export const listCoverMessagesHandler = async (req, res) => {
  try {
    const { novelId } = req.params;
    const user = req.user;
    const before = req.query.before;
    const limit = req.query.limit;

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const result = await listCoverMessages({ novel, before, limit });
    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    console.error("listCoverMessages error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to list cover messages", message: error.message });
  }
};

export const listCoverVersionsHandler = async (req, res) => {
  try {
    const { novelId } = req.params;
    const user = req.user;
    const page = req.query.page;
    const limit = req.query.limit;

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const result = await listCoverVersions({ novel, page, limit });
    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    console.error("listCoverVersions error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to list cover versions", message: error.message });
  }
};

export const getBookCover = async (req, res) => {
  try {
    const { novelId } = req.params;
    const user = req.user;

    const novel = await Novel.findOne({ _id: novelId, user: user._id })
      .select("coverImage")
      .lean();
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const coverUrl = coverUrlFromS3Key(novel.coverImage);
    return res.status(StatusCodes.OK).json({ coverUrl });
  } catch (error) {
    console.error("getBookCover error:", error);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to retrieve cover", message: error.message });
  }
};

const parseBoolean = (value) =>
  value === true || value === "true" || value === "1";

export const editBookCover = async (req, res) => {
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  try {
    const { novelId } = req.params;
    const user = req.user;
    const { prompt, baseVersionId, enhancePrompt } = req.body || {};
    const maskFile = req.file;

    if (!prompt?.trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "prompt_required",
        message: "Edit prompt is required.",
      });
    }
    if (!baseVersionId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "base_version_required",
        message: "baseVersionId is required.",
      });
    }

    const novel = await loadUserNovel(novelId, user._id);
    if (!novel) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ error: "Novel not found" });
    }

    const globalSettings = await ApiUsageSettings.getSettings();
    const partialImages = clampCoverPartialImages(
      globalSettings?.coverImagePartialImages ?? 0
    );
    const useStream = wantsStream && partialImages > 0;

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const result = await runCoverEdit({
      novel,
      userId: user._id,
      userEmail: user.email,
      userRole: user.role,
      baseVersionId,
      prompt: prompt.trim(),
      maskBuffer: maskFile?.buffer || null,
      enhancePrompt: parseBoolean(enhancePrompt),
      sseWrite: useStream
        ? (payload) => writeCoverRenderSse(res, payload)
        : null,
    });

    if (useStream) {
      writeCoverRenderSse(res, { done: true, ...result });
      return res.end();
    }

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    if (error.statusCode === 404) {
      const body = { error: "not_found", message: error.message };
      if (wantsStream && res.headersSent) {
        writeCoverRenderSse(res, body);
        return res.end();
      }
      return res.status(StatusCodes.NOT_FOUND).json(body);
    }
    if (error instanceof CoverRenderQuotaError) {
      return handleCoverRenderError(error, res, {
        streaming: wantsStream && res.headersSent,
      });
    }
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    if (wantsStream && res.headersSent) {
      writeCoverRenderSse(res, body);
      return res.end();
    }
    console.error("editBookCover error:", error);
    return res.status(statusCode).json(body);
  }
};
