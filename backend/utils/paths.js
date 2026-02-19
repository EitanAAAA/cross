const fs = require("fs");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const STORAGE_DIR = path.join(BACKEND_ROOT, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const RENDERS_DIR = path.join(STORAGE_DIR, "renders");
const PROJECTS_DIR = path.join(STORAGE_DIR, "projects");

const ensureStorageDirs = () => {
  [STORAGE_DIR, UPLOADS_DIR, RENDERS_DIR, PROJECTS_DIR].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });
};

const findUploadById = (uploadId) => {
  const files = fs.readdirSync(UPLOADS_DIR);
  const file = files.find((entry) => entry.startsWith(uploadId));
  if (!file) return null;
  return {
    id: uploadId,
    fileName: file,
    path: path.join(UPLOADS_DIR, file)
  };
};

module.exports = {
  BACKEND_ROOT,
  STORAGE_DIR,
  UPLOADS_DIR,
  RENDERS_DIR,
  PROJECTS_DIR,
  ensureStorageDirs,
  findUploadById
};
