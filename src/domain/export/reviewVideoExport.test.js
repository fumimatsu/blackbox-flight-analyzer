import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getReviewVideoExportSupport,
  getSupportedReviewExportMimeType,
} from "./reviewVideoExport.js";

describe("reviewVideoExport support", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;

  afterEach(() => {
    globalThis.MediaRecorder = originalMediaRecorder;
    HTMLCanvasElement.prototype.captureStream = originalCaptureStream;
  });

  it("selects the first supported WebM mime type", () => {
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn((value) => value === "video/webm;codecs=vp8,opus"),
    };

    expect(getSupportedReviewExportMimeType()).toBe("video/webm;codecs=vp8,opus");
  });

  it("reports unsupported when MediaRecorder is missing", () => {
    globalThis.MediaRecorder = undefined;

    expect(getReviewVideoExportSupport()).toMatchObject({
      supported: false,
    });
  });

  it("reports supported when canvas capture and MediaRecorder are available", () => {
    globalThis.MediaRecorder = {
      isTypeSupported: vi.fn((value) => value === "video/webm"),
    };
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => new MediaStream());

    expect(getReviewVideoExportSupport()).toMatchObject({
      supported: true,
      mimeType: "video/webm",
    });
  });
});
