# Export Notes (LoRA -> Inference)

After training:

1. You have adapter/model files in `training/models/qwen-planner-lora`.
2. For Ollama usage, package strategy depends on your tooling:
   - merge adapter into base model, then quantize GGUF
   - or keep adapter flow in a dedicated HF/Transformers runtime
3. Once packaged for Ollama, set backend env:

```env
PLANNER_MODEL=your-tuned-planner:latest
```

