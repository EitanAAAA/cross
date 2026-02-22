const { z } = require("zod");
const { chatJSON } = require("./ollama");
const { plannerSystemPrompt, buildPlannerUserPrompt } = require("./prompts");

const PLANNER_MODEL = process.env.PLANNER_MODEL || "qwen2.5-coder:14b";

const transitionSchema = z.object({
  type: z.enum(["zoom_in", "zoom_out", "zoom"]),
  start: z.coerce.number(),
  end: z.coerce.number(),
  anchor: z
    .enum([
      "center",
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right"
    ])
    .default("center"),
  easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).default("ease-in-out"),
  strength: z.union([z.number(), z.string()]).optional().default(1.2)
});

const operationSchema = z.object({
  op: z.enum([
    "trim",
    "cut",
    "zoom_in",
    "zoom_out",
    "pan",
    "rotate",
    "speed_ramp",
    "freeze_frame",
    "blur",
    "color_grade",
    "caption",
    "beat_sync",
    "transition_motion_blur",
    "focus_speaker",
    "denoise_video",
    "denoise_audio",
    "brightness",
    "handheld_motion",
    "ar_sticker"
  ]),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
  at: z.coerce.number().optional(),
  anchor: z
    .enum([
      "center",
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right"
    ])
    .optional(),
  easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(),
  strength: z.union([z.number(), z.string()]).optional(),
  speed: z.coerce.number().optional(),
  degrees: z.coerce.number().optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  text: z.string().trim().min(1).max(120).optional(),
  preset: z.string().trim().min(1).max(60).optional(),
  intensity: z.coerce.number().optional()
});

const editPlanSchema = z.object({
  operations: z.array(operationSchema).optional().default([]),
  transitions: z.array(transitionSchema).default([])
});

const normalizeStrength = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) {
    return 1.2;
  }
  return Math.min(parsed, 3);
};

const normalizeTime = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, numeric);
};

const normalizeTransitions = (transitions) =>
  transitions
    .map((t) => ({
      ...t,
      type: t.type === "zoom" ? "zoom_in" : t.type,
      start: normalizeTime(t.start),
      end: normalizeTime(t.end),
      strength: normalizeStrength(t.strength)
    }))
    .filter((t) => t.start !== null && t.end !== null && t.end > t.start);

const normalizeOperations = (operations) =>
  operations
    .map((operation) => {
      const normalized = {
        ...operation
      };
      if (normalized.start !== undefined) normalized.start = normalizeTime(normalized.start);
      if (normalized.end !== undefined) normalized.end = normalizeTime(normalized.end);
      if (normalized.at !== undefined) normalized.at = normalizeTime(normalized.at);
      if (normalized.strength !== undefined) normalized.strength = normalizeStrength(normalized.strength);
      if (normalized.speed !== undefined) {
        const speedValue = Number(normalized.speed);
        normalized.speed = Number.isFinite(speedValue) && speedValue > 0 ? Math.min(speedValue, 4) : 1;
      }
      if (normalized.easing === undefined) normalized.easing = "ease-in-out";
      if (normalized.anchor === undefined) normalized.anchor = "center";
      return normalized;
    })
    .filter((operation) => {
      if (operation.op === "cut" || operation.op === "transition_motion_blur") {
        return operation.at !== null && operation.at !== undefined;
      }
      if (
        [
          "trim",
          "zoom_in",
          "zoom_out",
          "pan",
          "rotate",
          "speed_ramp",
          "freeze_frame",
          "blur",
          "color_grade",
          "caption",
          "beat_sync",
          "focus_speaker",
          "denoise_video",
          "denoise_audio",
          "brightness",
          "handheld_motion",
          "ar_sticker"
        ].includes(operation.op)
      ) {
        return (
          operation.start !== null &&
          operation.start !== undefined &&
          operation.end !== null &&
          operation.end !== undefined &&
          operation.end > operation.start
        );
      }
      return true;
    });

const transitionsToOperations = (transitions) =>
  transitions.map((transition) => ({
    op: transition.type === "zoom" ? "zoom_in" : transition.type,
    start: transition.start,
    end: transition.end,
    anchor: transition.anchor,
    easing: transition.easing,
    strength: transition.strength
  }));

const operationsToTransitions = (operations) =>
  operations
    .filter((operation) => operation.op === "zoom_in" || operation.op === "zoom_out")
    .map((operation) => ({
      type: operation.op,
      start: operation.start,
      end: operation.end,
      anchor: operation.anchor || "center",
      easing: operation.easing || "ease-in-out",
      strength: normalizeStrength(operation.strength)
    }));

const sortOperationsByTimeline = (operations) => {
  return [...operations].sort((a, b) => {
    const aTime = a.start ?? a.at ?? 0;
    const bTime = b.start ?? b.at ?? 0;
    return aTime - bTime;
  });
};

const normalizePlan = (plan) => {
  const normalizedTransitions = normalizeTransitions(plan.transitions || []);
  const normalizedOperations = normalizeOperations(plan.operations || []);

  const mergedOperations =
    normalizedOperations.length > 0 ? normalizedOperations : transitionsToOperations(normalizedTransitions);
  const mergedTransitions =
    normalizedTransitions.length > 0 ? normalizedTransitions : operationsToTransitions(normalizedOperations);

  return {
    operations: sortOperationsByTimeline(mergedOperations),
    transitions: mergedTransitions
  };
};

const createEditPlan = async (instruction) => {
  if (!instruction || typeof instruction !== "string") {
    throw new Error("Instruction is required");
  }

  const raw = await chatJSON({
    model: PLANNER_MODEL,
    systemPrompt: plannerSystemPrompt,
    userPrompt: buildPlannerUserPrompt(instruction),
    temperature: 0
  });

  const parsed = editPlanSchema.parse(raw);
  return normalizePlan(parsed);
};

module.exports = {
  createEditPlan,
  buildPlannerUserPrompt,
  plannerSystemPrompt,
  editPlanSchema
};
