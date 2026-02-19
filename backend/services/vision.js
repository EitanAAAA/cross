const fs = require("fs");
const { z } = require("zod");
const { generateJSONWithImage } = require("./ollama");

const VISION_MODEL = process.env.VISION_MODEL || "llama3.2-vision:11b";

const visionSchema = z.object({
  anchor_corrections: z
    .array(
      z.object({
        transition_index: z.coerce.number().int().nonnegative(),
        anchor: z.enum([
          "center",
          "top",
          "bottom",
          "left",
          "right",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right"
        ]),
        confidence: z.coerce.number().min(0).max(1).default(0.5),
        reason: z.string().min(1).max(200).default("visual adjustment")
      })
    )
    .default([])
});

const buildVisionPrompt = (plan) => {
  return [
    "Analyze this video frame and return strict JSON only.",
    "Task: detect salient subject center (face/object).",
    "If current transition anchors should change, return corrections.",
    `Current plan: ${JSON.stringify(plan)}`,
    'Output schema: {"anchor_corrections":[{"transition_index":0,"anchor":"center","confidence":0.0,"reason":"..."}]}'
  ].join("\n");
};

const analyzeFrameForAnchorCorrections = async (framePath, plan) => {
  const imageBuffer = fs.readFileSync(framePath);
  const imageBase64 = imageBuffer.toString("base64");

  const raw = await generateJSONWithImage({
    model: VISION_MODEL,
    prompt: buildVisionPrompt(plan),
    imageBase64,
    temperature: 0
  });

  return visionSchema.parse(raw);
};

const applyAnchorCorrections = (plan, visionResult, minConfidence = 0.65) => {
  const updated = structuredClone(plan);

  for (const correction of visionResult.anchor_corrections) {
    if (correction.confidence < minConfidence) continue;
    const transition = updated.transitions[correction.transition_index];
    if (!transition) continue;
    transition.anchor = correction.anchor;
  }

  return updated;
};

module.exports = {
  analyzeFrameForAnchorCorrections,
  applyAnchorCorrections
};
