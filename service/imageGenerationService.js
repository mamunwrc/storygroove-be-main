import GeneratedImage from "../models/generatedImageModel.js";
import { resolveImageSettings } from "../config/openaiImageConfig.js";
import {
  createImageClient,
  generateImages,
  editImages,
} from "./openaiImageService.js";
import {
  enhanceImagePrompt,
  buildMaskedEditPrompt,
} from "./imagePromptEnhancementService.js";
import {
  validatePrompt,
  validateImageBuffer,
  validateMaskMatchesImage,
} from "./imageValidationService.js";
import { prepareMaskForOpenAI, compositeMaskedEdit } from "./imageMaskService.js";
import { uploadToS3, getFileFromS3 } from "./s3Service.js";
import { logApiUsageRaw } from "../utils/logApiUsage.js";
import { OpenAIImageError } from "../utils/openaiImageErrors.js";
import { StatusCodes } from "http-status-codes";

export const imageUrlFromKey = (s3Key) => {
  if (!s3Key) return null;
  const key = String(s3Key).startsWith("/") ? s3Key.slice(1) : s3Key;
  return `/${key}`;
};

const contentTypeForFormat = (format) => {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
};

const extForFormat = (format) => {
  if (format === "jpeg") return "jpg";
  if (format === "webp") return "webp";
  return "png";
};

