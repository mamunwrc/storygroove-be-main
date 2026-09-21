import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../config/s3Client.js';
import {
  isLocalFileStorage,
  writeLocalFile,
  readLocalFile,
  deleteLocalFile,
} from '../utils/localFileStorage.js';

const getBucket = () => process.env.AWS_S3_BUCKET_NAME;

/**
 * Download a file from S3 and return its content as a Buffer.
 * Used by responsesApiService.buildMessageContent to read chat attachments.
 */
export const getFileFromS3 = async (s3Key) => {
  if (isLocalFileStorage()) {
    const { buffer } = await readLocalFile(s3Key);
    return buffer;
  }

  const command = new GetObjectCommand({ Bucket: getBucket(), Key: s3Key });
  const response = await s3Client.send(command);

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/**
 * Delete a file from S3.
 * Logs the error then re-throws so callers can decide how to handle it
 * (e.g. removeProfilePic wraps in try/catch and continues; other callers may return 500).
 */
export const deleteFromS3 = async (s3Key) => {
  if (isLocalFileStorage()) {
    try {
      await deleteLocalFile(s3Key);
    } catch (err) {
      console.error(`[s3Service] deleteFromS3 failed for key "${s3Key}":`, err.message);
      throw err;
    }
    return;
  }

  try {
    const command = new DeleteObjectCommand({ Bucket: getBucket(), Key: s3Key });
    await s3Client.send(command);
  } catch (err) {
    console.error(`[s3Service] deleteFromS3 failed for key "${s3Key}":`, err.message);
    throw err;
  }
};

/**
 * Upload a buffer or stream to S3 and return the public URL.
 */
export const uploadToS3 = async (s3Key, body, contentType) => {
  if (isLocalFileStorage()) {
    await writeLocalFile(s3Key, body, contentType);
    return `/${s3Key}`;
  }

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: s3Key,
    Body: body,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return getS3Url(s3Key);
};

/**
 * Build the public HTTPS URL for a given S3 key.
 * Assumes the bucket or object has public-read access.
 */
export const getS3Url = (s3Key) =>
  `https://${getBucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

/**
 * Generate a pre-signed URL for temporary access to a private S3 object.
 * Default expiry is 1 hour.
 */
export const getSignedS3Url = async (s3Key, expiresInSeconds = 3600) => {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: s3Key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};
