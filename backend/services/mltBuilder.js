const fs = require("fs");
const path = require("path");
const { getVideoMetadata } = require("./video");
const { PROJECTS_DIR } = require("../utils/paths");

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toAnchors = {
  center: { fx: 0.5, fy: 0.5 },
  top: { fx: 0.5, fy: 0 },
  bottom: { fx: 0.5, fy: 1 },
  left: { fx: 0, fy: 0.5 },
  right: { fx: 1, fy: 0.5 },
  "top-left": { fx: 0, fy: 0 },
  "top-right": { fx: 1, fy: 0 },
  "bottom-left": { fx: 0, fy: 1 },
  "bottom-right": { fx: 1, fy: 1 }
};

const buildRect = (scale, anchor) => {
  const { fx, fy } = toAnchors[anchor] || toAnchors.center;
  const x = -((scale - 1) * fx * 100);
  const y = -((scale - 1) * fy * 100);
  const w = scale * 100;
  const h = scale * 100;
  return `${x.toFixed(3)}%/${y.toFixed(3)}%:${w.toFixed(3)}%x${h.toFixed(3)}%`;
};

const transitionScales = (transition) => {
  const strength = Number(transition.strength || 1.2);
  if (transition.type === "zoom_out") {
    return { fromScale: strength, toScale: 1 };
  }
  return { fromScale: 1, toScale: strength };
};

const easingToGeometry = (easing) => {
  if (easing === "linear") return "linear";
  if (easing === "ease-in") return "smooth";
  if (easing === "ease-out") return "decelerate";
  return "smooth";
};

const createZoomFilterXml = ({ transition, fps }) => {
  const startFrame = Math.max(0, Math.round(transition.start * fps));
  const endFrame = Math.max(startFrame + 1, Math.round(transition.end * fps));
  const durationFrames = Math.max(1, endFrame - startFrame);
  const { fromScale, toScale } = transitionScales(transition);
  const rectStart = buildRect(fromScale, transition.anchor);
  const rectEnd = buildRect(toScale, transition.anchor);
  const geometry = `0=${rectStart};${durationFrames}=${rectEnd}`;

  return [
    `  <filter id="zoom_${startFrame}_${endFrame}" in="${startFrame}" out="${endFrame}">`,
    "    <property name=\"mlt_service\">affine</property>",
    `    <property name="transition.rect">${geometry}</property>`,
    `    <property name="transition.easing">${easingToGeometry(transition.easing)}</property>`,
    "    <property name=\"transition.distort\">0</property>",
    "    <property name=\"transition.repeat_off\">1</property>",
    "    <property name=\"transition.mirror_off\">1</property>",
    "    <property name=\"distort\">0</property>",
    "  </filter>"
  ].join("\n");
};

const buildMltXml = async ({ sourcePath, plan }) => {
  const metadata = await getVideoMetadata(sourcePath);
  const fps = metadata.fps || 30;
  const durationFrames = Math.max(1, Math.round(metadata.duration * fps));
  const outFrame = Math.max(0, durationFrames - 1);
  const normalizedSourcePath = path.resolve(sourcePath).replace(/\\/g, "/");

  const filters = plan.transitions.map((transition) => createZoomFilterXml({ transition, fps }));

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<mlt LC_NUMERIC="C" version="7.20.0">',
    `  <profile width="${metadata.width}" height="${metadata.height}" frame_rate_num="${Math.round(fps * 1000)}" frame_rate_den="1000" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${metadata.width}" display_aspect_den="${metadata.height}" colorspace="709"/>`,
    `  <producer id="producer0" in="0" out="${outFrame}">`,
    "    <property name=\"mlt_service\">avformat</property>",
    `    <property name="resource">${escapeXml(normalizedSourcePath)}</property>`,
    ...filters,
    "  </producer>",
    "  <playlist id=\"playlist0\">",
    `    <entry producer="producer0" in="0" out="${outFrame}"/>`,
    "  </playlist>",
    "  <tractor id=\"tractor0\">",
    "    <track producer=\"playlist0\"/>",
    "  </tractor>",
    "</mlt>"
  ].join("\n");
};

const writeMltProject = async ({ projectId, sourcePath, plan }) => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const xml = await buildMltXml({ sourcePath, plan });
  const projectPath = path.join(PROJECTS_DIR, `${projectId}.mlt`);
  fs.writeFileSync(projectPath, xml, "utf8");
  return projectPath;
};

module.exports = {
  buildMltXml,
  writeMltProject
};
