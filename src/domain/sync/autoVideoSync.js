import { createWorker } from "tesseract.js";

let workerPromise = null;
const REGION_PRESETS = [
  { x: 0.24, y: 0.42, width: 0.52, height: 0.22 },
  { x: 0.28, y: 0.45, width: 0.44, height: 0.16 },
  { x: 0.22, y: 0.46, width: 0.56, height: 0.18 },
  { x: 0.3, y: 0.48, width: 0.4, height: 0.14 },
  { x: 0.26, y: 0.5, width: 0.48, height: 0.12 },
];
const templateCache = new Map();
const NORMALIZED_WIDTH = 320;
const NORMALIZED_HEIGHT = 120;
const MIN_LIT_PIXELS = 40;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener("error", onError);
    };

    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function createAnalysisVideo(url) {
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  await waitForEvent(video, "loadedmetadata");
  return video;
}

async function seekVideo(video, timeSeconds) {
  const clamped = Math.max(0, Math.min(timeSeconds, Math.max(video.duration - 0.05, 0)));
  if (Math.abs(video.currentTime - clamped) < 0.01) {
    return;
  }
  video.currentTime = clamped;
  await waitForEvent(video, "seeked");
}

function preprocessRegion(video, preset) {
  const cropWidth = Math.floor(video.videoWidth * preset.width);
  const cropHeight = Math.floor(video.videoHeight * preset.height);
  const sx = Math.floor(video.videoWidth * preset.x);
  const sy = Math.floor(video.videoHeight * preset.y);

  const canvas = document.createElement("canvas");
  canvas.width = cropWidth * 2;
  canvas.height = cropHeight * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  context.drawImage(
    video,
    sx,
    sy,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const thresholded = value > 155 ? 255 : 0;
    data[index] = thresholded;
    data[index + 1] = thresholded;
    data[index + 2] = thresholded;
    data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

function cropToLitBounds(canvas, paddingRatio = 0.18) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let litPixels = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      if (data[index] > 127) {
        litPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (litPixels < MIN_LIT_PIXELS || maxX < minX || maxY < minY) {
    return null;
  }

  const paddingX = Math.max(4, Math.floor((maxX - minX + 1) * paddingRatio));
  const paddingY = Math.max(4, Math.floor((maxY - minY + 1) * paddingRatio));
  const sx = Math.max(0, minX - paddingX);
  const sy = Math.max(0, minY - paddingY);
  const sw = Math.min(canvas.width - sx, maxX - minX + 1 + paddingX * 2);
  const sh = Math.min(canvas.height - sy, maxY - minY + 1 + paddingY * 2);

  const cropped = document.createElement("canvas");
  cropped.width = sw;
  cropped.height = sh;
  cropped
    .getContext("2d", { willReadFrequently: true })
    .drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return cropped;
}

function normalizeCanvas(canvas, width = NORMALIZED_WIDTH, height = NORMALIZED_HEIGHT) {
  const normalized = document.createElement("canvas");
  normalized.width = width;
  normalized.height = height;
  const context = normalized.getContext("2d", { willReadFrequently: true });

  context.fillStyle = "black";
  context.fillRect(0, 0, width, height);

  const scale = Math.min(width / canvas.width, height / canvas.height);
  const drawWidth = Math.max(1, Math.round(canvas.width * scale));
  const drawHeight = Math.max(1, Math.round(canvas.height * scale));
  const dx = Math.round((width - drawWidth) / 2);
  const dy = Math.round((height - drawHeight) / 2);

  context.imageSmoothingEnabled = false;
  context.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx, dy, drawWidth, drawHeight);

  return normalized;
}

function getTemplates(width, height) {
  const key = `${width}x${height}`;
  if (templateCache.has(key)) {
    return templateCache.get(key);
  }

  const templates = [56, 64, 72, 80].map((fontSize) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    context.fillStyle = "black";
    context.fillRect(0, 0, width, height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = Math.max(4, Math.round(fontSize / 9));
    context.strokeStyle = "black";
    context.fillStyle = "white";
    context.font = `700 ${fontSize}px Arial Black, Impact, sans-serif`;
    context.strokeText("ARMED", width / 2, height / 2 + fontSize * 0.02);
    context.fillText("ARMED", width / 2, height / 2 + fontSize * 0.02);

    const image = context.getImageData(0, 0, width, height);
    const { data } = image;
    for (let index = 0; index < data.length; index += 4) {
      const lit = data[index] > 200 ? 255 : 0;
      data[index] = lit;
      data[index + 1] = lit;
      data[index + 2] = lit;
      data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    return canvas;
  });

  templateCache.set(key, templates);
  return templates;
}

function scoreTemplate(frameCanvas, templateCanvas) {
  const frame = frameCanvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, frameCanvas.width, frameCanvas.height).data;
  const template = templateCanvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, templateCanvas.width, templateCanvas.height).data;

  let overlap = 0;
  let frameLit = 0;
  let templateLit = 0;

  for (let index = 0; index < frame.length; index += 4) {
    const frameOn = frame[index] > 127;
    const templateOn = template[index] > 127;
    if (frameOn) frameLit++;
    if (templateOn) templateLit++;
    if (frameOn && templateOn) overlap++;
  }

  if (!frameLit || !templateLit) {
    return 0;
  }

  const precision = overlap / frameLit;
  const recall = overlap / templateLit;
  return (precision + recall) * 50;
}

