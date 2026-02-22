import argparse
import json
import os
from pathlib import Path


def load_jsonl(path: Path):
    data = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        data.append(json.loads(line))
    return data


def format_chat_example(messages):
    parts = []
    for msg in messages:
        role = msg.get("role", "user").upper()
        content = msg.get("content", "")
        parts.append(f"[{role}] {content}")
    parts.append("[ASSISTANT]")
    return "\n".join(parts)


def ensure_package(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False


def run_dry(args):
    train_data = load_jsonl(Path(args.train_file))
    val_data = load_jsonl(Path(args.val_file))

    print("Dry run: LoRA training plan")
    print("===========================")
    print(f"Base model: {args.base_model}")
    print(f"Train file: {args.train_file} ({len(train_data)} samples)")
    print(f"Val file: {args.val_file} ({len(val_data)} samples)")
    print(f"Output dir: {args.output_dir}")
    print(f"Epochs: {args.epochs}")
    print(f"Batch size: {args.batch_size}")
    print(f"Grad accumulation: {args.grad_accum}")
    print(f"Learning rate: {args.learning_rate}")
    if train_data:
        preview = format_chat_example(train_data[0].get("messages", []))[:500]
        print("Sample formatted prompt preview:")
        print(preview)


def run_train(args):
    required = ["torch", "datasets", "transformers", "peft", "trl", "accelerate"]
    missing = [name for name in required if not ensure_package(name)]
    if missing:
        raise SystemExit(
            "Missing required packages: "
            + ", ".join(missing)
            + ". Install requirements first (requirements-cpu.txt or requirements-cuda.txt)."
        )

    import torch  # type: ignore
    from datasets import Dataset  # type: ignore
    from peft import LoraConfig  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments  # type: ignore
    from trl import SFTTrainer  # type: ignore

    train_records = load_jsonl(Path(args.train_file))
    val_records = load_jsonl(Path(args.val_file))

    if len(train_records) == 0:
        raise SystemExit("Training file has no records.")
    if len(val_records) == 0:
        raise SystemExit("Validation file has no records.")

    train_ds = Dataset.from_list(
        [{"text": format_chat_example(item.get("messages", []))} for item in train_records]
    )
    val_ds = Dataset.from_list(
        [{"text": format_chat_example(item.get("messages", []))} for item in val_records]
    )

    use_cuda = torch.cuda.is_available() and not args.force_cpu
    dtype = torch.bfloat16 if use_cuda and torch.cuda.is_bf16_supported() else torch.float16 if use_cuda else torch.float32

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        torch_dtype=dtype,
        device_map="auto" if use_cuda else None
    )

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM"
    )

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=max(1, args.batch_size),
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_steps=args.eval_steps,
        evaluation_strategy="steps",
        save_strategy="steps",
        bf16=use_cuda and dtype == torch.bfloat16,
        fp16=use_cuda and dtype == torch.float16,
        report_to=[]
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        peft_config=lora_config,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        args=training_args
    )

    trainer.train()
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    metadata = {
        "base_model": args.base_model,
        "output_dir": args.output_dir,
        "train_count": len(train_records),
        "val_count": len(val_records),
        "epochs": args.epochs,
        "learning_rate": args.learning_rate,
        "device": "cuda" if use_cuda else "cpu"
    }
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    (Path(args.output_dir) / "training_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("Training completed")
    print(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Train planner LoRA with TRL")
    parser.add_argument("--base-model", default=os.getenv("TRAIN_BASE_MODEL", "Qwen/Qwen2.5-Coder-14B-Instruct"))
    parser.add_argument("--train-file", default="training/datasets/python/train_chat.jsonl")
    parser.add_argument("--val-file", default="training/datasets/python/val_chat.jsonl")
    parser.add_argument("--output-dir", default="training/models/qwen-planner-lora")
    parser.add_argument("--epochs", type=float, default=2.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--max-seq-length", type=int, default=4096)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--save-steps", type=int, default=100)
    parser.add_argument("--eval-steps", type=int, default=100)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-cpu", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        run_dry(args)
        return

    run_train(args)


if __name__ == "__main__":
    main()

