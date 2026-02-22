const ALLOWED_OPS = new Set([
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
  "transition"
]);

const ALLOWED_ANCHORS = new Set([
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);

const ALLOWED_EASING = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

const requireNumber = (errors, op, field) => {
  if (!isNumber(op[field])) {
    errors.push(`missing numeric field '${field}' for op '${op.op}'`);
  }
};

const validateTiming = (errors, op) => {
  if (isNumber(op.start) && op.start < 0) errors.push(`start must be >= 0 for op '${op.op}'`);
  if (isNumber(op.end) && op.end < 0) errors.push(`end must be >= 0 for op '${op.op}'`);
  if (isNumber(op.start) && isNumber(op.end) && op.end <= op.start) {
    errors.push(`end must be greater than start for op '${op.op}'`);
  }
};

const validateOperation = (op) => {
  const errors = [];

  if (!op || typeof op !== "object") {
    return ["operation must be an object"];
  }

  if (!ALLOWED_OPS.has(op.op)) {
    errors.push(`invalid op '${op.op}'`);
    return errors;
  }

  validateTiming(errors, op);

  if (op.anchor && !ALLOWED_ANCHORS.has(op.anchor)) {
    errors.push(`invalid anchor '${op.anchor}'`);
  }
  if (op.easing && !ALLOWED_EASING.has(op.easing)) {
    errors.push(`invalid easing '${op.easing}'`);
  }

  switch (op.op) {
    case "trim":
    case "zoom_in":
    case "zoom_out":
    case "pan":
    case "rotate":
    case "speed_ramp":
    case "freeze_frame":
    case "blur":
    case "color_grade":
    case "caption":
    case "beat_sync":
      requireNumber(errors, op, "start");
      requireNumber(errors, op, "end");
      break;
    default:
      break;
  }

  if (op.op === "cut" || op.op === "transition") {
    requireNumber(errors, op, "at");
  }

  if ((op.op === "zoom_in" || op.op === "zoom_out" || op.op === "pan") && op.strength !== undefined) {
    if (!isNumber(op.strength) || op.strength <= 0) {
      errors.push(`strength must be > 0 for op '${op.op}'`);
    }
  }

  if (op.op === "speed_ramp") {
    if (!isNumber(op.speed) || op.speed <= 0) {
      errors.push("speed_ramp requires speed > 0");
    }
  }

  if (op.op === "caption") {
    if (typeof op.text !== "string" || op.text.trim().length === 0) {
      errors.push("caption requires non-empty text");
    }
  }

  return errors;
};

const validateExample = (example, fileName = "unknown") => {
  const errors = [];

  if (!example || typeof example !== "object") {
    return [`${fileName}: root must be an object`];
  }
  if (typeof example.id !== "string" || example.id.trim().length < 3) {
    errors.push(`${fileName}: id is required`);
  }
  if (typeof example.instruction !== "string" || example.instruction.trim().length < 3) {
    errors.push(`${fileName}: instruction is required`);
  }

  const ops = example?.plan?.operations;
  if (!Array.isArray(ops) || ops.length === 0) {
    errors.push(`${fileName}: plan.operations must be a non-empty array`);
    return errors;
  }

  ops.forEach((op, idx) => {
    const opErrors = validateOperation(op);
    opErrors.forEach((err) => errors.push(`${fileName}: operations[${idx}] ${err}`));
  });

  return errors;
};

module.exports = {
  validateExample,
  ALLOWED_OPS,
  ALLOWED_ANCHORS,
  ALLOWED_EASING
};
