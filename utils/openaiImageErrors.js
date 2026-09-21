import { StatusCodes } from "http-status-codes";

export class OpenAIImageError extends Error {
  constructor(message, { code = "image_error", statusCode = 500, details = null } = {}) {
    super(message);
    this.name = "OpenAIImageError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const mapOpenAIImageError = (err) => {
  if (err instanceof OpenAIImageError) return err;

  const code = err?.code || err?.error?.code;
  const type = err?.type || err?.error?.type;
  const message =
    err?.message ||
    err?.error?.message ||
    "Image generation failed";

  if (code === "moderation_blocked" || type === "image_generation_user_error") {
    return new OpenAIImageError(message, {
      code: code === "moderation_blocked" ? "moderation_blocked" : "image_user_error",
      statusCode: StatusCodes.BAD_REQUEST,
      details: err?.error?.moderation_details || err?.moderation_details || null,
    });
  }

  if (err?.status === 429 || code === "rate_limit_exceeded") {
    return new OpenAIImageError("Rate limit exceeded. Please try again shortly.", {
      code: "rate_limited",
      statusCode: StatusCodes.TOO_MANY_REQUESTS,
    });
  }

  if (err?.status >= 500 || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT") {
    return new OpenAIImageError("Image service temporarily unavailable.", {
      code: "upstream_failure",
      statusCode: StatusCodes.BAD_GATEWAY,
    });
  }

  if (err?.status === 400) {
    return new OpenAIImageError(message, {
      code: "invalid_request",
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  return new OpenAIImageError(message, {
    code: "image_error",
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
  });
};

export const formatOpenAIImageErrorResponse = (err) => {
  const mapped = mapOpenAIImageError(err);
  const body = {
    error: mapped.code,
    message: mapped.message,
  };
  if (mapped.details) body.moderationDetails = mapped.details;
  return { statusCode: mapped.statusCode, body };
};
