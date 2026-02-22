const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const AdmZip = require("adm-zip");

const app = express();
const PORT = Number(process.env.TRAINING_LAB_PORT || 3011);

const LAB_ROOT = __dirname;
const TRAINING_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(TRAINING_ROOT, "..");
const DATASETS_ROOT = path.join(TRAINING_ROOT, "datasets");
const PYTHON_ROOT = path.join(TRAINING_ROOT, "python");
const RAW_DIR = path.join(DATASETS_ROOT, "raw");
const ANNOTATED_DIR = path.join(DATASETS_ROOT, "annotated");
const SFT_DIR = path.join(DATASETS_ROOT, "sft");
const SPLITS_DIR = path.join(DATASETS_ROOT, "splits");
const TEMPLATE_ANNOTATION = path.join(ANNOTATED_DIR, "example_tiktok_01.json");
const SCHEMA_PATH = path.join(TRAINING_ROOT, "schemas", "advanced-edit-plan.schema.json");
const PROMPT_PATH = path.join(TRAINING_ROOT, "prompts", "system_advanced_planner.txt");

const IMPORTS_DIR = path.join(LAB_ROOT, "imports");
const UPLOADS_DIR = path.join(LAB_ROOT, "uploads");
const LOGS_DIR = path.join(LAB_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "lab.log");
const PYTHON_BIN = process.env.TRAINING_PYTHON_BIN || "python";

for (const dir of [RAW_DIR, ANNOTATED_DIR, SFT_DIR, SPLITS_DIR, IMPORTS_DIR, UPLOADS_DIR, LOGS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(LAB_ROOT, "public")));

const emitter = new EventEmitter();
const logBuffer = [];
const MAX_LOGS = 500;
let activeTask = null;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".zip";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_ZIP_MB || 5120) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!String(file.originalname || "").toLowerCase().endsWith(".zip")) {
      cb(new Error("Only .zip files are allowed"));
      return;
    }
    cb(null, true);
  }
});

const MEDIA_EXTS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg"]);

const nowIso = () => new Date().toISOString();

const pushLog = (level, message, meta = null) => {
  const entry = {
    at: nowIso(),
    level,
    message,
    meta
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.splice(0, logBuffer.length - MAX_LOGS);
  }

  fs.appendFileSync(LOG_FILE, `${entry.at} [${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}\n`, "utf8");
  emitter.emit("log", entry);
};

