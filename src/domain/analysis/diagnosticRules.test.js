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
    rcRaw: {
      throttle: null,
      roll: null,
      pitch: null,
      yaw: null,
      ...(overrides.rcRaw ?? {}),
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
    battery: overrides.battery ?? { voltage: 16.2, amperage: null },
    debug: overrides.debug ?? { mode: null, values: null },
    radio: overrides.radio ?? { rssi: null },
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
    setupSummary: {
      batteryConfig: {
        minCellVoltage: 3.3,
        warningCellVoltage: 3.5,
        maxCellVoltage: 4.3,
        sagCompensation: 0,
      },
      groups: [
        {
          key: "idleThrottle",
          items: [{ key: "dynamicIdleMinRpm", value: "32rpm" }],
        },
      ],
    },
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
        error: { roll: 116, pitch: 84, yaw: 22 },
        motors: [55, 56, 57, 58],
        rpm: [980 - index * 2, 960 - index * 2, 950 - index * 2, 970 - index * 2],
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
    expect(insights.map((item) => item.id)).toContain("low-throttle-authority");
  });

  it("falls back to motor/error-only low-throttle evidence when rpm is missing", () => {
    const samples = Array.from({ length: 30 }, (_, index) =>
      buildSample(index * 25000, {
        rc: { throttle: index < 15 ? 10 : 28 },
        error: { roll: 128, pitch: 94, yaw: 22 },
        motors: [42, 44, 45, 43],
        rpm: [],
      })
    );
    const flight = buildFlight({
      samples,
      events: [
        { type: EVENT_TYPES.CHOP_TURN, startUs: 0, endUs: 220000 },
        { type: EVENT_TYPES.HIGH_ERROR_BURST, startUs: 0, endUs: 220000 },
      ],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("low-throttle-instability");
    expect(
      insights.find((item) => item.id === "low-throttle-instability")?.evidenceSummary
    ).toContain("RPM");
  });

  it("surfaces stick-side command shaping when setpoint diverges from command motion", () => {
    const samples = [
      buildSample(0, {
        rc: { roll: 0 },
        rcRaw: { roll: 0 },
        setpoint: { roll: 0 },
      }),
      buildSample(25000, {
        rc: { roll: 30 },
        rcRaw: { roll: 0 },
        setpoint: { roll: 90 },
      }),
      buildSample(50000, {
        rc: { roll: 80 },
        rcRaw: { roll: 5 },
        setpoint: { roll: 150 },
      }),
      buildSample(75000, {
        rc: { roll: 82 },
        rcRaw: { roll: 5 },
        setpoint: { roll: 165 },
      }),
    ];
    const flight = buildFlight({
      samples,
      events: [{ type: EVENT_TYPES.HIGH_THROTTLE_STRAIGHT, startUs: 0, endUs: 75000 }],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("stick-side-command-shaping");
  });

  it("surfaces RC link quality when debug link quality is weak", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      buildSample(index * 25000, {
        debug: {
          mode: "RX_TIMING",
          values: [250, 500, 1, 250, 500, 430, 88, 1],
        },
      })
    );
    const flight = buildFlight({
      samples,
      events: [{ type: EVENT_TYPES.HIGH_THROTTLE_STRAIGHT, startUs: 0, endUs: 220000 }],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("rc-link-quality");
  });

  it("surfaces battery sag review when warning starts early", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      buildSample(index * 100000, {
        rc: { throttle: index < 6 ? 42 : 38 },
        battery: {
          voltage: [16.4, 16.2, 15.0, 14.2, 13.9, 13.8, 13.7, 13.6, 13.5, 13.3, 13.2, 13.1][index],
          amperage: null,
        },
      })
    );
    const flight = buildFlight({
      samples,
      events: [
        { type: EVENT_TYPES.BATTERY_WARNING, startUs: 200000, endUs: 800000 },
        { type: EVENT_TYPES.BATTERY_CRITICAL, startUs: 900000, endUs: 1100000 },
      ],
    });

    const insights = evaluateDiagnosticRules(flight);
    expect(insights.map((item) => item.id)).toContain("battery-sag-trend");
  });
});
