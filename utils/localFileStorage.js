import fs from "fs/promises";
import path from "path";

let loggedEnabled = false;

export const isLocalFileStorage = () =>
  process.env.LOCAL_FILE_STORAGE === "true";

export const getLocalStorageRoot = () =>
  path.resolve(
    process.cwd(),
    process.env.LOCAL_FILE_STORAGE_DIR || "local-userData"
  );

const logEnabledOnce = () => {
  if (loggedEnabled || !isLocalFileStorage()) return;
  loggedEnabled = true;
  console.log(
    `[localFileStorage] enabled, root=${getLocalStorageRoot()}`
  );
};

export const assertSafeKey = (s3Key) => {
  const key = String(s3Key || "").trim();
  if (!key) {
    throw new Error("Local file storage key is required");
  }
  if (key.startsWith("/") || key.includes("\\")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  const segments = key.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
};

export const resolveLocalPath = (s3Key) => {
  const key = assertSafeKey(s3Key);
  const root = getLocalStorageRoot();
  const fullPath = path.resolve(root, key);
  if (!fullPath.startsWith(`${root}${path.sep}`) && fullPath !== root) {
    throw new Error(`Unsafe storage key resolves outside root: ${key}`);
  }
  return fullPath;
};

const contentTypeFromKey = (s3Key, fallback = "application/octet-stream") => {
  const ext = path.extname(s3Key).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  };
  return map[ext] || fallback;
};

export const writeLocalFile = async (s3Key, body, contentType) => {
  logEnabledOnce();
  const filePath = resolveLocalPath(s3Key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await fs.writeFile(filePath, buffer);
  return {
    contentType: contentType || contentTypeFromKey(s3Key),
    size: buffer.length,
  };
};

export const readLocalFile = async (s3Key) => {
  logEnabledOnce();
  const filePath = resolveLocalPath(s3Key);
  try {
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      contentType: contentTypeFromKey(s3Key),
      size: buffer.length,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      const notFound = new Error(`File not found: ${s3Key}`);
      notFound.code = "ENOENT";
      throw notFound;
    }
    throw err;
  }
};

export const deleteLocalFile = async (s3Key) => {
  logEnabledOnce();
  const filePath = resolveLocalPath(s3Key);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
};
