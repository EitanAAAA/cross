const OPERATION_CAPABILITIES = {
  trim: {
    label: "Trim Range",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  cut: {
    label: "Hard Cut",
    status: "planned",
    engines: []
  },
  zoom_in: {
    label: "Zoom In",
    status: "implemented",
    engines: ["mlt"]
  },
  zoom_out: {
    label: "Zoom Out",
    status: "implemented",
    engines: ["mlt"]
  },
  pan: {
    label: "Pan",
    status: "planned",
    engines: []
  },
  rotate: {
    label: "Rotate",
    status: "partial",
    engines: ["ffmpeg"]
  },
  speed_ramp: {
    label: "Speed Ramp",
    status: "planned",
    engines: []
  },
  freeze_frame: {
    label: "Freeze Frame",
    status: "planned",
    engines: []
  },
  blur: {
    label: "Blur",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  color_grade: {
    label: "Color Grade",
    status: "partial",
    engines: ["ffmpeg"]
  },
  caption: {
    label: "Caption",
    status: "planned",
    engines: []
  },
  beat_sync: {
    label: "Beat Sync",
    status: "planned",
    engines: []
  },
  transition_motion_blur: {
    label: "Motion Blur Transition",
    status: "planned",
    engines: []
  },
  focus_speaker: {
    label: "Focus Speaker",
    status: "partial",
    engines: ["ffmpeg"]
  },
  denoise_video: {
    label: "Video Denoise",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  denoise_audio: {
    label: "Audio Denoise",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  brightness: {
    label: "Brightness Adjust",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  handheld_motion: {
    label: "Handheld Motion",
    status: "implemented",
    engines: ["ffmpeg"]
  },
  ar_sticker: {
    label: "AR Sticker",
    status: "planned",
    engines: []
  }
};

const getOperationCapability = (operationName) => {
  return OPERATION_CAPABILITIES[operationName] || null;
};

const getOperationsFromPlan = (plan) => {
  if (!plan || typeof plan !== "object") return [];
  if (Array.isArray(plan.operations)) return plan.operations;
  return [];
};

const summarizePlanCapabilities = (plan) => {
  const operations = getOperationsFromPlan(plan);
  const unsupportedOperations = [];
  const partiallySupportedOperations = [];
  const fullySupportedOperations = [];

  let requiresMlt = false;
  let requiresFfmpeg = false;

  for (const operation of operations) {
    const opName = operation?.op;
    const capability = getOperationCapability(opName);
    if (!capability) {
      unsupportedOperations.push({
        op: opName || "unknown",
        reason: "Unknown operation"
      });
      continue;
    }

    if (capability.status === "implemented") {
      fullySupportedOperations.push(opName);
    } else if (capability.status === "partial") {
      partiallySupportedOperations.push(opName);
    } else {
      unsupportedOperations.push({
        op: opName,
        reason: "Planned but not implemented yet"
      });
    }

    if (capability.engines.includes("mlt")) requiresMlt = true;
    if (capability.engines.includes("ffmpeg")) requiresFfmpeg = true;
  }

  let recommendedRenderEngine = "mlt";
  if (operations.length === 0) {
    recommendedRenderEngine = "auto";
  } else if (requiresFfmpeg && !requiresMlt) {
    recommendedRenderEngine = "ffmpeg";
  } else if (requiresFfmpeg && requiresMlt) {
    recommendedRenderEngine = "hybrid";
  }

  return {
    operationCount: operations.length,
    fullySupportedOperations,
    partiallySupportedOperations,
    unsupportedOperations,
    recommendedRenderEngine,
    hasUnsupportedOperations: unsupportedOperations.length > 0
  };
};

const listCapabilityRegistry = () => {
  return Object.entries(OPERATION_CAPABILITIES).map(([op, detail]) => ({
    op,
    ...detail
  }));
};

module.exports = {
  OPERATION_CAPABILITIES,
  getOperationCapability,
  summarizePlanCapabilities,
  listCapabilityRegistry
};
