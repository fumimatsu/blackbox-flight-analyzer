import { describe, expect, it } from "vitest";
import {
  getFlightStatusFlags,
  getFlightStatusSummary,
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
