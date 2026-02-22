const path = require("path");
const fs = require("fs");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");
const { createEditPlan } = require("../services/planner");
const { writeMltProject } = require("../services/mltBuilder");
const { writeProjectManifest } = require("../services/projectStore");
const { summarizePlanCapabilities } = require("../services/capabilities");
const { extractFrame } = require("../services/video");
const { analyzeFrameForAnchorCorrections, applyAnchorCorrections } = require("../services/vision");
const { findUploadById, PROJECTS_DIR } = require("../utils/paths");
const logger = require("../utils/logger");

const router = express.Router();

const editRequestSchema = z.object({
  uploadId: z.string().min(4),
  instruction: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= 3, "Instruction must be at least 3 characters"),
  useVision: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }
      return value;
    }, z.boolean())
    .optional()
    .default(false)
});

router.post("/", async (req, res, next) => {
  const trace = [];
  const mark = (step, status, details = null) => {
    trace.push({
      step,
      status,
      at: new Date().toISOString(),
      details
    });
  };

  try {
    mark("request_received", "completed", {
      bodyKeys: Object.keys(req.body || {})
    });

    const parsed = editRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      mark("request_validation", "failed", {
        issues: parsed.error.issues
      });
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.issues,
        processingTrace: trace
      });
      return;
    }
    const input = parsed.data;
    mark("request_validation", "completed", {
      uploadId: input.uploadId,
      instructionLength: input.instruction.length,
      useVision: input.useVision
    });

    mark("upload_lookup", "running", { uploadId: input.uploadId });
    const upload = findUploadById(input.uploadId);

    if (!upload) {
      mark("upload_lookup", "failed", { uploadId: input.uploadId });
      res.status(404).json({
        error: "Upload not found",
        uploadId: input.uploadId,
        processingTrace: trace
      });
      return;
    }
    mark("upload_lookup", "completed", {
      uploadPath: upload.path
    });

    mark("planner_call", "running", { model: process.env.PLANNER_MODEL || "qwen2.5-coder:14b" });
    const plannerPlan = await createEditPlan(input.instruction);
    mark("planner_call", "completed", {
      transitionsCount: plannerPlan.transitions.length,
      operationsCount: plannerPlan.operations.length
    });

    let finalPlan = plannerPlan;
    let visionResult = null;

    if (!input.useVision) {
      mark("vision_analysis", "skipped", { reason: "disabled_by_user" });
    } else if (plannerPlan.transitions.length === 0) {
      mark("vision_analysis", "skipped", { reason: "no_transitions" });
    } else {
      mark("vision_analysis", "running", { model: process.env.VISION_MODEL || "llama3.2-vision:latest" });
      const firstTransition = plannerPlan.transitions[0];
      const frameSecond = Math.max(0, (firstTransition.start + firstTransition.end) / 2);
      const framePath = path.join(PROJECTS_DIR, `${uuidv4()}.jpg`);
      try {
        try {
          await extractFrame({ sourcePath: upload.path, atSeconds: frameSecond, outputPath: framePath });
          visionResult = await analyzeFrameForAnchorCorrections(framePath, plannerPlan);
          finalPlan = applyAnchorCorrections(plannerPlan, visionResult);
          mark("vision_analysis", "completed", {
            corrections: visionResult.anchor_corrections.length
          });
        } catch (visionError) {
          visionResult = {
            anchor_corrections: [],
            warning: visionError.message,
            fallbackApplied: true
          };
          finalPlan = plannerPlan;
          mark("vision_analysis", "skipped", {
            reason: visionError.message,
            fallback: "planner_plan_retained"
          });
        }
      } finally {
        fs.rmSync(framePath, { force: true });
      }
    }

    const projectId = uuidv4();
    const capabilitySummary = summarizePlanCapabilities(finalPlan);

    mark("project_manifest_generation", "running", {
      projectId,
      recommendedRenderEngine: capabilitySummary.recommendedRenderEngine
    });
    const manifestPath = writeProjectManifest({
      projectId,
      sourcePath: upload.path,
      plan: finalPlan,
      capabilitySummary
    });
    mark("project_manifest_generation", "completed", {
      manifestFile: path.basename(manifestPath)
    });

    if (finalPlan.transitions.length > 0) {
      mark("mlt_project_generation", "running", { projectId });
      await writeMltProject({
        projectId,
        sourcePath: upload.path,
        plan: finalPlan
      });
      mark("mlt_project_generation", "completed", {
        projectFile: `${projectId}.mlt`
      });
    } else {
      mark("mlt_project_generation", "skipped", { reason: "no_zoom_transitions" });
    }

    logger.info({ projectId, uploadId: upload.id }, "edit plan created");

    res.status(201).json({
      projectId,
      projectFile: `${projectId}.mlt`,
      uploadId: upload.id,
      plannerPlan,
      finalPlan,
      capabilitySummary,
      visionResult,
      processingTrace: trace
    });
  } catch (error) {
    const runningStep = [...trace].reverse().find((entry) => entry.status === "running");
    if (runningStep) {
      mark(runningStep.step, "failed", {
        reason: error.message
      });
    }

    if (error?.name === "ZodError") {
      const stageName = runningStep?.step === "planner_call" ? "Planner output invalid" : "Invalid request";
      res.status(422).json({
        error: stageName,
        details: error.issues || [],
        processingTrace: trace
      });
      return;
    }

    if (runningStep?.step === "planner_call" || runningStep?.step === "vision_analysis") {
      res.status(502).json({
        error: error.message || "Model call failed",
        processingTrace: trace
      });
      return;
    }

    if (trace.length > 0) {
      res.status(500).json({
        error: error.message || "Edit pipeline failed",
        processingTrace: trace
      });
      return;
    }

    next(error);
  }
});

module.exports = router;
