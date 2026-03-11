import { describe, expect, it } from "vitest";
import {
  getFlightStatusFlags,
  getFlightStatusSummary,
  getLowThrottleReviewSummary,
  getStickAxisUsage,
} from "./flightDerived.js";

function buildSnapshot(overrides = {}) {
  return {
    rc: {
      throttle: 10,
      ...overrides.rc,
    },
    error: {
      roll: 0,
      pitch: 0,
      yaw: 0,
      ...overrides.error,
    },
    motors: overrides.motors ?? [20, 22, 21, 23],
    rpm: overrides.rpm ?? [],
  };
}

describe("flightDerived status flags", () => {
  it("allows headroom and tracking flags to coexist", () => {
    const snapshot = buildSnapshot({
      rc: { throttle: 88 },
      error: { roll: 130, pitch: 10, yaw: 5 },
      motors: [97, 88, 85, 84],
    });

    const flags = getFlightStatusFlags(snapshot);
    const summary = getFlightStatusSummary(snapshot);

    expect(flags.highSpeedRun).toBe(true);
    expect(flags.headroomLimited).toBe(true);
    expect(flags.trackingOff).toBe(true);
    expect(summary.label).toBe("Headroom limited");
  });

  it("marks throttle off without inventing other flags", () => {
    const snapshot = buildSnapshot({
      rc: { throttle: 0 },
      error: { roll: 8, pitch: 6, yaw: 4 },
    });

    const flags = getFlightStatusFlags(snapshot);
    expect(flags.throttleOff).toBe(true);
    expect(flags.headroomLimited).toBe(false);
    expect(flags.trackingOff).toBe(false);
  });

  it("summarizes stick min/max usage across the flight window", () => {
    const usage = getStickAxisUsage([
      {
        rc: { throttle: 14, yaw: -180, roll: -320, pitch: -90 },
      },
      {
        rc: { throttle: 76, yaw: 220, roll: 405, pitch: 160 },
      },
      {
        rc: { throttle: 42, yaw: 18, roll: 20, pitch: -32 },
      },
    ]);

    expect(usage.throttle).toEqual({ min: 14, max: 76 });
    expect(usage.yaw).toEqual({ min: -180, max: 220 });
    expect(usage.roll).toEqual({ min: -320, max: 405 });
    expect(usage.pitch).toEqual({ min: -90, max: 160 });
  });
});

describe("getLowThrottleReviewSummary", () => {
  function buildSample(timeUs, overrides = {}) {
    return {
      timeUs,
      rc: {
        throttle: 20,
        roll: 0,
        pitch: 0,
        yaw: 0,
        ...(overrides.rc ?? {}),
      },
      error: {
        roll: 20,
        pitch: 15,
        yaw: 10,
        ...(overrides.error ?? {}),
      },
      motors: overrides.motors ?? [20, 21, 22, 19],
      rpm: overrides.rpm ?? [1200, 1180, 1190, 1210],
    };
  }

  it("summarizes rpm floor and recovery after throttle re-entry", () => {
    const samples = [
      buildSample(0, { rc: { throttle: 4 }, rpm: [980, 960, 970, 990] }),
      buildSample(100000, { rc: { throttle: 3 }, rpm: [940, 920, 910, 930] }),
      buildSample(200000, {
        rc: { throttle: 28 },
        rpm: [870, 860, 850, 875],
        error: { roll: 130 },
      }),
      buildSample(300000, {
        rc: { throttle: 34 },
        rpm: [990, 980, 970, 995],
        error: { roll: 60 },
      }),
      buildSample(400000, {
        rc: { throttle: 36 },
        rpm: [1080, 1070, 1060, 1090],
        error: { roll: 30 },
      }),
    ];

    const summary = getLowThrottleReviewSummary(samples);

    expect(summary.zeroThrottleSamples).toBe(2);
    expect(summary.lowThrottleSamples).toBe(2);
    expect(summary.hasRpmData).toBe(true);
    expect(summary.rpmFloorMin).toBe(910);
    expect(summary.recoveryWindows).toHaveLength(1);
    expect(summary.recoveryWindows[0].rpmDip).toBe(850);
    expect(summary.recoveryErrorPeak).toBe(130);
    expect(summary.recoveryTimeMs).toBe(100);
  });

  it("falls back cleanly when rpm is unavailable", () => {
    const samples = [
      buildSample(0, { rc: { throttle: 5 }, rpm: [] }),
      buildSample(100000, { rc: { throttle: 4 }, rpm: [] }),
      buildSample(200000, { rc: { throttle: 24 }, rpm: [], error: { pitch: 120 } }),
      buildSample(300000, { rc: { throttle: 30 }, rpm: [], error: { pitch: 70 } }),
    ];

    const summary = getLowThrottleReviewSummary(samples);

    expect(summary.hasRpmData).toBe(false);
    expect(summary.rpmFloor).toBeNull();
    expect(summary.recoveryWindows).toHaveLength(1);
    expect(summary.recoveryWindows[0].rpmDip).toBeNull();
    expect(summary.recoveryErrorPeak).toBe(120);
  });
});
