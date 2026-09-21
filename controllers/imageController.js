import { StatusCodes } from "http-status-codes";
import { resolveImageSettings } from "../config/openaiImageConfig.js";
import {
  runGenerate,
  runEdit,
  getGeneratedImageById,
  getGeneratedImageHistory,
} from "../service/imageGenerationService.js";
import {
  validateUploadedImage,
  validateMaskUpload,
  validateBackgroundSetting,
  validateImageBuffer,
} from "../service/imageValidationService.js";
import { formatOpenAIImageErrorResponse } from "../utils/openaiImageErrors.js";

const writeImageSse = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const parseBoolean = (value) =>
  value === true || value === "true" || value === "1";

const buildSettingsOverrides = (body = {}) => ({
  n: body.n,
  size: body.size,
  quality: body.quality,
  outputFormat: body.outputFormat,
  outputCompression: body.outputCompression,
  background: body.background,
  moderation: body.moderation,
  stream: parseBoolean(body.stream),
});

export const generateImageHandler = async (req, res) => {
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  try {
    if (req.body?.background) validateBackgroundSetting(req.body.background);

    const globalSettings = await resolveImageSettings(buildSettingsOverrides(req.body));
    const useStream = wantsStream && globalSettings.partialImages > 0;

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const result = await runGenerate({
      userId: req.user._id,
      userEmail: req.user.email,
      prompt: req.body?.prompt,
      settingsOverrides: {
        ...buildSettingsOverrides(req.body),
        stream: useStream,
      },
      enhancePrompt: parseBoolean(req.body?.enhancePrompt),
      onPartialImage: useStream
        ? (b64, index) => writeImageSse(res, { partial: true, index, b64 })
        : null,
    });

    if (useStream) {
      writeImageSse(res, { done: true, ...result });
      return res.end();
    }

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    if (wantsStream && res.headersSent) {
      writeImageSse(res, body);
      return res.end();
    }
    return res.status(statusCode).json(body);
  }
};

const collectReferenceBuffers = (files = []) =>
  files.map((f) => f.buffer).filter(Boolean);

export const editImageHandler = async (req, res) => {
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  try {
    if (req.body?.background) validateBackgroundSetting(req.body.background);

    let sourceBuffer = null;
    let sourceImageKeyOverride = null;

    if (req.files?.image?.[0]) {
      const validated = await validateUploadedImage(req.files.image[0]);
      sourceBuffer = validated.buffer;
    }

    const globalSettings = await resolveImageSettings(buildSettingsOverrides(req.body));
    const useStream = wantsStream && globalSettings.partialImages > 0;

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const result = await runEdit({
      userId: req.user._id,
      userEmail: req.user.email,
      prompt: req.body?.prompt,
      sourceBuffer,
      sourceImageId: req.body?.sourceImageId || null,
      referenceBuffers: collectReferenceBuffers(req.files?.referenceImages),
      settingsOverrides: {
        ...buildSettingsOverrides(req.body),
        stream: useStream,
      },
      enhancePrompt: parseBoolean(req.body?.enhancePrompt),
      onPartialImage: useStream
        ? (b64, index) => writeImageSse(res, { partial: true, index, b64 })
        : null,
      endpoint: "imagesEdit",
    });

    if (useStream) {
      writeImageSse(res, { done: true, ...result });
      return res.end();
    }

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    if (wantsStream && res.headersSent) {
      writeImageSse(res, body);
      return res.end();
    }
    return res.status(statusCode).json(body);
  }
};

export const editImageWithMaskHandler = async (req, res) => {
  const wantsStream = req.headers.accept?.includes("text/event-stream");

  try {
    if (req.body?.background) validateBackgroundSetting(req.body.background);

    let sourceBuffer = null;
    if (req.files?.image?.[0]) {
      const validated = await validateUploadedImage(req.files.image[0]);
      sourceBuffer = validated.buffer;
    } else if (req.body?.sourceImageId) {
      // runEdit will load from storage
    } else {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "image_required",
        message: "Provide image file or sourceImageId.",
      });
    }

    let maskBuffer = null;
    if (req.files?.mask?.[0]) {
      if (sourceBuffer) {
        const imageValidated = await validateImageBuffer(sourceBuffer);
        await validateMaskUpload(req.files.mask[0], imageValidated.meta);
      }
      maskBuffer = req.files.mask[0].buffer;
    } else {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: "mask_required",
        message: "Mask file is required.",
      });
    }

    const globalSettings = await resolveImageSettings(buildSettingsOverrides(req.body));
    const useStream = wantsStream && globalSettings.partialImages > 0;

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    const result = await runEdit({
      userId: req.user._id,
      userEmail: req.user.email,
      prompt: req.body?.prompt,
      sourceBuffer,
      sourceImageId: req.body?.sourceImageId || null,
      maskBuffer,
      settingsOverrides: {
        ...buildSettingsOverrides(req.body),
        stream: useStream,
      },
      enhancePrompt: parseBoolean(req.body?.enhancePrompt),
      onPartialImage: useStream
        ? (b64, index) => writeImageSse(res, { partial: true, index, b64 })
        : null,
      endpoint: "imagesEditWithMask",
    });

    if (useStream) {
      writeImageSse(res, { done: true, ...result });
      return res.end();
    }

    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    if (wantsStream && res.headersSent) {
      writeImageSse(res, body);
      return res.end();
    }
    return res.status(statusCode).json(body);
  }
};

export const getImageHandler = async (req, res) => {
  try {
    const record = await getGeneratedImageById(req.params.id, req.user._id);
    if (!record) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "not_found",
        message: "Image not found.",
      });
    }
    return res.status(StatusCodes.OK).json(record);
  } catch (error) {
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    return res.status(statusCode).json(body);
  }
};

export const getImageHistoryHandler = async (req, res) => {
  try {
    const history = await getGeneratedImageHistory(
      req.params.rootId,
      req.user._id
    );
    if (!history) {
      return res.status(StatusCodes.NOT_FOUND).json({
        error: "not_found",
        message: "Image history not found.",
      });
    }
    return res.status(StatusCodes.OK).json(history);
  } catch (error) {
    const { statusCode, body } = formatOpenAIImageErrorResponse(error);
    return res.status(statusCode).json(body);
  }
};
