# Training Workspace (Advanced Edit Planner)

This folder trains the **planner model** (instruction -> edit plan JSON), so the model learns TikTok-style editing choices.

## Important

- Raw videos alone are not enough. You must provide labeled examples.
- Label format: instruction + style tags + structured operation plan.
- Your current renderer mostly supports zoom. This training workspace supports many operation types, so you can expand renderer step by step.

## Quick start

1. Add labeled examples in `datasets/annotated/*.json`.
2. Validate labels:

```powershell
node training/scripts/validate_annotated.js
```

3. Build SFT dataset:

```powershell
node training/scripts/build_sft_dataset.js
```

4. Split train/val:

```powershell
node training/scripts/split_dataset.js
```

5. (Recommended) dataset quality + operation coverage:

```powershell
node training/scripts/check_coverage.js
node training/scripts/report_quality.js
```

6. Auto-generate annotation labels from raw videos (Ollama planner + fallback rules):

```powershell
node training/scripts/bootstrap_annotations.js
```

7. Python training stack (recommended for fine-tuning):

```powershell
python training/python/env_check.py --json
python -m pip install -r training/python/requirements-cpu.txt
python training/python/prepare_dataset.py
python training/python/train_lora.py --dry-run
```

5. Fine-tune externally (Axolotl/Unsloth/TRL), then serve with Ollama.

## Suggested dataset size

- Good first result: 300-1000 examples.
- Strong result: 3000+ high-quality examples across different content types.

## Operations covered in this schema

- trim
- cut
- zoom_in
- zoom_out
- pan
- rotate
- speed_ramp
- freeze_frame
- blur
- color_grade
- caption
- beat_sync
- transition

## Web dashboard (port 3011)

A local dashboard is available at `training/lab`.

Start:

```powershell
cd training/lab
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3011` and use ZIP import + pipeline buttons with live logs.
