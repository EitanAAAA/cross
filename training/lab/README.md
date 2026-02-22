# Training Lab (Port 3011)

Local dashboard for managing planner training datasets.

## Start

```powershell
cd training/lab
npm.cmd install
npm.cmd run dev
```

Open:

- `http://localhost:3011`

## What it does

- Upload a ZIP via UI (`datasetZip`).
- Extracts files into `training/lab/imports/<id>/`.
- Copies valid annotation JSON files into `training/datasets/annotated/`.
- Copies video files into `training/datasets/raw/import-<id>/`.
- Provides one-click actions with logs:
  - `Validate`
  - `Quality Report`
  - `Auto Label Videos`
  - `Coverage`
  - `Build SFT`
  - `Split`
  - `Run All`
  - `Python Check`
  - `Install CPU Deps`
  - `Install CUDA Deps`
  - `Prepare Py Dataset`
  - `Dry Run Train`
  - `Start Train`

### Button behavior

- `Upload ZIP`: imports videos and/or annotation JSON from a zip package.
- `Validate`: checks annotation structure and required fields.
- `Quality Report`: prints dataset quality metrics and operation/style distributions.
- `Auto Label Videos`: creates/updates annotation JSON from videos in `training/datasets/raw` using Ollama planner + duration-aware fallback rules.
- `Coverage`: verifies operation coverage across the dataset.
- `Build SFT`: creates `training/datasets/sft/advanced_edit_sft.jsonl`.
- `Split`: creates train/val JSONL files in `training/datasets/splits`.
- `Run All`: runs `validate -> coverage -> build -> split -> quality`.
- `Run Recommended Pipeline` (UI shortcut): runs `auto label -> validate -> coverage -> build -> split -> py-prepare -> py-train-dry`.
- `Python Check`: runs `training/python/env_check.py --json`.
- `Install CPU Deps`: installs `training/python/requirements-cpu.txt`.
- `Install CUDA Deps`: installs `training/python/requirements-cuda.txt`.
- `Prepare Py Dataset`: runs `training/python/prepare_dataset.py`.
- `Dry Run Train`: prints training plan using `training/python/train_lora.py --dry-run`.
- `Start Train`: starts TRL/PEFT LoRA train via `training/python/train_lora.py`.
- `Download Schema`: downloads the target planning schema.
- `Download Prompt`: downloads current planner system prompt.
- `Download Template`: downloads an annotation template JSON.
- `Export Training Bundle`: downloads a zip of annotated data + sft + splits + schema + prompt.

## API endpoints

- `GET /api/health`
- `GET /api/stats`
- `GET /api/logs`
- `GET /api/log-stream` (SSE)
- `GET /api/model-status`
- `GET /api/python-status`
- `POST /api/upload-zip`
- `POST /api/pipeline/:action` where action is `validate|quality|bootstrap|coverage|build|split|run-all|py-check|py-install-cpu|py-install-cuda|py-prepare|py-train-dry|py-train`
- `GET /api/download/schema`
- `GET /api/download/prompt`
- `GET /api/download/template`
- `GET /api/export/training-bundle`

## Model roles

- Planner model (`qwen2.5-coder:14b` or your tuned replacement): this is the model you train with labeled edit examples.
- Vision model (`llama3.2-vision:latest`): used for frame-level perception in runtime, not the main style-learning planner target.

## Critical note

Raw edited videos alone do not fully train the planner. For strong learning, each example needs structured labels in JSON (`instruction` + `plan.operations`).
