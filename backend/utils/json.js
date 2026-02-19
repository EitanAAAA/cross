const extractFirstJsonObject = (value) => {
  if (typeof value === "object" && value !== null) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error("Model output must be a string");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Model output is empty");
  }

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // fall through to bracket scan
  }

  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found in model output");
  }

  let depth = 0;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      const candidate = trimmed.slice(start, i + 1);
      return JSON.parse(candidate);
    }
  }

  throw new Error("Unterminated JSON object in model output");
};

module.exports = {
  extractFirstJsonObject
};
