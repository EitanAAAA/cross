import argparse
import json
from pathlib import Path


def read_jsonl(path: Path):
    if not path.exists():
        return []
    lines = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lines.append(json.loads(line))
    return lines


def write_jsonl(path: Path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(json.dumps(item, ensure_ascii=False) for item in records) + "\n"
    path.write_text(content, encoding="utf-8")


def normalize_record(record):
    messages = record.get("messages", [])
    if not isinstance(messages, list):
        raise ValueError("record.messages must be a list")
    return {
        "messages": messages,
        "metadata": record.get("metadata", {})
    }


def main():
    parser = argparse.ArgumentParser(description="Prepare trainer-ready chat datasets")
    parser.add_argument("--train-file", default="training/datasets/splits/train.jsonl")
    parser.add_argument("--val-file", default="training/datasets/splits/val.jsonl")
    parser.add_argument("--output-dir", default="training/datasets/python")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]
    train_path = project_root / args.train_file
    val_path = project_root / args.val_file
    out_dir = project_root / args.output_dir

    train = [normalize_record(item) for item in read_jsonl(train_path)]
    val = [normalize_record(item) for item in read_jsonl(val_path)]

    if len(train) == 0:
        raise SystemExit(f"Train split is empty or missing: {train_path}")
    if len(val) == 0:
        raise SystemExit(f"Val split is empty or missing: {val_path}")

    train_out = out_dir / "train_chat.jsonl"
    val_out = out_dir / "val_chat.jsonl"

    write_jsonl(train_out, train)
    write_jsonl(val_out, val)

    manifest = {
        "train_file": str(train_out),
        "val_file": str(val_out),
        "train_count": len(train),
        "val_count": len(val)
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print("Prepared python training dataset")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

