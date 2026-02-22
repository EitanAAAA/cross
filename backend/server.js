require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pinoHttp = require("pino-http");
const uploadRoute = require("./routes/upload");
const editRoute = require("./routes/edit");
const renderRoute = require("./routes/render");
const capabilitiesRoute = require("./routes/capabilities");
const logger = require("./utils/logger");
const { ensureStorageDirs, RENDERS_DIR, UPLOADS_DIR } = require("./utils/paths");

ensureStorageDirs();

const app = express();
const port = Number(process.env.PORT || 4000);
const nodeEnv = process.env.NODE_ENV || "development";
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3010";

const configuredOrigins = frontendOrigin
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const withLocalAliases = new Set(configuredOrigins);
for (const origin of configuredOrigins) {
  if (origin.includes("localhost")) {
    withLocalAliases.add(origin.replace("localhost", "127.0.0.1"));
  }
  if (origin.includes("127.0.0.1")) {
    withLocalAliases.add(origin.replace("127.0.0.1", "localhost"));
  }
}

const isDevLocalOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      if (nodeEnv === "development") {
        callback(null, true);
        return;
      }
      if (!origin) {
        callback(null, true);
        return;
      }
      if (withLocalAliases.has(origin) || isDevLocalOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-video-editor-backend",
    now: new Date().toISOString()
  });
});

app.use("/api/upload", uploadRoute);
app.use("/api/edit", editRoute);
app.use("/api/render", renderRoute);
app.use("/api/capabilities", capabilitiesRoute);

app.use("/renders", express.static(RENDERS_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use((error, _req, res, _next) => {
  logger.error({ err: error }, "request failed");
  if (error.name === "ZodError") {
    res.status(400).json({ error: "Invalid request", details: error.issues });
    return;
  }
  if (error.message?.includes("Only video files are supported")) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Uploaded file is too large" });
    return;
  }
  res.status(500).json({ error: "Internal server error", details: error.message });
});

const server = app.listen(port, () => {
  logger.info({ port, frontendOrigin }, "backend server listening");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error({ port }, `Port ${port} is already in use. Stop the old backend process and retry.`);
    process.exit(1);
    return;
  }
  logger.error({ err: error }, "backend server failed to start");
  process.exit(1);
});
