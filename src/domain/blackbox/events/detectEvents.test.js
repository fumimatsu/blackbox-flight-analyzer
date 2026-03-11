import { describe, expect, it } from "vitest";
import { detectAnalysisEvents } from "./detectEvents.js";
import { EVENT_TYPES } from "./eventConfig.js";

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
    setpoint: {
      roll: 0,
      pitch: 0,
      yaw: 0,
      ...(overrides.setpoint ?? {}),
    },
    error: {
      roll: 10,
      pitch: 8,
      yaw: 5,
      ...(overrides.error ?? {}),
    },
    motors: overrides.motors ?? [42, 44, 43, 45],
    rpm: overrides.rpm ?? [],
    aux: [],
    mode: { armed: true, names: ["Acro"] },
  };
}

describe("detectAnalysisEvents", () => {
  it("merges short gaps inside a high-throttle straight segment", () => {
    const samples = [
      buildSample(0, { rc: { throttle: 78 } }),
      buildSample(100000, { rc: { throttle: 80 } }),
      buildSample(180000, { rc: { throttle: 20, roll: 30 } }),
      buildSample(220000, { rc: { throttle: 81 } }),
      buildSample(320000, { rc: { throttle: 82 } }),
      buildSample(420000, { rc: { throttle: 83 } }),
    ];

    const events = detectAnalysisEvents({ samples });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EVENT_TYPES.HIGH_THROTTLE_STRAIGHT);
    expect(events[0].detail).toContain("Peak throttle");
    expect(events[0].reviewReason).toContain("tracking");
  });

  it("prefers saturation bursts over overlapping high-error bursts", () => {
    const samples = Array.from({ length: 6 }, (_, index) =>
      buildSample(index * 100000, {
        rc: { throttle: 72 },
        error: { roll: 140, pitch: 30, yaw: 15 },
        motors: [96, 90, 89, 88],
      })
    );

    const events = detectAnalysisEvents({ samples });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EVENT_TYPES.SATURATION_BURST);
    expect(events[0].summary).toBe("Headroom-limited burst");
  });

  it("keeps loaded roll arcs when they have sustained roll demand", () => {
    const samples = Array.from({ length: 5 }, (_, index) =>
      buildSample(index * 100000, {
        rc: { throttle: 48 },
        setpoint: { roll: 240, pitch: 80 },
      })
    );

    const events = detectAnalysisEvents({ samples });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EVENT_TYPES.LOADED_ROLL_ARC);
  });
});
