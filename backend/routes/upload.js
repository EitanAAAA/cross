const path = require("path");
const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { UPLOADS_DIR } = require("../utils/paths");

const router = express.Router();

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 2048);
const maxUploadBytes = maxUploadMb * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
    req.uploadId = id;
    cb(null, `${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      cb(new Error("Only video files are supported"));
      return;
    }
    cb(null, true);
  }
});

router.post("/", upload.single("video"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No video file uploaded" });
    return;
  }

  res.status(201).json({
    uploadId: req.uploadId,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    fileUrl: `/uploads/${req.file.filename}`
  });
});

module.exports = router;
