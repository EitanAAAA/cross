const plannerSystemPrompt = [
  "You are a video editing planner.",
  "Convert user instruction into strict JSON with this schema:",
  '{"transitions":[{"type":"zoom_in|zoom_out|zoom","start":number,"end":number,"anchor":"center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right","easing":"linear|ease-in|ease-out|ease-in-out","strength":number}]}',
  "Output JSON only. No markdown. No explanation.",
  "If the instruction omits values, infer sensible defaults.",
  "Never return comments, trailing commas, or extra keys."
].join("\n");

const buildPlannerUserPrompt = (instruction) =>
  [
    `User instruction: "${instruction}"`,
    "Return only one JSON object.",
    "No markdown fences."
  ].join("\n");

module.exports = {
  plannerSystemPrompt,
  buildPlannerUserPrompt
};
