import express from "express";
import multer from "multer";
import authenticateUser from "../config/tokenverify.js";
import { isSubscribedUser } from "../config/tokenverify.js";
import { checkRateLimit } from "../middleware/checkRateLimit.js";
import { getStaticImageConfig } from "../config/openaiImageConfig.js";
import { ALLOWED_IMAGE_MIMES } from "../service/imageValidationService.js";
import { handleMulterError } from "../config/multer.js";
import {
  generateImageHandler,
  editImageHandler,
  editImageWithMaskHandler,
  getImageHandler,
  getImageHistoryHandler,
} from "../controllers/imageController.js";

const imageRoute = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getStaticImageConfig().maxUploadBytes,
    files: 18,
  },
  fileFilter(_req, file, cb) {
    if (file.fieldname === "mask") {
      if (file.mimetype !== "image/png") {
        return cb(new Error("Mask must be a PNG file."));
      }
      return cb(null, true);
    }
    if (!ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      return cb(new Error("Unsupported image format."));
    }
    cb(null, true);
  },
});

const authChain = [authenticateUser, isSubscribedUser, checkRateLimit];

imageRoute.post("/generate", ...authChain, generateImageHandler);

imageRoute.post(
  "/edit",
  ...authChain,
  imageUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "referenceImages", maxCount: 16 },
  ]),
  handleMulterError,
  editImageHandler
);

imageRoute.post(
  "/edit-with-mask",
  ...authChain,
  imageUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "mask", maxCount: 1 },
    { name: "referenceImages", maxCount: 16 },
  ]),
  handleMulterError,
  editImageWithMaskHandler
);

imageRoute.get("/history/:rootId", ...authChain, getImageHistoryHandler);
imageRoute.get("/:id", ...authChain, getImageHandler);

export default imageRoute;
