const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

const runProcess = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${bin} exited with code ${code}: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const parseFps = (fraction) => {
  if (!fraction || typeof fraction !== "string") return 30;
  const [n, d] = fraction.split("/").map(Number);
  if (!n || !d) return 30;
  return n / d;
};

const getVideoMetadata = async (sourcePath) => {
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=avg_frame_rate,width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    sourcePath
  ];

  const { stdout } = await runProcess(FFPROBE_BIN, args);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] || {};
  const duration = Number(parsed.format?.duration || 0);
  const fps = parseFps(stream.avg_frame_rate);
  const width = Number(stream.width || 1920);
  const height = Number(stream.height || 1080);

  return { duration, fps, width, height };
};

const extractFrame = async ({ sourcePath, atSeconds, outputPath }) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-ss",
    String(atSeconds),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath
  ];
  await runProcess(FFMPEG_BIN, args);
  return outputPath;
};

module.exports = {
  getVideoMetadata,
  extractFrame
};
