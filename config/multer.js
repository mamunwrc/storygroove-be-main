import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path';
import { s3Client } from './s3Client.js';

const getBucket = (req, file, cb) => cb(null, process.env.AWS_S3_BUCKET_NAME);

const whitelist = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

// ---------------------------------------------------------------------------
// General image upload — userData/{userId}/uploads/
// ---------------------------------------------------------------------------
export const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: getBucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const uniqueSuffix = Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `userData/${req.user._id}/uploads/${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 8 },
  fileFilter: (req, file, cb) => {
    if (!whitelist.includes(file.mimetype)) {
      return cb(new Error('file is not allowed'));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Multer error handler — shared across all upload middleware
// ---------------------------------------------------------------------------
export const handleMulterError = (err, req, res, next) => {
  console.log(err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the limit' });
    }
    return res.status(400).json({ error: 'File upload error' });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// ---------------------------------------------------------------------------
// Profile picture upload — userData/{userId}/profile/
// ---------------------------------------------------------------------------
export const multerUploadProfilePic = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: getBucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const uniqueSuffix = Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `userData/${req.user._id}/profile/image-${uniqueSuffix}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 5 },
  fileFilter: (req, file, cb) => {
    if (!whitelist.includes(file.mimetype)) {
      return cb(new Error('file is not allowed'));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Chat file attachment upload — userData/{userId}/chat/
// ---------------------------------------------------------------------------
const chatFileWhitelist = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
];

export const uploadChatFile = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: getBucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `userData/${req.user._id}/chat/${Date.now()}-${safeName}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 10 },
  fileFilter: (req, file, cb) => {
    if (!chatFileWhitelist.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. Allowed: images, PDF, TXT, DOC, DOCX, RTF, MD'));
    }
    cb(null, true);
  },
});