const walkFiles = (rootDir) => {
  const out = [];
  const stack = [rootDir];
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

const safeBaseName = (name) => name.replace(/[^a-zA-Z0-9._-]+/g, "_");

const parseJsonMaybe = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const summarizeAnnotatedOperations = () => {
  const counts = new Map();
  for (const file of fs.readdirSync(ANNOTATED_DIR).filter((entry) => entry.endsWith(".json"))) {
    const parsed = parseJsonMaybe(path.join(ANNOTATED_DIR, file));
    if (!parsed || !Array.isArray(parsed?.plan?.operations)) continue;
    for (const operation of parsed.plan.operations) {
      const op = String(operation.op || "unknown");
      counts.set(op, (counts.get(op) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([op, count]) => ({ op, count }));
};

const isAnnotatedPlan = (obj) => {
  return Boolean(
    obj &&
      typeof obj === "object" &&
      typeof obj.instruction === "string" &&
      obj.plan &&
      Array.isArray(obj.plan.operations)
  );
};

const getDatasetStats = () => {
  const countJson = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  const countJsonl = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length;

  let rawVideos = 0;
  for (const full of walkFiles(RAW_DIR)) {
    if (MEDIA_EXTS.has(path.extname(full).toLowerCase())) rawVideos += 1;
  }

  return {
    annotatedJson: countJson(ANNOTATED_DIR),
    rawVideos,
    sftJsonl: countJsonl(SFT_DIR),
    splitJsonl: countJsonl(SPLITS_DIR),
    operationCoverage: summarizeAnnotatedOperations(),
    activeTask
  };
};

const runNodeScript = (scriptRelativePath, env = {}) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PROJECT_ROOT, scriptRelativePath);
    pushLog("info", `Running script: ${scriptRelativePath}`);

    const child = spawn("node", [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => pushLog("info", line));
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => pushLog("error", line));
    });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      const error = new Error(`${scriptRelativePath} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
};

const runProcess = (bin, args, { cwd = PROJECT_ROOT, env = {}, label = null, streamLogs = true } = {}) => {
  return new Promise((resolve, reject) => {
    const taskLabel = label || `${bin} ${args.join(" ")}`;
    if (streamLogs) {
      pushLog("info", `Running process: ${taskLabel}`);
    }

    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (streamLogs) {
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => pushLog("info", line));
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (streamLogs) {
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => pushLog("error", line));
      }
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      const error = new Error(`${taskLabel} exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
};

const runPythonScript = (scriptName, args = [], env = {}, options = {}) => {
  const scriptPath = path.join(PYTHON_ROOT, scriptName);
  return runProcess(PYTHON_BIN, [scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    env,
    label: `python ${path.join("training", "python", scriptName)} ${args.join(" ")}`.trim(),
    ...options
  });
};

const runAction = async (action) => {
  if (activeTask) {
    throw new Error(`Task already running: ${activeTask.action}`);
  }

  const startedAt = nowIso();
  activeTask = { action, startedAt, status: "running" };

  try {
    if (action === "validate") {
      await runNodeScript("training/scripts/validate_annotated.js");
    } else if (action === "quality") {
      await runNodeScript("training/scripts/report_quality.js");
    } else if (action === "bootstrap") {
      await runNodeScript("training/scripts/bootstrap_annotations.js");
    } else if (action === "coverage") {
      await runNodeScript("training/scripts/check_coverage.js");
    } else if (action === "build") {
      await runNodeScript("training/scripts/build_sft_dataset.js");
    } else if (action === "split") {
      await runNodeScript("training/scripts/split_dataset.js");
    } else if (action === "py-check") {
      await runPythonScript("env_check.py", ["--json"]);
    } else if (action === "py-install-cpu") {
      await runProcess(PYTHON_BIN, ["-m", "pip", "install", "-r", path.join("training", "python", "requirements-cpu.txt")], {
        cwd: PROJECT_ROOT,
        label: "python -m pip install -r training/python/requirements-cpu.txt"
      });
    } else if (action === "py-install-cuda") {
      await runProcess(PYTHON_BIN, ["-m", "pip", "install", "-r", path.join("training", "python", "requirements-cuda.txt")], {
        cwd: PROJECT_ROOT,
        label: "python -m pip install -r training/python/requirements-cuda.txt"
      });
    } else if (action === "py-prepare") {
      await runPythonScript("prepare_dataset.py");
    } else if (action === "py-train-dry") {
      await runPythonScript("train_lora.py", ["--dry-run"]);
    } else if (action === "py-train") {
      await runPythonScript("train_lora.py");
    } else if (action === "run-all") {
      await runNodeScript("training/scripts/validate_annotated.js");
      await runNodeScript("training/scripts/check_coverage.js");
      await runNodeScript("training/scripts/build_sft_dataset.js");
      await runNodeScript("training/scripts/split_dataset.js");
      await runNodeScript("training/scripts/report_quality.js");
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    pushLog("info", `Action completed: ${action}`);
    activeTask = null;
    return { ok: true, action, startedAt, completedAt: nowIso() };
  } catch (error) {
    pushLog("error", `Action failed: ${action}`, { reason: error.message });
    activeTask = null;
    throw error;
  }
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "training-lab", port: PORT, now: nowIso() });
});

app.get("/api/stats", (_req, res) => {
  res.json(getDatasetStats());
});

app.get("/api/model-status", async (_req, res) => {
  const plannerModel = process.env.PLANNER_MODEL || "qwen2.5-coder:14b";
  const visionModel = process.env.VISION_MODEL || "llama3.2-vision:latest";
  const ollamaBase = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

  try {
    const response = await fetch(`${ollamaBase}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama tags request failed with ${response.status}`);
    }
    const data = await response.json();
    const names = new Set((data.models || []).map((entry) => entry.name));

    res.json({
      ok: true,
      ollamaBase,
      plannerModel,
      visionModel,
      plannerInstalled: names.has(plannerModel),
      visionInstalled: names.has(visionModel),
      models: [...names].sort()
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error.message,
      ollamaBase,
      plannerModel,
      visionModel
    });
  }
});

app.get("/api/python-status", async (_req, res) => {
  try {
    const result = await runPythonScript("env_check.py", ["--json"], {}, { streamLogs: false });
    const parsed = JSON.parse(result.stdout || "{}");
    res.json({
      ok: true,
      pythonBin: PYTHON_BIN,
      ...parsed
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      pythonBin: PYTHON_BIN,
      error: error.message
    });
  }
});

