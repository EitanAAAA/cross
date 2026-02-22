const fs = require("fs");
const path = require("path");
const { validateExample } = require("./lib/validation");

const annotatedDir = path.join(__dirname, "..", "datasets", "annotated");

const files = fs
  .readdirSync(annotatedDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No annotated files found.");
  process.exit(1);
}

const opCounts = new Map();
const styleCounts = new Map();
let totalInstructionChars = 0;
let totalOperations = 0;
let validExamples = 0;
const errors = [];

for (const file of files) {
  try {
    const raw = fs.readFileSync(path.join(annotatedDir, file), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const validationErrors = validateExample(parsed, file);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }

    validExamples += 1;
    totalInstructionChars += parsed.instruction.length;

    for (const op of parsed.plan.operations) {
      opCounts.set(op.op, (opCounts.get(op.op) || 0) + 1);
      totalOperations += 1;
    }

    for (const tag of parsed.style_tags || []) {
      styleCounts.set(tag, (styleCounts.get(tag) || 0) + 1);
    }
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error("Quality report failed due to validation errors:\n");
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

const avgInstructionChars = validExamples > 0 ? totalInstructionChars / validExamples : 0;
const avgOperationsPerExample = validExamples > 0 ? totalOperations / validExamples : 0;

console.log("Dataset Quality Report");
console.log("======================");
console.log(`Examples: ${validExamples}`);
console.log(`Average instruction chars: ${avgInstructionChars.toFixed(1)}`);
console.log(`Average operations per example: ${avgOperationsPerExample.toFixed(2)}`);
console.log("");
console.log("Operations:");
[...opCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([op, count]) => console.log(`- ${op}: ${count}`));
console.log("");
console.log("Style tags:");
if (styleCounts.size === 0) {
  console.log("- (none)");
} else {
  [...styleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([tag, count]) => console.log(`- ${tag}: ${count}`));
}

