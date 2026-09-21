import { S3Client } from '@aws-sdk/client-s3';

// Lazy singleton — created on first use, after dotenv has loaded.
// The SDK uses the EC2 instance IAM role automatically via the credential
// provider chain (environment vars → ~/.aws/credentials → IMDS).
let _s3Client;

export const s3Client = new Proxy({}, {
  get(_, prop) {
    if (!_s3Client) {
      if (!process.env.AWS_REGION || !process.env.AWS_S3_BUCKET_NAME) {
        throw new Error(
          `Missing required AWS environment variables: ${['AWS_REGION', 'AWS_S3_BUCKET_NAME'].filter((v) => !process.env[v]).join(', ')}`
        );
      }
      _s3Client = new S3Client({ region: process.env.AWS_REGION });
    }
    return typeof _s3Client[prop] === 'function'
      ? _s3Client[prop].bind(_s3Client)
      : _s3Client[prop];
  },
});