app.get("/api/logs", (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
  res.json({ logs: logBuffer.slice(-limit) });
});

app.get("/api/log-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };

  logBuffer.slice(-30).forEach(send);

  const onLog = (entry) => send(entry);
  emitter.on("log", onLog);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    emitter.off("log", onLog);
  });
});

app.post("/api/upload-zip", upload.single("datasetZip"), (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Missing datasetZip file" });
      return;
    }

    const importId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const importDir = path.join(IMPORTS_DIR, importId);
    fs.mkdirSync(importDir, { recursive: true });

    pushLog("info", "ZIP upload received", {
      file: req.file.originalname,
      bytes: req.file.size,
      importId
    });

    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(importDir, true);

    const files = walkFiles(importDir);
    const summary = {
      importId,
      extractedFiles: files.length,
      copiedAnnotatedJson: 0,
      copiedRawVideos: 0,
      ignoredJson: 0,
      otherFiles: 0
    };

    const rawImportDir = path.join(RAW_DIR, `import-${importId}`);
    fs.mkdirSync(rawImportDir, { recursive: true });

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const base = safeBaseName(path.basename(file));

      if (ext === ".json") {
        const parsed = parseJsonMaybe(file);
        if (isAnnotatedPlan(parsed)) {
          const target = path.join(ANNOTATED_DIR, `${importId}-${base}`);
          fs.copyFileSync(file, target);
          summary.copiedAnnotatedJson += 1;
        } else {
          summary.ignoredJson += 1;
        }
        continue;
      }

      if (MEDIA_EXTS.has(ext)) {
        const target = path.join(rawImportDir, base);
        fs.copyFileSync(file, target);
        summary.copiedRawVideos += 1;
        continue;
      }

      summary.otherFiles += 1;
    }

    pushLog("info", "ZIP import complete", summary);

    const guidance = [];
    if (summary.copiedAnnotatedJson === 0) {
      guidance.push("No valid annotation JSON files found. Raw videos were imported but they do not train by themselves.");
      guidance.push("Add labeled JSON examples in training/datasets/annotated using the schema in training/schemas/advanced-edit-plan.schema.json.");
    }

    res.status(201).json({
      ok: true,
      summary,
      stats: getDatasetStats(),
      guidance
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/pipeline/:action", async (req, res, next) => {
  try {
    const action = req.params.action;
    if (activeTask) {
      res.status(409).json({ error: `Task already running: ${activeTask.action}` });
      return;
    }

    const result = await runAction(action);
    res.json({ ...result, stats: getDatasetStats() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/download/schema", (_req, res) => {
  res.download(SCHEMA_PATH, "advanced-edit-plan.schema.json");
});

app.get("/api/download/prompt", (_req, res) => {
  res.download(PROMPT_PATH, "system_advanced_planner.txt");
});

app.get("/api/download/template", (_req, res) => {
  res.download(TEMPLATE_ANNOTATION, "annotation-template.json");
});

app.get("/api/export/training-bundle", (_req, res, next) => {
  try {
    const bundleName = `training-bundle-${Date.now()}.zip`;
    const bundlePath = path.join(IMPORTS_DIR, bundleName);
    const zip = new AdmZip();

    zip.addLocalFolder(ANNOTATED_DIR, "annotated");
    zip.addLocalFolder(SFT_DIR, "sft");
    zip.addLocalFolder(SPLITS_DIR, "splits");
    if (fs.existsSync(SCHEMA_PATH)) zip.addLocalFile(SCHEMA_PATH, "", "advanced-edit-plan.schema.json");
    if (fs.existsSync(PROMPT_PATH)) zip.addLocalFile(PROMPT_PATH, "", "system_advanced_planner.txt");

    zip.writeZip(bundlePath);
    pushLog("info", "Training bundle exported", { bundlePath });
    res.download(bundlePath, bundleName);
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(LAB_ROOT, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  pushLog("error", "API error", { message: error.message });
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "ZIP file too large" });
    return;
  }
  if (error.message?.includes("Only .zip")) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: error.message || "Internal server error" });
});

app.listen(PORT, () => {
  pushLog("info", `Training lab listening on http://localhost:${PORT}`);
  pushLog("info", "Model role summary", {
    plannerModel: process.env.PLANNER_MODEL || "qwen2.5-coder:14b",
    visionModel: process.env.VISION_MODEL || "llama3.2-vision:latest",
    trainingTarget: "planner model"
  });
});
