const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputPath = path.join(root, "datasets", "sft", "advanced_edit_sft.jsonl");
const splitDir = path.join(root, "datasets", "splits");
const trainPath = path.join(splitDir, "train.jsonl");
const valPath = path.join(splitDir, "val.jsonl");

const valRatio = Math.min(0.5, Math.max(0.01, Number(process.env.VAL_RATIO || 0.1)));
const seed = Number(process.env.SPLIT_SEED || 42);

const seededRandom = (() => {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
})();

if (!fs.existsSync(inputPath)) {
  console.error(`Input dataset not found: ${inputPath}`);
  console.error("Run: node training/scripts/build_sft_dataset.js");
  process.exit(1);
}

const lines = fs
  .readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (lines.length < 2) {
  console.error("Need at least 2 examples to split dataset.");
  process.exit(1);
}

const shuffled = [...lines];
for (let i = shuffled.length - 1; i > 0; i -= 1) {
  const j = Math.floor(seededRandom() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

const valCount = Math.max(1, Math.round(shuffled.length * valRatio));
const val = shuffled.slice(0, valCount);
const train = shuffled.slice(valCount);

fs.mkdirSync(splitDir, { recursive: true });
fs.writeFileSync(trainPath, `${train.join("\n")}\n`, "utf8");
fs.writeFileSync(valPath, `${val.join("\n")}\n`, "utf8");

console.log(`Split complete. train=${train.length}, val=${val.length}`);
console.log(`Train file: ${trainPath}`);
console.log(`Val file: ${valPath}`);
