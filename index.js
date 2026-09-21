import 'dotenv/config';
import express from "express";
import connectDb from "./config/db.js";
import cors from "cors";
import * as StripeController from './controllers/stripeController.js';
import { assertEmailConfig, verifyEmailTransport } from './utils/mailGun.js';
const app = express();

const runEmailStartupCheck = async () => {
  try {
    assertEmailConfig();
    await verifyEmailTransport();
    console.log('[email] SMTP transport verified');
  } catch (err) {
    console.error('[email] Startup check failed:', err.message);
  }
};
void runEmailStartupCheck();

/** Origins must match the browser Origin header (no trailing slash). */
const normalizeCorsOrigin = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch (_err) {
    return trimmed.replace(/\/+$/, '');
  }
};

const allowedCorsOrigins = [
  process.env.CLIENT_URL,
  ...(process.env.PUBLIC_CHECKOUT_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeCorsOrigin(origin))
    .filter(Boolean),
]
  .map((origin) => normalizeCorsOrigin(origin))
  .filter(Boolean);

const publicCheckoutOriginSuffixes = [
  ...(process.env.PUBLIC_CHECKOUT_ORIGIN_SUFFIXES || '')
    .split(',')
    .map((suffix) => suffix.trim())
    .filter(Boolean),
  '.lovableproject.com',
  '.lovable.app',
].filter((suffix, index, arr) => arr.indexOf(suffix) === index);

const isCorsOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalized = normalizeCorsOrigin(origin);
  if (allowedCorsOrigins.includes(normalized)) return true;
  return publicCheckoutOriginSuffixes.some((suffix) => normalized.endsWith(suffix));
};

app.post('/webhook', express.raw({type: 'application/json'}), StripeController.stripeWebhook);

app.use(cors({
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ["X-RateLimit-Warning", "Content-Disposition"],
}));

app.use((req, res, next) => {
  express.json({
    limit: "10mb",
  })(req, res, next);
});

connectDb();

// Proxy /userData/* requests to S3 — or local disk when LOCAL_FILE_STORAGE=true.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from './config/s3Client.js';
import { isLocalFileStorage, readLocalFile } from './utils/localFileStorage.js';

app.get('/userData/*', async (req, res) => {
  const s3Key = decodeURIComponent(req.path.slice(1)); // strip leading /
  try {
    if (isLocalFileStorage()) {
      const { buffer, contentType, size } = await readLocalFile(s3Key);
      res.set('Content-Type', contentType || 'application/octet-stream');
      res.set('Content-Length', String(size));
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(buffer);
    }

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: s3Key,
    });
    const s3Response = await s3Client.send(command);

    res.set('Content-Type', s3Response.ContentType || 'application/octet-stream');
    if (s3Response.ContentLength) res.set('Content-Length', String(s3Response.ContentLength));
    res.set('Cache-Control', 'public, max-age=86400, immutable');

    s3Response.Body.pipe(res);
  } catch (err) {
    if (
      err.code === 'ENOENT' ||
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error(`[S3 proxy] Failed to serve ${s3Key}:`, err.message);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

app.use(
  "/backgrounds",
  express.static("backgrounds", {
    extensions: ["png", "jpeg", "jpg", "webp"],
  })
);

app.get("/", (req, res) => {
  res.send(" API is running ....");
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res
      .status(400)
      .json({ message: "request data is malformed, Please send proper data" }); // Bad request
  }
  next();
});

const Port = process.env.PORT || 8086;

import stripeRouter from "./routers/stripeRoute.js";
import subscriptionRoute from "./routers/subscriptionRoute.js";
import userRouter from "./routers/userRoute.js";
import novelRoute from "./routers/novelRoute.js";
import assistantRoute from "./routers/assistantRoute.js";
import chatRoute from "./routers/chatRoute.js";
import apiUsageRoute from "./routers/apiUsageRoute.js";
import activityLogRoute from "./routers/activityLogRoute.js";
import imageRoute from "./routers/imageRoute.js";
import ideaRoute from "./routers/ideaRoute.js";

app.use("/api/stripe", stripeRouter);
app.use("/api/subscription", subscriptionRoute);
app.use("/api/user", userRouter);
app.use("/api/novel", novelRoute);
app.use("/api/idea", ideaRoute);
app.use("/api/assistant", assistantRoute);
app.use("/api/v1", chatRoute);
app.use("/api/images", imageRoute);
app.use("/api/admin/usage", apiUsageRoute);
app.use("/api/admin/activity-logs", activityLogRoute);

app.listen(Port, console.log("Listening to port ", Port));