export const serializeGeneratedImage = (record) => ({
  id: String(record._id),
  rootId: String(record.rootId),
  parentId: record.parentId ? String(record.parentId) : null,
  versionNumber: record.versionNumber,
  operation: record.operation,
  promptOriginal: record.promptOriginal,
  promptEnhanced: record.promptEnhanced || null,
  promptSent: record.promptSent,
  model: record.model,
  settings: record.settings || {},
  sourceImageUrl: record.sourceImageKey
    ? imageUrlFromKey(record.sourceImageKey)
    : null,
  maskImageUrl: record.maskKey ? imageUrlFromKey(record.maskKey) : null,
  imageUrl: imageUrlFromKey(record.outputImageKey),
  imageUrls: (record.outputImageKeys?.length
    ? record.outputImageKeys
    : [record.outputImageKey]
  ).map(imageUrlFromKey),
  novelId: record.novelId ? String(record.novelId) : null,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const saveOutputImages = async ({
  userId,
  recordId,
  data,
  outputFormat,
  outputKeyBuilder,
  novelId,
}) => {
  const ext = extForFormat(outputFormat);
  const contentType = contentTypeForFormat(outputFormat);
  const keys = [];

  for (let i = 0; i < data.length; i += 1) {
    const b64 = data[i]?.b64_json;
    if (!b64) continue;
    const buffer = Buffer.from(b64, "base64");
    const suffix = data.length > 1 ? `-${i}` : "";
    const key = outputKeyBuilder
      ? outputKeyBuilder({ userId, recordId, ext, suffix, novelId })
      : `userData/${userId}/images/${recordId}${suffix}.${ext}`;
    await uploadToS3(key, buffer, contentType);
    keys.push(key);
  }

  if (!keys.length) {
    throw new OpenAIImageError("OpenAI returned no image data.", {
      code: "empty_response",
      statusCode: StatusCodes.BAD_GATEWAY,
    });
  }

  return keys;
};

const resolveParentChain = async ({ userId, parentRecord, parentId }) => {
  if (parentRecord) {
    return {
      parent: parentRecord,
      rootId: parentRecord.rootId || parentRecord._id,
      versionNumber: (parentRecord.versionNumber || 1) + 1,
    };
  }
  if (parentId) {
    const parent = await GeneratedImage.findOne({ _id: parentId, userId });
    if (!parent) {
      throw new OpenAIImageError("Source image not found.", {
        code: "not_found",
        statusCode: StatusCodes.NOT_FOUND,
      });
    }
    return {
      parent,
      rootId: parent.rootId || parent._id,
      versionNumber: (parent.versionNumber || 1) + 1,
    };
  }
  return { parent: null, rootId: null, versionNumber: 1 };
};

export async function runGenerate({
  userId,
  userEmail,
  prompt,
  settingsOverrides = {},
  enhancePrompt = false,
  novelId = null,
  onPartialImage = null,
  endpoint = "imagesGenerate",
  outputKeyBuilder = null,
}) {
  const settings = await resolveImageSettings(settingsOverrides);
  const promptOriginal = validatePrompt(prompt, settings.maxPromptChars);
  const openai = await createImageClient({ timeoutMs: settings.timeoutMs });

  const { original, enhanced, promptSent } = await enhanceImagePrompt(
    openai,
    promptOriginal,
    {
      enabled: enhancePrompt && settings.enhancementEnabled,
      model: settings.enhancementModel,
    }
  );

  const placeholder = await GeneratedImage.create({
    userId,
    rootId: new GeneratedImage()._id,
    parentId: null,
    versionNumber: 1,
    operation: "generate",
    promptOriginal: original,
    promptEnhanced: enhanced,
    promptSent,
    model: settings.model,
    settings: {
      n: settings.n,
      size: settings.size,
      quality: settings.quality,
      outputFormat: settings.outputFormat,
      background: settings.background,
      moderation: settings.moderation,
      partialImages: settings.partialImages,
      stream: settings.stream,
    },
    outputImageKey: "pending",
    novelId,
    status: "completed",
  });
  placeholder.rootId = placeholder._id;
  await placeholder.save();

  const result = await generateImages(openai, {
    prompt: promptSent,
    settings,
    onPartialImage,
  });

  const outputKeys = await saveOutputImages({
    userId,
    recordId: placeholder._id,
    data: result.data,
    outputFormat: settings.outputFormat,
    outputKeyBuilder,
    novelId,
  });

  placeholder.outputImageKey = outputKeys[0];
  placeholder.outputImageKeys = outputKeys;
  placeholder.openaiUsage = result.usageBucket;
  await placeholder.save();

  logApiUsageRaw({
    userId,
    userEmail,
    endpoint,
    model: settings.model,
    imageCount: result.imageCount,
    ...result.usageBucket,
  });

  return serializeGeneratedImage(placeholder);
}

export async function runEdit({
  userId,
  userEmail,
  prompt,
  sourceBuffer = null,
  sourceImageId = null,
  maskBuffer = null,
  referenceBuffers = [],
  settingsOverrides = {},
  enhancePrompt = false,
  parentRecord = null,
  parentId = null,
  novelId = null,
  sourceImageKeyOverride = null,
  onPartialImage = null,
  endpoint = "imagesEdit",
  outputKeyBuilder = null,
}) {
  const settings = await resolveImageSettings(settingsOverrides);
  const promptOriginal = validatePrompt(prompt, settings.maxPromptChars);
  const openai = await createImageClient({ timeoutMs: settings.timeoutMs });

  let sourceImageKey = sourceImageKeyOverride;
  let imageBuffer = sourceBuffer;

  const chain = await resolveParentChain({ userId, parentRecord, parentId });

  if (!imageBuffer && sourceImageId) {
    const source = await GeneratedImage.findOne({ _id: sourceImageId, userId });
    if (!source) {
      throw new OpenAIImageError("Source image not found.", {
        code: "not_found",
        statusCode: StatusCodes.NOT_FOUND,
      });
    }
    sourceImageKey = source.outputImageKey;
    imageBuffer = await getFileFromS3(source.outputImageKey);
    if (!chain.parent) {
      chain.parent = source;
      chain.rootId = source.rootId || source._id;
      chain.versionNumber = (source.versionNumber || 1) + 1;
    }
  }

  const { buffer: validatedBuffer, meta: imageMeta } = await validateImageBuffer(
    imageBuffer,
    { maxBytes: settings.maxUploadBytes }
  );

  let processedMask = null;
  let maskKey = null;
  const operation = maskBuffer ? "edit_with_mask" : "edit";

  if (maskBuffer) {
    const { meta: maskMeta } = await validateImageBuffer(maskBuffer, {
      maxBytes: settings.maxMaskBytes,
      label: "Mask",
    });
    validateMaskMatchesImage(maskMeta, imageMeta);
    processedMask = await prepareMaskForOpenAI(maskBuffer, imageMeta);
  }

  let original = promptOriginal;
  let enhanced = null;
  let promptSent = promptOriginal;

  if (operation === "edit_with_mask") {
    // Masked edits must stay local: never run full-scene enhancement (it makes
    // the model regenerate globally). Wrap the instruction with preservation guidance.
    promptSent = buildMaskedEditPrompt(promptOriginal);
    enhanced = promptSent;
  } else {
    const enhancedResult = await enhanceImagePrompt(openai, promptOriginal, {
      enabled: enhancePrompt && settings.enhancementEnabled,
      model: settings.enhancementModel,
    });
    original = enhancedResult.original;
    enhanced = enhancedResult.enhanced;
    promptSent = enhancedResult.promptSent;
  }

  const imageBuffers = [validatedBuffer, ...referenceBuffers].slice(
    0,
    settings.maxReferenceImages
  );

  const placeholder = await GeneratedImage.create({
    userId,
    rootId: chain.rootId || new GeneratedImage()._id,
    parentId: chain.parent?._id || null,
    versionNumber: chain.versionNumber,
    operation,
    promptOriginal: original,
    promptEnhanced: enhanced,
    promptSent,
    model: settings.model,
    settings: {
      n: settings.n,
      size: settings.size,
      quality: settings.quality,
      outputFormat: settings.outputFormat,
      background: settings.background,
      moderation: settings.moderation,
      partialImages: settings.partialImages,
      stream: settings.stream,
    },
    sourceImageKey:
      sourceImageKey || chain.parent?.outputImageKey || null,
    maskKey: null,
    outputImageKey: "pending",
    novelId,
    status: "completed",
  });

  if (!chain.rootId) {
    placeholder.rootId = placeholder._id;
  }
  await placeholder.save();

  if (processedMask) {
    maskKey = `userData/${userId}/images/${placeholder._id}-mask.png`;
    await uploadToS3(maskKey, processedMask, "image/png");
    placeholder.maskKey = maskKey;
    await placeholder.save();
  }

  const result = await editImages(openai, {
    prompt: promptSent,
    settings,
    imageBuffers,
    maskBuffer: processedMask,
    onPartialImage,
  });

  // Enforce the mask on our side: keep unmasked pixels identical to the source.
  if (operation === "edit_with_mask" && maskBuffer && Array.isArray(result.data)) {
    result.data = await Promise.all(
      result.data.map(async (item) => {
        if (!item?.b64_json) return item;
        try {
          const editedBuf = Buffer.from(item.b64_json, "base64");
          const merged = await compositeMaskedEdit(
            validatedBuffer,
            editedBuf,
            maskBuffer,
            { outputFormat: settings.outputFormat }
          );
          return { b64_json: merged.toString("base64") };
        } catch (compositeErr) {
          console.error(
            "Masked edit composite failed, using raw model output:",
            compositeErr.message
          );
          return item;
        }
      })
    );
  }

  const outputKeys = await saveOutputImages({
    userId,
    recordId: placeholder._id,
    data: result.data,
    outputFormat: settings.outputFormat,
    outputKeyBuilder,
    novelId,
  });

  placeholder.outputImageKey = outputKeys[0];
  placeholder.outputImageKeys = outputKeys;
  placeholder.openaiUsage = result.usageBucket;
  await placeholder.save();

  logApiUsageRaw({
    userId,
    userEmail,
    endpoint,
    model: settings.model,
    imageCount: result.imageCount,
    ...result.usageBucket,
  });

  return serializeGeneratedImage(placeholder);
}

export async function getGeneratedImageById(id, userId) {
  const record = await GeneratedImage.findOne({ _id: id, userId }).lean();
  if (!record) return null;
  return serializeGeneratedImage(record);
}

export async function getGeneratedImageHistory(rootId, userId) {
  const root = await GeneratedImage.findOne({ _id: rootId, userId }).lean();
  if (!root) return null;

  const versions = await GeneratedImage.find({
    userId,
    $or: [{ _id: rootId }, { rootId }],
  })
    .sort({ versionNumber: 1, createdAt: 1 })
    .lean();

  return {
    rootId: String(rootId),
    versions: versions.map(serializeGeneratedImage),
  };
}

export async function loadGeneratedImageRecord(id, userId) {
  return GeneratedImage.findOne({ _id: id, userId });
}
