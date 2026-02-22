const fs = require("fs");
const path = require("path");
const { validateExample } = require("./lib/validation");

const annotatedDir = path.join(__dirname, "..", "datasets", "annotated");

const files = fs
  .readdirSync(annotatedDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No annotated JSON files found in training/datasets/annotated");
  process.exit(1);
}

const allErrors = [];
let validCount = 0;

for (const file of files) {
  const filePath = path.join(annotatedDir, file);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    const errors = validateExample(parsed, file);
    if (errors.length > 0) {
      allErrors.push(...errors);
      continue;
    }
    validCount += 1;
  } catch (error) {
    allErrors.push(`${file}: ${error.message}`);
  }
}

if (allErrors.length > 0) {
  console.error("Validation failed:\n");
  allErrors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log(`Validation passed. ${validCount} annotated example(s) are valid.`);
