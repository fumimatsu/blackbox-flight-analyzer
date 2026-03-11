import { describe, expect, it } from "vitest";
import { getCompareSummary } from "./compareMetrics.js";

function buildSample(timeUs, overrides = {}) {
  return {
    timeUs,
    rc: {
      throttle: 72,
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
      roll: 20,
      pitch: 30,
      yaw: 10,
      ...(overrides.error ?? {}),
    },
    motors: overrides.motors ?? [48, 50, 49, 51],
    rpm: overrides.rpm ?? [],
  };
}

function buildFlight(samples, events = []) {
  return {
    window: {
      startUs: samples[0]?.timeUs ?? 0,
      endUs: samples[samples.length - 1]?.timeUs ?? 0,
      samples,
    },
    events,
  };
}

describe("getCompareSummary", () => {
  it("returns only interpretable metrics and notes omitted condition metrics", () => {
    const samplesA = Array.from({ length: 40 }, (_, index) =>
      buildSample(index * 25000, {
        error: { roll: 20, pitch: 26, yaw: 8 },
      })
    );
    const samplesB = Array.from({ length: 40 }, (_, index) =>
      buildSample(index * 25000, {
        error: { roll: 12, pitch: 18, yaw: 7 },
      })
    );

    for (let index = 0; index < 12; index += 1) {
      samplesA[index].setpoint.roll = 220;
      samplesB[index].setpoint.roll = 220;
    }

    const summary = getCompareSummary(buildFlight(samplesA), buildFlight(samplesB));

    expect(summary.scopeLabel).toBe("Whole-flight window");
    expect(summary.metrics.map((metric) => metric.label)).toEqual([
      "Roll tracking RMSE",
      "Pitch tracking RMSE",
      "Saturation share",
      "High-throttle tracking",
    ]);
    expect(summary.notes.some((note) => note.includes("Loaded-turn tracking hidden"))).toBe(
      true
    );
  });

  it("reports pooled-event caveat when event counts differ", () => {
    const samplesA = Array.from({ length: 30 }, (_, index) =>
      buildSample(index * 25000, {
        error: { roll: 14, pitch: 16, yaw: 6 },
      })
    );
    const samplesB = Array.from({ length: 30 }, (_, index) =>
      buildSample(index * 25000, {
        error: { roll: 15, pitch: 17, yaw: 6 },
      })
    );

    const eventType = "loadedRollArc";
    const summary = getCompareSummary(
      buildFlight(samplesA, [{ type: eventType, startUs: 0, endUs: 200000 }]),
      buildFlight(samplesB, [
        { type: eventType, startUs: 0, endUs: 150000 },
        { type: eventType, startUs: 300000, endUs: 450000 },
      ]),
      eventType
    );

    expect(summary.scopeLabel).toBe(`${eventType} events`);
    expect(summary.notes.some((note) => note.includes("Event counts differ"))).toBe(true);
  });
});
