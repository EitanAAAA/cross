const { z } = require("zod");
const { chatJSON } = require("./ollama");
const { plannerSystemPrompt, buildPlannerUserPrompt } = require("./prompts");

const PLANNER_MODEL = process.env.PLANNER_MODEL || "qwen2.5-coder:14b";

const transitionSchema = z.object({
  type: z.enum(["zoom_in", "zoom_out", "zoom"]),
  start: z.coerce.number().nonnegative(),
  end: z.coerce.number().positive(),
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

const editPlanSchema = z.object({
  transitions: z.array(transitionSchema).default([])
});

const normalizeStrength = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) {
    return 1.2;
  }
  return Math.min(parsed, 3);
};

const normalizePlan = (plan) => {
  return {
    transitions: plan.transitions
      .map((t) => ({
        ...t,
        type: t.type === "zoom" ? "zoom_in" : t.type,
        strength: normalizeStrength(t.strength)
      }))
      .filter((t) => t.end > t.start)
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
