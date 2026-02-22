"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TimelinePreview from "./TimelinePreview";

const defaultInstruction = "Add smooth zoom transition from 3 to 5 seconds centered";

const backendBase = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STEP_TEMPLATE = [
  { id: "request", label: "Request validation" },
  { id: "upload", label: "Upload source video" },
  { id: "planner", label: "Qwen planning" },
  { id: "vision", label: "Vision anchor analysis" },
  { id: "manifest", label: "Project manifest generation" },
  { id: "mlt", label: "MLT project generation" },
  { id: "render_queue", label: "Render queue" },
  { id: "render", label: "Render MP4" }
];

const createInitialSteps = () =>
  STEP_TEMPLATE.map((step) => ({
    ...step,
    status: "pending",
    detail: "",
    at: ""
  }));

const formatApiError = (body, fallback) => {
  if (!body || typeof body !== "object") return fallback;
  if (Array.isArray(body.details) && body.details.length > 0) {
    const detailText = body.details
      .map((issue) => `${issue.path?.join(".") || "field"}: ${issue.message}`)
      .join(" | ");
    return `${body.error || fallback} (${detailText})`;
  }
  return body.error || fallback;
};

export default function EditorStudio() {
  const [videoFile, setVideoFile] = useState(null);
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [useVision, setUseVision] = useState(true);
  const [uploadResponse, setUploadResponse] = useState(null);
  const [editResponse, setEditResponse] = useState(null);
  const [renderJob, setRenderJob] = useState(null);
  const [status, setStatus] = useState("idle");
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineSteps, setPipelineSteps] = useState(createInitialSteps);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const isMountedRef = useRef(true);
  const lastRenderProgressRef = useRef(-1);

  const uploadPreviewUrl = useMemo(() => {
    if (!videoFile) return "";
    return URL.createObjectURL(videoFile);
  }, [videoFile]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    },
    [uploadPreviewUrl]
  );

  const pushLog = (message) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${message}`, ...prev].slice(0, 20));
  };

  const markStep = (stepId, nextStatus, detail = "") => {
    setPipelineSteps((prev) =>
      prev.map((step) =>
        step.id === stepId
          ? {
              ...step,
              status: nextStatus,
              detail,
              at: new Date().toLocaleTimeString()
            }
          : step
      )
    );
  };

  const resetPipeline = () => {
    setPipelineSteps(createInitialSteps());
    setPipelineProgress(0);
  };

  const applyProcessingTrace = (trace) => {
    if (!Array.isArray(trace)) return;
    const mapStepId = {
      request_validation: "request",
      upload_lookup: "upload",
      planner_call: "planner",
      vision_analysis: "vision",
      project_manifest_generation: "manifest",
      mlt_project_generation: "mlt"
    };

    for (const entry of trace) {
      const uiStepId = mapStepId[entry.step];
      if (!uiStepId) continue;
      markStep(uiStepId, entry.status, entry.details ? JSON.stringify(entry.details) : "");
      pushLog(`[${entry.step}] ${entry.status}`);
    }
  };

  const readJsonBody = async (response) => {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  };

  const uploadVideo = async () => {
    if (!videoFile) {
      throw new Error("Select a video file first.");
    }

    setStatus("uploading");
    markStep("upload", "running");
    setPipelineProgress(8);
    pushLog("Uploading source video...");

    const formData = new FormData();
    formData.append("video", videoFile);

    const response = await fetch(`${backendBase}/api/upload`, {
      method: "POST",
      body: formData
    });

    const body = await readJsonBody(response);
    if (!response.ok) {
      markStep("upload", "failed");
      throw new Error(formatApiError(body, "Upload failed."));
    }

    setUploadResponse(body);
    markStep("upload", "completed", `uploadId=${body.uploadId}`);
    setPipelineProgress(22);
    pushLog(`Upload complete: ${body.uploadId}`);
    return body;
  };

  const requestEditPlan = async (uploadId) => {
    setStatus("planning");
    markStep("request", "running");
    markStep("planner", "pending");
    markStep("manifest", "pending");
    if (useVision) {
      markStep("vision", "pending");
    } else {
      markStep("vision", "skipped", "disabled_by_user");
    }
    markStep("mlt", "pending");
    setPipelineProgress(30);
    pushLog("Requesting planner JSON from qwen2.5-coder:14b...");

    const response = await fetch(`${backendBase}/api/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        instruction,
        useVision
      })
    });

    const body = await readJsonBody(response);
    applyProcessingTrace(body?.processingTrace);

    if (!response.ok) {
      markStep("planner", "failed");
      throw new Error(formatApiError(body, "Edit planning failed."));
    }

    setEditResponse(body);
    markStep("request", "completed");
    markStep(
      "planner",
      "completed",
      `ops=${body?.plannerPlan?.operations?.length || 0}, transitions=${body?.plannerPlan?.transitions?.length || 0}`
    );
    markStep("manifest", "completed", body?.capabilitySummary?.recommendedRenderEngine || "auto");
    if (useVision && body?.visionResult) {
      markStep(
        "vision",
        "completed",
        `corrections=${body.visionResult?.anchor_corrections?.length || 0}`
      );
    }
    markStep("mlt", "completed", `projectId=${body.projectId}`);
    setPipelineProgress(66);
    pushLog(`MLT project generated: ${body.projectId}`);
    return body;
  };

  const startRender = async (projectId) => {
    setStatus("rendering");
    markStep("render_queue", "running");
    markStep("render", "pending");
    lastRenderProgressRef.current = -1;
    setPipelineProgress(72);
    pushLog("Starting adaptive render (MLT/FFmpeg)...");

    const response = await fetch(`${backendBase}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });

    const body = await readJsonBody(response);
    if (!response.ok) {
      markStep("render_queue", "failed");
      throw new Error(formatApiError(body, "Render start failed."));
    }
    markStep("render_queue", "completed", `jobId=${body.jobId}`);
    markStep("render", "running");
    setPipelineProgress(76);
    pushLog(`Render job started: ${body.jobId}`);
    return body;
  };

  const pollRenderJob = async (jobId) => {
    while (isMountedRef.current) {
      const response = await fetch(`${backendBase}/api/render/${jobId}`);
      const body = await readJsonBody(response);

      if (!response.ok) {
        markStep("render", "failed");
        throw new Error(formatApiError(body, "Failed to poll render status."));
      }

      setRenderJob(body);
      const progressInt = Math.round(Number(body.progress || 0));
      setPipelineProgress(Math.max(76, 76 + (progressInt * 0.24)));
      const previous = lastRenderProgressRef.current;
      if (progressInt !== previous && (progressInt === 0 || progressInt === 100 || progressInt >= previous + 5)) {
        pushLog(`Render progress: ${progressInt}%`);
        lastRenderProgressRef.current = progressInt;
      }
      if (body.status === "completed") {
        setStatus("completed");
        markStep("render", "completed", body.outputFileName);
        setPipelineProgress(100);
        pushLog(`Render complete: ${body.outputFileName}`);
        return body;
      }
      if (body.status === "failed") {
        setStatus("failed");
        markStep("render", "failed", body.error || "render_failed");
        throw new Error(body.error || "Render failed.");
      }
      await sleep(1500);
    }
    return null;
  };

  const runPipeline = async () => {
    try {
      setError("");
      setEditResponse(null);
      setRenderJob(null);
      resetPipeline();

      const upload = await uploadVideo();
      const edit = await requestEditPlan(upload.uploadId);
      const renderStart = await startRender(edit.projectId);
      await pollRenderJob(renderStart.jobId);
    } catch (err) {
      setStatus("error");
      setPipelineSteps((prev) => {
        const running = prev.find((step) => step.status === "running");
        if (!running) return prev;
        return prev.map((step) =>
          step.id === running.id
            ? { ...step, status: "failed", at: new Date().toLocaleTimeString() }
            : step
        );
      });
      setError(err.message || "Unknown error");
      pushLog(`Error: ${err.message}`);
    }
  };

  const isBusy = status === "uploading" || status === "planning" || status === "rendering";

  return (
    <main className="page-shell">
      <section className="card hero">
        <h1>Local AI Video Editor</h1>
        <p>
          Ollama planner + vision analysis + MLT rendering. Everything runs on your machine with no cloud
          dependency.
        </p>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Input</h2>
          <label className="field">
            <span>Video file</span>
            <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
          </label>

          <label className="field">
            <span>Edit instruction</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={defaultInstruction}
            />
          </label>

          <label className="toggle">
            <input type="checkbox" checked={useVision} onChange={(e) => setUseVision(e.target.checked)} />
            <span>Use llama3.2-vision for anchor correction</span>
          </label>

          <button
            className={`run-btn ${isBusy ? "processing" : ""}`}
            onClick={runPipeline}
            disabled={isBusy || !videoFile || !instruction.trim()}
          >
            {isBusy ? (
              <>
                <span className="spinner" /> Processing...
              </>
            ) : (
              "Render Video"
            )}
          </button>
        </div>

        <div className="card">
          <h2>Pipeline Status</h2>
          <div className="status-row">
            <strong>State:</strong> <span>{status}</span>
          </div>
          <div className="status-row">
            <strong>Progress:</strong> <span>{Math.round(pipelineProgress)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, pipelineProgress))}%` }} />
          </div>
          <h3>AI Processing Steps</h3>
          <div className="steps">
            {pipelineSteps.map((step) => (
              <div key={step.id} className="step-row">
                <span className={`step-pill ${step.status}`}>{step.status}</span>
                <span className="step-name">{step.label}</span>
                <span className="step-time">{step.at || "-"}</span>
                {step.detail ? <span className="step-detail">{step.detail}</span> : null}
              </div>
            ))}
          </div>
          {error ? <p className="error">{error}</p> : null}

          <h3>Recent Logs</h3>
          <pre className="log-box">{logs.length ? logs.join("\n") : "No logs yet."}</pre>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Source Preview</h2>
          {uploadPreviewUrl ? (
            <video src={uploadPreviewUrl} controls className="video" />
          ) : (
            <p className="muted">Choose a file to preview source video.</p>
          )}
        </div>

        <div className="card">
          <h2>Rendered Output</h2>
          {renderJob?.status === "completed" && renderJob.outputUrl ? (
            <video src={`${backendBase}${renderJob.outputUrl}`} controls className="video" />
          ) : (
            <p className="muted">Output video appears here when render completes.</p>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Planner JSON</h2>
          {editResponse?.capabilitySummary ? (
            <p className="muted">
              Render recommendation: {editResponse.capabilitySummary.recommendedRenderEngine} | Unsupported ops:{" "}
              {editResponse.capabilitySummary.unsupportedOperations?.length || 0}
            </p>
          ) : null}
          <pre className="json-box">
            {editResponse ? JSON.stringify(editResponse.finalPlan, null, 2) : "No plan yet."}
          </pre>
          <h3>Timeline</h3>
          <TimelinePreview transitions={editResponse?.finalPlan?.transitions || []} />
        </div>

        <div className="card">
          <h2>Vision JSON</h2>
          <pre className="json-box">
            {editResponse?.visionResult ? JSON.stringify(editResponse.visionResult, null, 2) : "Vision not used yet."}
          </pre>
        </div>
      </section>
    </main>
  );
}
