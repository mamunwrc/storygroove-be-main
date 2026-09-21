# S3 File Storage

## Summary

Shared AWS S3 integration for user-uploaded and generated files. The Express app proxies `GET /userData/*` to S3 so clients can load profile pictures, chat attachments, book covers, and other assets without direct bucket credentials.

## Scope

**In scope:** S3 client config, upload/delete/get helpers, multer upload presets, public proxy route in `index.js`.

**Out of scope:** Business logic for when files are created (see user-auth, ai-agent-chat, book-cover-generation, manuscript-upload).

## Primary responsibilities

- Upload buffers to S3 with content types and return public URLs.
- Download S3 objects as buffers (e.g. chat attachment ingestion).
- Delete objects when profile pics or assets are removed.
- Stream S3 objects through `/userData/*` with cache headers.
- Provide multer configurations for profile pics and chat file uploads.

## Dependencies

- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
- Env: `AWS_S3_BUCKET_NAME`, AWS credentials (env or IAM role).

## How to navigate the code

- Service: `service/s3Service.js`
- Client config: `config/s3Client.js`
- Multer presets: `config/multer.js`
- Proxy route: `index.js` (`GET /userData/*`)

## Open questions / gaps

- Static `/backgrounds` assets are served locally, not from S3.
