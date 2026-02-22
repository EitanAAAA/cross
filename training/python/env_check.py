import argparse
import json
import shutil
import subprocess
import sys
from importlib.util import find_spec
from pathlib import Path


REQUIRED_PYTHON_MAJOR = 3
REQUIRED_PYTHON_MINOR = 11


def run_cmd(args):
    try:
        out = subprocess.check_output(args, stderr=subprocess.STDOUT, text=True)
        return {"ok": True, "output": out.strip()}
    except Exception as exc:
        return {"ok": False, "output": str(exc)}


def check_python():
    version = sys.version_info
    compatible = version.major == REQUIRED_PYTHON_MAJOR and version.minor >= REQUIRED_PYTHON_MINOR
    recommended = version.major == REQUIRED_PYTHON_MAJOR and version.minor == REQUIRED_PYTHON_MINOR
    return {
        "executable": sys.executable,
        "version": f"{version.major}.{version.minor}.{version.micro}",
        "compatible": compatible,
        "recommended": recommended,
        "recommendation": "Install Python 3.11.x for best CUDA/PyTorch compatibility" if not recommended else None
    }


def check_pip():
    result = run_cmd([sys.executable, "-m", "pip", "--version"])
    return {"installed": result["ok"], "details": result["output"]}


def check_nvidia():
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return {
            "installed": False,
            "cuda_visible": False,
            "details": "nvidia-smi not found in PATH"
        }

    result = run_cmd([nvidia_smi, "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"])
    return {
        "installed": result["ok"],
        "cuda_visible": result["ok"],
        "details": result["output"]
    }


def check_packages():
    package_names = [
        "torch",
        "transformers",
        "datasets",
        "peft",
        "trl",
        "accelerate",
        "bitsandbytes"
    ]
    out = {}
    for name in package_names:
        installed = find_spec(name) is not None
        out[name] = installed
    return out


def torch_details():
    if find_spec("torch") is None:
        return {"installed": False}
    try:
        import torch  # type: ignore

        cuda_ok = bool(torch.cuda.is_available())
        return {
            "installed": True,
            "version": getattr(torch, "__version__", "unknown"),
            "cuda_available": cuda_ok,
            "cuda_device_count": int(torch.cuda.device_count()) if cuda_ok else 0
        }
    except Exception as exc:
        return {
            "installed": False,
            "error": str(exc)
        }


def detect_paths():
    root = Path(__file__).resolve().parents[1]
    return {
        "training_root": str(root),
        "sft_dataset": str(root / "datasets" / "sft" / "advanced_edit_sft.jsonl"),
        "train_split": str(root / "datasets" / "splits" / "train.jsonl"),
        "val_split": str(root / "datasets" / "splits" / "val.jsonl"),
        "python_dataset_dir": str(root / "datasets" / "python")
    }


def run():
    parser = argparse.ArgumentParser(description="Check python/cuda training environment")
    parser.add_argument("--json", action="store_true", help="emit machine-readable json")
    args = parser.parse_args()

    payload = {
        "python": check_python(),
        "pip": check_pip(),
        "nvidia": check_nvidia(),
        "packages": check_packages(),
        "torch": torch_details(),
        "paths": detect_paths()
    }

    if args.json:
        print(json.dumps(payload, indent=2))
        return

    print("Python Training Environment Check")
    print("================================")
    print(f"Python: {payload['python']['version']} ({payload['python']['executable']})")
    if payload["python"]["recommendation"]:
        print(f"- Recommendation: {payload['python']['recommendation']}")
    print(f"Pip installed: {payload['pip']['installed']}")
    print(f"NVIDIA/CUDA visible: {payload['nvidia']['cuda_visible']}")
    print("Packages:")
    for name, ok in payload["packages"].items():
        print(f"- {name}: {'yes' if ok else 'no'}")
    if payload["torch"]["installed"]:
        print(f"Torch: {payload['torch'].get('version', 'unknown')}")
        print(f"Torch CUDA available: {payload['torch'].get('cuda_available', False)}")


if __name__ == "__main__":
    run()

