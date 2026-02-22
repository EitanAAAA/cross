const fs = require("fs");
const path = require("path");
const { PROJECTS_DIR } = require("../utils/paths");

const getManifestPath = (projectId) => path.join(PROJECTS_DIR, `${projectId}.project.json`);

const writeProjectManifest = ({ projectId, sourcePath, plan, capabilitySummary }) => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const manifestPath = getManifestPath(projectId);
  const payload = {
    projectId,
    sourcePath,
    plan,
    capabilitySummary,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), "utf8");
  return manifestPath;
};

const readProjectManifest = (projectId) => {
  const manifestPath = getManifestPath(projectId);
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
};

module.exports = {
  getManifestPath,
  writeProjectManifest,
  readProjectManifest
};
