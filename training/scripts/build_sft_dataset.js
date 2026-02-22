const fs = require("fs");
const path = require("path");
const { validateExample } = require("./lib/validation");

const root = path.join(__dirname, "..");
const annotatedDir = path.join(root, "datasets", "annotated");
const outPath = path.join(root, "datasets", "sft", "advanced_edit_sft.jsonl");
const systemPromptPath = path.join(root, "prompts", "system_advanced_planner.txt");

const systemPrompt = fs.readFileSync(systemPromptPath, "utf8").trim();

const files = fs
  .readdirSync(annotatedDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No annotated JSON files found in training/datasets/annotated");
  process.exit(1);
}

const lines = [];
const errors = [];

for (const file of files) {
  const fullPath = path.join(annotatedDir, file);
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
    const validationErrors = validateExample(parsed, file);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }

    const record = {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            `Instruction: ${parsed.instruction}`,
            `Style tags: ${(parsed.style_tags || []).join(", ") || "none"}`,
            "Return strict JSON only."
          ].join("\n")
        },
        {
          role: "assistant",
          content: JSON.stringify(parsed.plan)
        }
      ],
      metadata: {
        id: parsed.id,
        source_file: file,
        style_tags: parsed.style_tags || []
      }
    };

    lines.push(JSON.stringify(record));
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error("Dataset build failed:\n");
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} examples to ${outPath}`);
