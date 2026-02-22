const fs = require("fs");
const path = require("path");
const { ALLOWED_OPS, validateExample } = require("./lib/validation");

const annotatedDir = path.join(__dirname, "..", "datasets", "annotated");
const files = fs
  .readdirSync(annotatedDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No annotated files found.");
  process.exit(1);
}

const counts = new Map();
for (const op of ALLOWED_OPS) counts.set(op, 0);

const errors = [];
for (const file of files) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(annotatedDir, file), "utf8").replace(/^\uFEFF/, ""));
    const validationErrors = validateExample(parsed, file);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }

    for (const op of parsed.plan.operations) {
      counts.set(op.op, (counts.get(op.op) || 0) + 1);
    }
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error("Coverage check failed because validation failed:\n");
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

console.log("Operation coverage:");
for (const [op, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${op.padEnd(12)} ${count}`);
}

const missing = [...counts.entries()].filter(([, count]) => count === 0).map(([op]) => op);
if (missing.length > 0) {
  console.error(`\nMissing operations in dataset: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("\nCoverage is complete. All operation types are present.");