# AI Video Editor (Local Ollama + MLT)

TikTok-style local AI video editor:

- Planner model (`qwen2.5-coder:14b`) converts instruction text into strict JSON.
- Vision model (`llama3.2-vision:latest`) optionally analyzes extracted frames and corrects anchors.
- MLT XML generator builds keyframed zoom transitions.
- `melt` renders final MP4 asynchronously.
- Next.js frontend uploads source, sends instruction, tracks progress, and previews result.

## 1) Installation

### Prerequisites

- Node.js 20+
- Ollama installed and running locally
- FFmpeg + ffprobe
- MLT (`melt`) + frei0r plugins

### Linux (Ubuntu)

```bash
sudo apt update
sudo apt install -y mlt melt ffmpeg frei0r-plugins
```

### Windows (recommended via Kdenlive)

This is the easiest Windows path because Kdenlive bundles MLT + melt + FFmpeg + frei0r dependencies.

1. Download and install Kdenlive:
   - https://kdenlive.org/en/download/
2. Locate binaries in:
   - `C:\Program Files\kdenlive\bin`
3. Add this folder to system `Path`:
   - `C:\Program Files\kdenlive\bin`
4. Open a new terminal and verify:
   - `melt -version`
   - `ffmpeg -version`
5. If PATH is not set, use absolute paths in `backend/.env`:
   - `MELT_BIN=C:\Program Files\kdenlive\bin\melt.exe`
   - `FFMPEG_BIN=C:\Program Files\kdenlive\bin\ffmpeg.exe`
   - `FFPROBE_BIN=C:\Program Files\kdenlive\bin\ffprobe.exe`

### Ollama models

```bash
ollama pull qwen2.5-coder:14b
ollama pull llama3.2-vision:latest
```

## 2) Environment Setup

### Backend

```bash
cd backend
cp .env.example .env
```

PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
```

`backend/.env` example:

```env
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
FRONTEND_ORIGIN=http://localhost:3010

OLLAMA_BASE_URL=http://127.0.0.1:11434
PLANNER_MODEL=qwen2.5-coder:14b
VISION_MODEL=llama3.2-vision:latest
OLLAMA_TIMEOUT_MS=120000

MAX_UPLOAD_MB=2048
FFMPEG_BIN=ffmpeg
FFPROBE_BIN=ffprobe
MELT_BIN=melt
```

### Frontend

```bash
cd ../frontend
cp .env.example .env.local
```

PowerShell:

```powershell
cd ..\frontend
Copy-Item .env.example .env.local
```

`frontend/.env.local` example:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

## 3) Run (Local)

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:3010`

## 4) Docker Compose (Optional)

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:3010`
- Backend: `http://localhost:4000`
- Ollama: `http://localhost:11434`

## 5) API Endpoints

### `POST /api/upload`

Form-data field: `video` (large video supported by multer limits).

Response:

```json
{
  "uploadId": "9dc0b234-4f3f-41f5-bfc6-580f37f521f4",
  "fileName": "9dc0b234-4f3f-41f5-bfc6-580f37f521f4.mp4",
  "originalName": "clip.mp4",
  "mimeType": "video/mp4",
  "size": 18273529,
  "fileUrl": "/uploads/9dc0b234-4f3f-41f5-bfc6-580f37f521f4.mp4"
}
```

### `POST /api/edit`

Request:

```json
{
  "uploadId": "9dc0b234-4f3f-41f5-bfc6-580f37f521f4",
  "instruction": "Add smooth zoom transition from 3 to 5 seconds centered",
  "useVision": true
}
```

Response:

```json
{
  "projectId": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc",
  "projectFile": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc.mlt",
  "uploadId": "9dc0b234-4f3f-41f5-bfc6-580f37f521f4",
  "plannerPlan": {
    "transitions": [
      {
        "type": "zoom_in",
        "start": 3,
        "end": 5,
        "anchor": "center",
        "easing": "ease-in-out",
        "strength": 1.2
      }
    ]
  },
  "finalPlan": {
    "transitions": [
      {
        "type": "zoom_in",
        "start": 3,
        "end": 5,
        "anchor": "center",
        "easing": "ease-in-out",
        "strength": 1.2
      }
    ]
  },
  "visionResult": {
    "anchor_corrections": []
  }
}
```

### `POST /api/render`

Request:

```json
{
  "projectId": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc"
}
```

Response:

```json
{
  "jobId": "f4f9db96-4354-4e70-b6d3-cfbf8e8f8f1f",
  "status": "running",
  "progress": 0
}
```

### `GET /api/capabilities`

Returns backend operation support registry and implementation status.

Response:

```json
{
  "operations": [
    { "op": "trim", "status": "implemented", "engines": ["ffmpeg"] },
    { "op": "zoom_in", "status": "implemented", "engines": ["mlt"] },
    { "op": "transition_motion_blur", "status": "planned", "engines": [] }
  ],
  "generatedAt": "2026-02-21T17:47:13.627Z"
}
```

### `GET /api/render/:jobId`

Response while rendering:

```json
{
  "jobId": "f4f9db96-4354-4e70-b6d3-cfbf8e8f8f1f",
  "projectId": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc",
  "status": "running",
  "progress": 42,
  "outputUrl": null
}
```

Response on completion:

```json
{
  "jobId": "f4f9db96-4354-4e70-b6d3-cfbf8e8f8f1f",
  "projectId": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc",
  "status": "completed",
  "progress": 100,
  "outputFileName": "be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc-1739931203313.mp4",
  "outputUrl": "/renders/be0f2d27-bdf0-4f21-a8a6-c61d8bd8f6bc-1739931203313.mp4"
}
```

## 6) Prompt Templates

Planner system prompt and user prompt template are in:

- `backend/services/prompts.js`

Vision prompt template is in:

- `backend/services/vision.js` (`buildVisionPrompt`)

## 7) Project Structure

```text
ai-video-editor/
├── frontend/
│   ├── app/
│   ├── components/
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── backend/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   ├── storage/
│   │   ├── uploads/
│   │   ├── renders/
│   │   └── projects/
│   ├── .env.example
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── docker-compose.yml
```

## 8) Flow Summary

1. Upload video via `/api/upload`.
2. Submit instruction via `/api/edit`.
3. Backend calls Qwen planner through Ollama.
4. Optional frame extraction (`ffmpeg`) + vision correction through llama3.2-vision.
5. Backend stores project manifest (`plan.operations`) and optionally generates MLT XML when zoom transitions exist.
6. Start async render via `/api/render` (adaptive engine: MLT for zoom-only, FFmpeg for advanced ops).
7. Poll `/api/render/:jobId` until completed.
8. Frontend plays rendered MP4 from `/renders/...`.

## 9) Model Training Workspace (Advanced Planner)

A local training workspace is available under `training/`.

Key commands:

```powershell
node training/scripts/validate_annotated.js
node training/scripts/check_coverage.js
node training/scripts/build_sft_dataset.js
node training/scripts/split_dataset.js
```

This prepares instruction-to-plan datasets for fine-tuning a stronger planner model (beyond zoom-only plans).
