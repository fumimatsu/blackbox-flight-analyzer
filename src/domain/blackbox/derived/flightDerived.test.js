import { describe, expect, it } from "vitest";
import { getFlightStatusFlags, getFlightStatusSummary } from "./flightDerived.js";

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
});
