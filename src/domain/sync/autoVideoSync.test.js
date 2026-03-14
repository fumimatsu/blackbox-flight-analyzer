import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_SYNC_SCAN_SECONDS,
  calculateAutoVideoOffset,
  classifyDetectionResult,
} from "./autoVideoSync.js";

describe("classifyDetectionResult", () => {
  it("rejects low-confidence candidates so offsets are not auto-applied", async () => {
    const classified = classifyDetectionResult({
      timeSeconds: 1.3,
      confidence: 21,
      score: 100,
      text: "ARMED",
    });

    expect(classified.accepted).toBe(false);
    expect(classified.rejectionReason).toBe("low-confidence");
  });

  it("accepts high-confidence detections", () => {
    const classified = classifyDetectionResult({
      timeSeconds: 2.75,
      confidence: 96,
      score: 196,
      text: "ARMED",
    });

    expect(classified.accepted).toBe(true);
    expect(classified.rejectionReason).toBeNull();
  });
});

describe("calculateAutoVideoOffset", () => {
  it("converts log arm time into a DVR offset relative to log start", () => {
    expect(calculateAutoVideoOffset(6500000, 8.25, 1000000)).toBeCloseTo(2.75, 5);
  });

  it("does not allow negative elapsed log time", () => {
    expect(calculateAutoVideoOffset(500000, 1.5, 1000000)).toBeCloseTo(1.5, 5);
  });
});

describe("DEFAULT_AUTO_SYNC_SCAN_SECONDS", () => {
  it("scans up to one minute by default", () => {
    expect(DEFAULT_AUTO_SYNC_SCAN_SECONDS).toBe(60);
  });
});