function detectByTemplate(video) {
  let best = { score: -Infinity };

  for (const preset of REGION_PRESETS) {
    const processed = preprocessRegion(video, preset);
    const cropped = cropToLitBounds(processed);
    if (!cropped) {
      continue;
    }

    const canvas = normalizeCanvas(cropped);
    const templates = getTemplates(canvas.width, canvas.height);

    for (const template of templates) {
      const score = scoreTemplate(canvas, template);
      if (score > best.score) {
        best = { score, canvas, preset };
      }
    }
  }

  return best;
}

function scoreRecognizedText(text, confidence) {
  const normalized = text.replace(/[^A-Z]/gi, "").toUpperCase();
  if (!normalized) {
    return 0;
  }

  if (normalized.includes("ARMED")) {
    return confidence + 100;
  }

  let score = confidence;
  for (const token of ["ARMED", "ARM", "MED"]) {
    if (normalized.includes(token)) {
      score += 20;
    }
  }
  return score;
}

async function recognizeArmed(canvas) {
  const worker = await getWorker();
  const result = await worker.recognize(canvas, {
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "ARMED",
  });
  const text = result?.data?.text ?? "";
  const confidence = result?.data?.confidence ?? 0;
  return {
    text,
    confidence,
    score: scoreRecognizedText(text, confidence),
  };
}

export async function detectArmedOverlayTime(videoUrl, options = {}) {
  const maxScanSeconds = options.maxScanSeconds ?? 10;
  const coarseStep = options.coarseStepSeconds ?? 0.25;
  const refineStep = options.refineStepSeconds ?? 0.05;

  const video = await createAnalysisVideo(videoUrl);
  const scanEnd = Math.min(maxScanSeconds, Math.max(video.duration, 0));

  let best = {
    timeSeconds: null,
    confidence: 0,
    score: -Infinity,
    text: "",
  };

  for (let timeSeconds = 0; timeSeconds <= scanEnd; timeSeconds += coarseStep) {
    await seekVideo(video, timeSeconds);
    const templateResult = detectByTemplate(video);
    if (!templateResult.canvas) {
      continue;
    }
    let result = {
      text: "",
      confidence: Math.max(0, templateResult.score - 40),
      score: templateResult.score,
    };

    if (templateResult.score < 70) {
      const ocrResult = await recognizeArmed(templateResult.canvas);
      result = {
        text: ocrResult.text,
        confidence: Math.max(ocrResult.confidence, result.confidence),
        score: Math.max(result.score, ocrResult.score),
      };
    }

    if (result.score > best.score) {
      best = {
        timeSeconds,
        confidence: result.confidence,
        score: result.score,
        text: result.text,
      };
    }
  }

  if (best.timeSeconds === null) {
    return null;
  }

  const refineStart = Math.max(0, best.timeSeconds - coarseStep);
  const refineEnd = Math.min(scanEnd, best.timeSeconds + coarseStep);

  for (let timeSeconds = refineStart; timeSeconds <= refineEnd; timeSeconds += refineStep) {
    await seekVideo(video, timeSeconds);
    const templateResult = detectByTemplate(video);
    if (!templateResult.canvas) {
      continue;
    }
    let result = {
      text: "",
      confidence: Math.max(0, templateResult.score - 40),
      score: templateResult.score,
    };

    if (templateResult.score < 78) {
      const ocrResult = await recognizeArmed(templateResult.canvas);
      result = {
        text: ocrResult.text,
        confidence: Math.max(ocrResult.confidence, result.confidence),
        score: Math.max(result.score, ocrResult.score),
      };
    }

    if (result.score > best.score) {
      best = {
        timeSeconds,
        confidence: result.confidence,
        score: result.score,
        text: result.text,
      };
    }
  }

  if (best.score < 35) {
    return null;
  }

  return best;
}

export function calculateAutoVideoOffset(
  logArmTimeUs,
  videoArmTimeSeconds,
  logStartTimeUs = 0
) {
  const armElapsedSeconds = Math.max(0, logArmTimeUs - logStartTimeUs) / 1000000;
  return videoArmTimeSeconds - armElapsedSeconds;
}
