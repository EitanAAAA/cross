const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { validateExample } = require("./lib/validation");

const root = path.join(__dirname, "..");
const rawDir = path.join(root, "datasets", "raw");
const annotatedDir = path.join(root, "datasets", "annotated");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpeg", ".mpg"]);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const PLANNER_MODEL = process.env.PLANNER_MODEL || "qwen2.5-coder:14b";
const OLLAMA_TIMEOUT_MS = Math.max(12000, Number(process.env.OLLAMA_TIMEOUT_MS || 35000));

const walkFiles = (dir) => {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
};

const sanitizeId = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round2 = (value) => Math.round(value * 100) / 100;

const ffprobeCandidates = [
  process.env.FFPROBE_BIN,
  "ffprobe",
  "C:\\Program Files\\kdenlive\\bin\\ffprobe.exe",
  "C:\\Program Files\\Kdenlive\\bin\\ffprobe.exe"
].filter(Boolean);

const canRunBin = (bin) => {
  const test = spawnSync(bin, ["-version"], { encoding: "utf8", windowsHide: true });
  return test.status === 0;
};

const findFfprobeBin = () => {
  for (const candidate of ffprobeCandidates) {
    if (candidate.includes("\\") && !fs.existsSync(candidate)) continue;
    if (canRunBin(candidate)) return candidate;
  }
  return null;
};

