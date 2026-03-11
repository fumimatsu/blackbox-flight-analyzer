import { describe, expect, it } from "vitest";
import { evaluateDiagnosticRules } from "./diagnosticRules.js";
import { EVENT_TYPES } from "../blackbox/events/eventConfig.js";

function buildSample(timeUs, overrides = {}) {
  return {
    timeUs,
    rc: {
      throttle: 50,
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
      roll: 18,
      pitch: 16,
      yaw: 8,
      ...(overrides.error ?? {}),
    },
    motors: overrides.motors ?? [50, 52, 51, 53],
    rpm: [],
  };
}

function buildFlight({ samples, events }) {
  return {
    window: {
      startUs: samples[0]?.timeUs ?? 0,
      endUs: samples[samples.length - 1]?.timeUs ?? 0,
      samples,
    },
    events,
  };
}

describe("evaluateDiagnosticRules", () => {
  it("surfaces headroom limitation when saturation repeats", () => {
    const samples = Array.from({ length: 40 }, (_, index) =>
      buildSample(index * 25000, {
        rc: { throttle: 74 },
        motors: index < 6 ? [97, 92, 90, 89] : [56, 57, 58, 59],
      })
    );
    const flight = buildFlight({
      samples,
      events: [
        { type: EVENT_TYPES.SATURATION_BURST, startUs: 0, endUs: 200000 },
        { type: EVENT_TYPES.LOADED_ROLL_ARC, startUs: 0, endUs: 350000 },
      ],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("headroom-limited");
  });

  it("surfaces low-throttle instability when chop turns and errors cluster without saturation", () => {
    const samples = Array.from({ length: 40 }, (_, index) =>
      buildSample(index * 25000, {
        rc: { throttle: index < 20 ? 18 : 26 },
        error: { roll: 96, pitch: 84, yaw: 22 },
        motors: [55, 56, 57, 58],
      })
    );
    const flight = buildFlight({
      samples,
      events: [
        { type: EVENT_TYPES.CHOP_TURN, startUs: 0, endUs: 200000 },
        { type: EVENT_TYPES.HIGH_ERROR_BURST, startUs: 0, endUs: 200000 },
      ],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("low-throttle-instability");
  });
});
