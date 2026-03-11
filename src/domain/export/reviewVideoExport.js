const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed while waiting for ${eventName}.`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onReady);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

async function loadVideo(url) {
  const video = document.createElement("video");
  video.src = url;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  video.volume = 0;

  if (video.readyState >= 1) {
    return video;
  }

  await waitForEvent(video, "loadedmetadata");
  return video;
}

export function getSupportedReviewExportMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

export function getReviewVideoExportSupport() {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof HTMLCanvasElement === "undefined"
  ) {
    return {
      supported: false,
      reason: "Export is only available in a browser environment.",
      mimeType: null,
    };
  }

  if (typeof MediaRecorder === "undefined") {
    return {
      supported: false,
      reason: "This browser does not support MediaRecorder.",
      mimeType: null,
    };
  }

  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") {
    return {
      supported: false,
      reason: "This browser cannot capture a canvas stream for export.",
      mimeType: null,
    };
  }

  const mimeType = getSupportedReviewExportMimeType();
  if (!mimeType) {
    return {
      supported: false,
      reason: "This browser does not support WebM recording for review export.",
      mimeType: null,
    };
  }

  return {
    supported: true,
    reason: null,
    mimeType,
  };
}

function normalizeOptions(options) {
  const fps = options.fps ?? 30;
  return {
    width: options.width,
    height: options.height,
    fps,
    startUs: options.startUs ?? options.flight.minTimeUs,
    endUs: options.endUs ?? options.flight.maxTimeUs,
    includeAudio: options.includeAudio !== false,
  };
}

function createRecorder(stream, mimeType) {
  return new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 10_000_000,
  });
}

export function createReviewVideoExporter(options) {
  const support = getReviewVideoExportSupport();
  const normalized = normalizeOptions(options);
  let cancelled = false;
  let recording = false;
  let activeUrl = null;
  let recorder = null;
  let sourceVideo = null;
  let rafId = 0;
  let frameCallbackId = 0;

  const cleanup = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (sourceVideo) {
      sourceVideo.pause();
      sourceVideo.src = "";
      sourceVideo.load();
      sourceVideo = null;
    }
    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  };

  return {
    async start() {
      if (!support.supported) {
        throw new Error(support.reason);
      }

      const warnings = [];
      const mimeType = support.mimeType;
      const canvas = document.createElement("canvas");
      sourceVideo = await loadVideo(options.video.url ?? options.video);
      canvas.width = normalized.width ?? sourceVideo.videoWidth ?? 1280;
      canvas.height = normalized.height ?? sourceVideo.videoHeight ?? 720;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not create a 2D canvas context for export.");
      }

      const stream = canvas.captureStream(normalized.fps);
      const startVideoSeconds =
        (normalized.startUs - options.flight.minTimeUs) / 1000000 + options.syncOffsetSeconds;
      const endVideoSeconds =
        (normalized.endUs - options.flight.minTimeUs) / 1000000 + options.syncOffsetSeconds;

      let hadAudio = false;
      if (
        normalized.includeAudio &&
        typeof sourceVideo.captureStream === "function" &&
        startVideoSeconds >= 0 &&
        endVideoSeconds <= sourceVideo.duration
      ) {
        try {
          const audioStream = sourceVideo.captureStream();
          const audioTrack = audioStream.getAudioTracks()[0];
          if (audioTrack) {
            stream.addTrack(audioTrack);
            hadAudio = true;
          } else {
            warnings.push("Audio track was unavailable. Exported silently.");
          }
        } catch {
          warnings.push("Audio capture failed. Exported silently.");
        }
      } else if (normalized.includeAudio) {
        warnings.push("Audio was skipped because the synced video range could not be captured safely.");
      }

      recorder = createRecorder(stream, mimeType);
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size) {
          chunks.push(event.data);
        }
      });

      const stopPromise = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", () => reject(new Error("MediaRecorder failed during export.")), {
          once: true,
        });
      });

      recorder.start(250);
      recording = true;
      options.onState?.({
        status: "recording",
        progress: 0,
        message: "Recording review export...",
        warnings,
      });

      const realStartMs = performance.now();
      const durationUs = Math.max(normalized.endUs - normalized.startUs, 1);
      const initialVideoTime = Math.max(startVideoSeconds, 0);
      sourceVideo.currentTime = initialVideoTime;
      await waitForEvent(sourceVideo, "seeked").catch(() => {});

      const drawFrame = async () => {
        if (cancelled) {
          return;
        }

        const elapsedUs = Math.max(0, (performance.now() - realStartMs) * 1000);
        const currentTimeUs = Math.min(normalized.startUs + elapsedUs, normalized.endUs);
        const targetVideoTime =
          (currentTimeUs - options.flight.minTimeUs) / 1000000 + options.syncOffsetSeconds;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);

        const hasVideoFrame =
          targetVideoTime >= 0 &&
          targetVideoTime <= sourceVideo.duration &&
          sourceVideo.readyState >= 2;

        if (hasVideoFrame) {
          if (!sourceVideo.paused && Math.abs(sourceVideo.currentTime - targetVideoTime) > 0.12) {
            sourceVideo.currentTime = targetVideoTime;
          } else if (sourceVideo.paused && Math.abs(sourceVideo.currentTime - targetVideoTime) > 0.12) {
            sourceVideo.currentTime = targetVideoTime;
            await waitForEvent(sourceVideo, "seeked").catch(() => {});
          }

          context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        }

        const overlaySnapshot = options.getOverlaySnapshot(currentTimeUs);
        options.renderFrame(context, {
          width: canvas.width,
          height: canvas.height,
          currentTimeUs,
          overlaySnapshot,
          selectedEvent: options.selectedEvent,
        });

        options.onState?.({
          status: "recording",
          progress: Math.min(1, (currentTimeUs - normalized.startUs) / durationUs),
          message: "Recording review export...",
          warnings,
        });

        if (currentTimeUs >= normalized.endUs) {
          if (recording) {
            recording = false;
            recorder.stop();
          }
          return;
        }

        if (
          typeof sourceVideo.requestVideoFrameCallback === "function" &&
          hasVideoFrame &&
          !sourceVideo.paused
        ) {
          frameCallbackId = sourceVideo.requestVideoFrameCallback(() => {
            void drawFrame();
          });
          return;
        }

        rafId = requestAnimationFrame(() => {
          void drawFrame();
        });
      };

      if (startVideoSeconds >= 0 && endVideoSeconds <= sourceVideo.duration) {
        await sourceVideo.play().catch(() => {
          warnings.push("Video playback could not start automatically. Export continued silently.");
        });
      }

      await drawFrame();
      await stopPromise;

      if (cancelled) {
        cleanup();
        options.onState?.({
          status: "cancelled",
          progress: 0,
          message: "Export cancelled.",
          warnings,
        });
        throw new DOMException("Export cancelled.", "AbortError");
      }

      const blob = new Blob(chunks, { type: mimeType });
      activeUrl = URL.createObjectURL(blob);
      options.onState?.({
        status: "done",
        progress: 1,
        message: hadAudio ? "Exported with audio." : "Exported silently.",
        warnings,
        mimeType,
        downloadUrl: activeUrl,
        hadAudio,
      });

      return {
        blob,
        url: activeUrl,
        mimeType,
        durationSeconds: durationUs / 1000000,
        hadAudio,
        warnings,
      };
    },
    cancel() {
      cancelled = true;
      if (frameCallbackId && sourceVideo?.cancelVideoFrameCallback) {
        sourceVideo.cancelVideoFrameCallback(frameCallbackId);
        frameCallbackId = 0;
      }
      if (recording && recorder?.state !== "inactive") {
        recorder.stop();
      }
    },
    dispose() {
      cleanup();
    },
  };
}

export async function exportReviewVideo(options) {
  const exporter = createReviewVideoExporter(options);
  try {
    return await exporter.start();
  } finally {
    if (options.keepUrl !== true) {
      exporter.dispose();
    }
  }
}
