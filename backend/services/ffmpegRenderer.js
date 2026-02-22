const path = require("path");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
};

const findFirstOperation = (operations, opName) => {
  return operations.find((operation) => operation.op === opName) || null;
};

const findOperations = (operations, opName) => {
  return operations.filter((operation) => operation.op === opName);
};

const escapeDrawText = (value) => {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
};

const buildTrimArgs = (operations) => {
  const trim = findFirstOperation(operations, "trim");
  if (!trim) return { args: [], trimDurationSeconds: null };

  const start = clamp(toNumber(trim.start, 0), 0, Number.MAX_SAFE_INTEGER);
  const end = clamp(toNumber(trim.end, start + 0.1), start + 0.01, Number.MAX_SAFE_INTEGER);
  return {
    args: ["-ss", String(start), "-to", String(end)],
    trimDurationSeconds: end - start
  };
};

const buildVideoFilterChain = (operations, warnings) => {
  const filters = [];

  if (findFirstOperation(operations, "denoise_video")) {
    filters.push("hqdn3d=1.5:1.5:6:6");
  }

  const blurOps = findOperations(operations, "blur");
  if (blurOps.length > 0) {
    const strongestBlur = blurOps.reduce((best, op) => Math.max(best, toNumber(op.intensity, 0.35)), 0.35);
    const sigma = clamp(0.6 + strongestBlur * 5, 0.6, 8);
    filters.push(`gblur=sigma=${sigma.toFixed(2)}`);
  }

  const brightnessOps = findOperations(operations, "brightness");
  if (brightnessOps.length > 0) {
    const targetBrightness = brightnessOps.reduce(
      (best, op) => Math.max(best, toNumber(op.intensity, toNumber(op.strength, 0.08))),
      0.08
    );
    const brightness = clamp(targetBrightness, -0.35, 0.35);
    filters.push(`eq=brightness=${brightness.toFixed(3)}:saturation=1.05`);
  }

  if (findFirstOperation(operations, "color_grade")) {
    filters.push("eq=contrast=1.08:saturation=1.14:gamma=1.02");
  }

  const rotateOp = findFirstOperation(operations, "rotate");
  if (rotateOp) {
    const degrees = clamp(toNumber(rotateOp.degrees, 2), -12, 12);
    const radians = (degrees * Math.PI) / 180;
    filters.push(`rotate=${radians.toFixed(6)}:fillcolor=black@0`);
  }

  if (findFirstOperation(operations, "handheld_motion")) {
    filters.push("rotate='0.012*sin(2*PI*t*1.9)':fillcolor=black@0");
  }

  if (findFirstOperation(operations, "focus_speaker")) {
    filters.push("unsharp=5:5:0.7:3:3:0.0");
    filters.push("vignette=angle=PI/5");
  }

  const captionOps = findOperations(operations, "caption");
  if (captionOps.length > 0) {
    const fontFile = process.env.CAPTION_FONTFILE;
    if (!fontFile) {
      warnings.push("caption operation requested but CAPTION_FONTFILE is not configured; skipping captions");
    } else {
      const caption = captionOps[0];
      const text = escapeDrawText(caption.text || "Caption");
      const fontPath = path.resolve(fontFile).replace(/\\/g, "/");
      filters.push(
        `drawtext=fontfile='${fontPath}':text='${text}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-(text_h*2):box=1:boxcolor=black@0.45:boxborderw=12`
      );
    }
  }

  for (const op of operations) {
    if (
      [
        "zoom_in",
        "zoom_out",
        "pan",
        "cut",
        "speed_ramp",
        "freeze_frame",
        "beat_sync",
        "transition_motion_blur",
        "ar_sticker"
      ].includes(op.op)
    ) {
      warnings.push(`operation '${op.op}' is planned but not implemented in ffmpeg render path yet`);
    }
  }

  return filters;
};

const buildAudioFilterChain = (operations) => {
  const audioFilters = [];
  if (findFirstOperation(operations, "denoise_audio")) {
    audioFilters.push("afftdn=nf=-28");
  }
  return audioFilters;
};

const buildFfmpegRenderArgs = ({ sourcePath, plan, outputPath }) => {
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  const warnings = [];
  const trim = buildTrimArgs(operations);
  const videoFilters = buildVideoFilterChain(operations, warnings);
  const audioFilters = buildAudioFilterChain(operations);

  const args = ["-y", ...trim.args, "-i", sourcePath];

  if (videoFilters.length > 0) {
    args.push("-vf", videoFilters.join(","));
  }
  if (audioFilters.length > 0) {
    args.push("-af", audioFilters.join(","));
  }

  args.push("-map", "0:v:0");
  args.push("-map", "0:a?");
  args.push("-c:v", "libx264");
  args.push("-pix_fmt", "yuv420p");
  args.push("-c:a", "aac");
  args.push("-movflags", "+faststart");
  args.push("-threads", "0");
  args.push(outputPath);

  return {
    args,
    warnings,
    estimatedDuration: trim.trimDurationSeconds
  };
};

const parseFfmpegTimeToSeconds = (line) => {
  const match = line.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

module.exports = {
  buildFfmpegRenderArgs,
  parseFfmpegTimeToSeconds
};

