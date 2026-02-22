# Python Training Stack

This folder contains Python-first training utilities for fine-tuning the planner model.

## Why Python

Fine-tuning stacks (PyTorch, TRL, PEFT, bitsandbytes, CUDA) are Python-native and significantly better than Node for ML training.

## Recommended Python

- Python `3.11.x` (strongly recommended for CUDA + PyTorch compatibility).

## Files

- `env_check.py`: checks Python, pip, CUDA/NVIDIA, and optional ML packages.
- `prepare_dataset.py`: converts existing SFT/train/val JSONL into Python trainer-ready files.
- `train_lora.py`: TRL/PEFT LoRA trainer entrypoint (supports dry-run and real train).
- `requirements-cpu.txt`: dependencies for CPU/dev.
- `requirements-cuda.txt`: dependencies for CUDA training.

## Typical flow

1. Check environment:

```powershell
python training/python/env_check.py --json
```

2. Install deps:

```powershell
python -m pip install -r training/python/requirements-cpu.txt
```

CUDA machine:

```powershell
python -m pip install -r training/python/requirements-cuda.txt
```

3. Prepare dataset:

```powershell
python training/python/prepare_dataset.py
```

4. Dry-run training command:

```powershell
python training/python/train_lora.py --dry-run
```

5. Real training:

```powershell
python training/python/train_lora.py ^
  --base-model Qwen/Qwen2.5-Coder-14B-Instruct ^
  --train-file training/datasets/python/train_chat.jsonl ^
  --val-file training/datasets/python/val_chat.jsonl ^
  --output-dir training/models/qwen-planner-lora ^
  --epochs 2 ^
  --batch-size 1 ^
  --grad-accum 16 ^
  --learning-rate 0.0002
```

## Note

After training, quantization/export to Ollama is a separate packaging step.