const probeDurationSeconds = (ffprobeBin, videoPath) => {
  if (!ffprobeBin) return null;
  const result = spawnSync(
    ffprobeBin,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath
    ],
    { encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) return null;
  const parsed = Number((result.stdout || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const buildFallbackPlan = (durationSeconds) => {
  const end = clamp(round2(durationSeconds || 12), 6, 22);
  const cutAt = round2(clamp(end * 0.32, 0.8, end - 0.8));
  const rampStart = round2(clamp(end * 0.48, 1.2, end - 1.7));
  const rampEnd = round2(clamp(rampStart + 1.05, rampStart + 0.35, end - 0.35));
  const blurStart = round2(clamp(cutAt - 0.14, 0.1, end - 0.2));
  const blurEnd = round2(clamp(cutAt + 0.14, blurStart + 0.08, end - 0.05));
  const freezeStart = round2(clamp(end - 1.2, 0.5, end - 0.25));
  const freezeEnd = round2(clamp(freezeStart + 0.45, freezeStart + 0.15, end));
  const captionStart = round2(clamp(0.35, 0, end - 0.4));
  const captionEnd = round2(clamp(captionStart + 1.4, captionStart + 0.3, end));
  const zoomEnd = round2(clamp(end * 0.28, 0.9, end - 0.2));
  const panStart = round2(clamp(end * 0.66, 0.8, end - 1.2));
  const panEnd = round2(clamp(panStart + 0.9, panStart + 0.2, end - 0.05));
  const rotateStart = round2(clamp(end * 0.82, 0.8, end - 0.6));
  const rotateEnd = round2(clamp(rotateStart + 0.35, rotateStart + 0.1, end));

  return {
    operations: [
      { op: "trim", start: 0, end },
      { op: "caption", start: captionStart, end: captionEnd, text: "HOOK" },
      { op: "zoom_in", start: 0, end: zoomEnd, anchor: "center", easing: "ease-in-out", strength: 1.18 },
      { op: "cut", at: cutAt },
      { op: "transition", at: cutAt, style: "flash" },
      { op: "blur", start: blurStart, end: blurEnd, strength: 0.55 },
      { op: "speed_ramp", start: rampStart, end: rampEnd, speed: 1.75 },
      { op: "color_grade", start: 0, end, preset: "cinematic_contrast" },
      { op: "beat_sync", start: 0, end, intensity: 0.7 },
      { op: "pan", start: panStart, end: panEnd, anchor: "right", easing: "ease-in-out", strength: 1.06 },
      { op: "freeze_frame", start: freezeStart, end: freezeEnd },
      { op: "rotate", start: rotateStart, end: rotateEnd, degrees: 1.4 }
    ]
  };
};

const extractJsonObject = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
};

const generateWithPlanner = async ({ videoStem, durationSeconds }) => {
  const durationText = durationSeconds ? `${round2(durationSeconds)} seconds` : "unknown duration";
  const prompt = [
    "You generate high-quality TikTok edit labels.",
    "Return strict JSON object only, no markdown.",
    "Schema:",
    "{",
    '  "instruction": "string",',
    '  "style_tags": ["string"],',
    '  "plan": { "operations": [ { "op": "...", "...": "..." } ] }',
    "}",
    "Use diverse operations, not zoom-only.",
    "Allowed ops: trim, cut, zoom_in, zoom_out, pan, rotate, speed_ramp, freeze_frame, blur, color_grade, caption, beat_sync, transition.",
    "Timing rules: start>=0, end>start, for cut/transition use {at:number}.",
    "Caption op must include text.",
    "",
    `Video name hint: ${videoStem}`,
    `Video duration: ${durationText}`,
    "Goal style: pro, fast, modern tiktok edit with variety."
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: PLANNER_MODEL,
        prompt,
        format: "json",
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Planner timeout after ${OLLAMA_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Ollama request failed (${response.status})`);
  }

  const body = await response.json();
  const parsed = extractJsonObject(body?.response);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Planner returned non-JSON response");
  }

  return {
    instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
    style_tags: Array.isArray(parsed.style_tags) ? parsed.style_tags.map((x) => String(x)) : [],
    plan: parsed.plan && typeof parsed.plan === "object" ? parsed.plan : {}
  };
};

const loadExisting = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const needsAutoRefresh = (existing) => {
  if (!existing || typeof existing !== "object") return true;
  if (typeof existing.instruction !== "string") return true;
  if (existing.instruction.toLowerCase().includes("todo:")) return true;
  const operations = existing?.plan?.operations;
  if (!Array.isArray(operations) || operations.length === 0) return true;
  return false;
};

const buildExample = ({ id, sourceVideo, durationSeconds, generated }) => {
  const fallback = buildFallbackPlan(durationSeconds);
  const instruction =
    typeof generated?.instruction === "string" && generated.instruction.trim().length > 10
      ? generated.instruction.trim()
      : "Create a dynamic high-retention TikTok edit with fast pacing, clean transitions, captions, speed changes, and polished grading.";

  const styleTags =
    Array.isArray(generated?.style_tags) && generated.style_tags.length > 0
      ? [...new Set(generated.style_tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : ["tiktok", "high-retention", "auto-generated"];

  const plannerPlanValid = Boolean(generated?.plan && Array.isArray(generated?.plan?.operations));
  const plan = plannerPlanValid ? generated.plan : fallback;
  const example = {
    id: `bootstrap_${id}`,
    instruction,
    style_tags: styleTags,
    source_video: sourceVideo,
    plan
  };

  const errors = validateExample(example, `bootstrap_${id}.json`);
  if (errors.length > 0) {
    return {
      example: {
        ...example,
        plan: fallback
      },
      usedFallback: true,
      errors
    };
  }

  return {
    example,
    usedFallback: !plannerPlanValid,
    errors: []
  };
};

const main = async () => {
  if (!fs.existsSync(rawDir)) {
    console.error(`Raw dataset folder not found: ${rawDir}`);
    process.exit(1);
  }

  fs.mkdirSync(annotatedDir, { recursive: true });
  const rawVideos = walkFiles(rawDir).filter((file) => VIDEO_EXTS.has(path.extname(file).toLowerCase()));

  if (rawVideos.length === 0) {
    console.log("No raw videos found in training/datasets/raw. Nothing to bootstrap.");
    process.exit(0);
  }

  const ffprobeBin = findFfprobeBin();
  if (!ffprobeBin) {
    console.warn("ffprobe not found. Duration-aware labeling will use defaults.");
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let plannerSuccess = 0;
  let fallbackCount = 0;
  let plannerFailed = 0;

  for (const videoPath of rawVideos) {
    const videoStem = path.parse(path.basename(videoPath)).name;
    const id = sanitizeId(videoStem);
    const target = path.join(annotatedDir, `bootstrap-${id}.json`);
    const existing = loadExisting(target);
    const shouldWrite = !fs.existsSync(target) || needsAutoRefresh(existing);

    if (!shouldWrite) {
      skipped += 1;
      continue;
    }

    const durationSeconds = probeDurationSeconds(ffprobeBin, videoPath);
    const sourceVideo = path.relative(root, videoPath).replace(/\\/g, "/");

    console.log(`[bootstrap] processing ${path.basename(videoPath)} (${sourceVideo})`);
    let generated = null;
    try {
      console.log(`[bootstrap] planner request start (${videoStem})`);
      generated = await generateWithPlanner({ videoStem, durationSeconds });
      plannerSuccess += 1;
      console.log(`[bootstrap] planner request done (${videoStem})`);
    } catch (error) {
      plannerFailed += 1;
      console.warn(`Planner fallback for ${videoStem}: ${error.message}`);
    }

    const built = buildExample({ id, sourceVideo, durationSeconds, generated });
    if (built.usedFallback) fallbackCount += 1;

    fs.writeFileSync(target, JSON.stringify(built.example, null, 2), "utf8");
    if (fs.existsSync(target) && existing) {
      updated += 1;
    } else {
      created += 1;
    }
    console.log(`[bootstrap] wrote ${path.basename(target)} (fallback=${built.usedFallback ? "yes" : "no"})`);
  }

  console.log("Bootstrap auto-labeling complete.");
  console.log(
    `created=${created}, updated=${updated}, skipped=${skipped}, raw_videos=${rawVideos.length}, planner_ok=${plannerSuccess}, planner_failed=${plannerFailed}, fallback_labels=${fallbackCount}`
  );
  console.log("Next steps: run Validate -> Coverage -> Build SFT -> Split -> Prepare Py Dataset -> Dry Run Train -> Start Train.");
};

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
