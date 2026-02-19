const path = require("path");
const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const { PROJECTS_DIR } = require("../utils/paths");
const { startRenderJob, getRenderJob } = require("../services/renderManager");

const router = express.Router();

const renderRequestSchema = z.object({
  projectId: z.string().min(4)
});

router.post("/", async (req, res, next) => {
  try {
    const input = renderRequestSchema.parse(req.body);
    const projectPath = path.join(PROJECTS_DIR, `${input.projectId}.mlt`);

    if (!fs.existsSync(projectPath)) {
      res.status(404).json({ error: "MLT project not found", projectId: input.projectId });
      return;
    }

    const job = startRenderJob({
      projectId: input.projectId,
      projectPath
    });

    res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:jobId", (req, res) => {
  const job = getRenderJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Render job not found", jobId: req.params.jobId });
    return;
  }

  res.json({
    ...job,
    outputUrl: job.status === "completed" ? `/renders/${job.outputFileName}` : null
  });
});

module.exports = router;
