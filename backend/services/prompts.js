const plannerSystemPrompt = [
  "You are a high-level short-form video editing planner.",
  "Convert user instruction into strict JSON with this schema:",
  '{"operations":[{"op":"trim|cut|zoom_in|zoom_out|pan|rotate|speed_ramp|freeze_frame|blur|color_grade|caption|beat_sync|transition_motion_blur|focus_speaker|denoise_video|denoise_audio|brightness|handheld_motion|ar_sticker","start":number,"end":number,"at":number,"anchor":"center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right","easing":"linear|ease-in|ease-out|ease-in-out","strength":number,"speed":number,"degrees":number,"direction":"left|right|up|down","text":string,"preset":string,"intensity":number}],"transitions":[{"type":"zoom_in|zoom_out|zoom","start":number,"end":number,"anchor":"center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right","easing":"linear|ease-in|ease-out|ease-in-out","strength":number}]}',
  "Output JSON only. No markdown. No explanation.",
  "Return operations even for advanced effects.",
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
