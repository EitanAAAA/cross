const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { RENDERS_DIR } = require("../utils/paths");

const MELT_BIN = process.env.MELT_BIN || "melt";
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";

const jobs = new Map();

const parsePercentProgress = (line) => {
  const percentMatch = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!percentMatch) return null;
  const value = Number(percentMatch[1]);
  if (Number.isNaN(value)) return null;
  return Math.min(100, Math.max(0, value));
};

const parsePositionProgress = (line, totalFrames) => {
  if (!totalFrames || totalFrames <= 0) return null;
  const matches = [...line.matchAll(/Current Position:\s*(\d+)/g)];
  if (matches.length === 0) return null;
  const currentFrame = Number(matches[matches.length - 1][1]);
  if (!Number.isFinite(currentFrame)) return null;
  return Math.min(100, Math.max(0, (currentFrame / totalFrames) * 100));
};

const parseProjectTotalFrames = (projectPath) => {
  try {
    const xml = fs.readFileSync(projectPath, "utf8");
    const entryOutMatches = [...xml.matchAll(/<entry\b[^>]*\bout="(\d+)"/g)].map((m) => Number(m[1]));
    const producerOutMatches = [...xml.matchAll(/<producer\b[^>]*\bout="(\d+)"/g)].map((m) => Number(m[1]));
    const allMatches = [...entryOutMatches, ...producerOutMatches].filter((v) => Number.isFinite(v));
    if (allMatches.length === 0) return null;
    return Math.max(...allMatches);
  } catch (_) {
    return null;
  }
};

const probeDurationSeconds = (mediaPath) =>
  new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath
    ];
    const child = spawn(FFPROBE_BIN, args, { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const duration = Number((stdout || "").trim());
      resolve(Number.isFinite(duration) ? duration : null);
    });
  });

const startRenderJob = ({ projectId, projectPath }) => {
  const jobId = uuidv4();
  const outputFileName = `${projectId}-${Date.now()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputFileName);
  const outputResource = outputPath.replace(/\\/g, "/");
  const totalFrames = parseProjectTotalFrames(projectPath);

  fs.mkdirSync(RENDERS_DIR, { recursive: true });

  const job = {
    jobId,
    projectId,
    projectPath,
    outputFileName,
    outputPath,
    status: "queued",
    progress: 0,
    totalFrames,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null
  };
  jobs.set(jobId, job);

  const args = [
    projectPath,
    "-consumer",
    `avformat:${outputResource}`,
    "vcodec=libx264",
    "acodec=aac",
    "movflags=+faststart",
    "threads=0"
  ];

  const child = spawn(MELT_BIN, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  job.status = "running";
  job.updatedAt = new Date().toISOString();

  const onData = (buffer) => {
    const line = buffer.toString();
    const progress = parsePercentProgress(line) ?? parsePositionProgress(line, totalFrames);
    if (progress !== null) {
      const next = Math.max(job.progress, progress);
      if (next > job.progress) {
        job.progress = next;
        job.updatedAt = new Date().toISOString();
      }
    }
    logger.debug({ jobId, line }, "render log");
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  child.on("error", (err) => {
    job.status = "failed";
    job.error = err.message;
    job.updatedAt = new Date().toISOString();
    logger.error({ err, jobId }, "render process error");
  });

  child.on("close", async (code) => {
    if (code === 0) {
      const fileStat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
      const durationSeconds = await probeDurationSeconds(outputPath);
      if (!fileStat || fileStat.size < 2048 || !durationSeconds || durationSeconds < 0.2) {
        job.status = "failed";
        job.error = "Rendered file is invalid (too short or empty)";
        job.updatedAt = new Date().toISOString();
        logger.error({ jobId, outputPath, durationSeconds }, "render output invalid");
        return;
      }
      job.status = "completed";
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
      logger.info({ jobId, outputPath, durationSeconds }, "render completed");
      return;
    }
    job.status = "failed";
    job.error = `melt exited with code ${code}`;
    job.updatedAt = new Date().toISOString();
    logger.error({ jobId, code }, "render failed");
  });

  return job;
};

const getRenderJob = (jobId) => jobs.get(jobId) || null;

module.exports = {
  startRenderJob,
  getRenderJob
};
