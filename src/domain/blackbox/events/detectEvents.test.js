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
    battery: overrides.battery ?? { voltage: 16.2, amperage: null },
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

  it("adds low-throttle context to chop turns", () => {
    const samples = [
      buildSample(0, { rc: { throttle: 72 } }),
      buildSample(40000, { rc: { throttle: 24, roll: 180 }, rpm: [980, 960, 950, 970] }),
      buildSample(80000, { rc: { throttle: 68 } }),
      buildSample(120000, { rc: { throttle: 18, roll: 230 }, rpm: [930, 910, 900, 920] }),
      buildSample(160000, { rc: { throttle: 64 } }),
      buildSample(200000, {
        rc: { throttle: 16, roll: 190 },
        rpm: [920, 910, 900, 930],
      }),
      buildSample(240000, { rc: { throttle: 62 } }),
      buildSample(300000, {
        rc: { throttle: 14, roll: 210 },
        rpm: [860, 850, 840, 870],
        error: { roll: 128, pitch: 20, yaw: 12 },
      }),
      buildSample(340000, { rc: { throttle: 34, roll: 120 }, rpm: [1040, 1030, 1020, 1050] }),
    ];

    const events = detectAnalysisEvents({ samples });

    const chopTurn = events.find((event) => event.type === EVENT_TYPES.CHOP_TURN);

    expect(chopTurn).toBeTruthy();
    expect(chopTurn.lowThrottleContext).toEqual(
      expect.objectContaining({
        hasRpmData: true,
        lowThrottleSamples: 3,
        rpmFloor: 840,
      })
    );
    expect(chopTurn.detail).toContain("RPM floor");
  });

  it("detects battery warning and critical bands from embedded thresholds", () => {
    const samples = [
      buildSample(0, { battery: { voltage: 16.4, amperage: null } }),
      buildSample(200000, { battery: { voltage: 15.0, amperage: null } }),
      buildSample(450000, { battery: { voltage: 13.9, amperage: null } }),
      buildSample(750000, { battery: { voltage: 13.7, amperage: null } }),
      buildSample(1050000, { battery: { voltage: 13.1, amperage: null } }),
      buildSample(1350000, { battery: { voltage: 13.0, amperage: null } }),
    ];

    const events = detectAnalysisEvents(
      { samples },
      "en",
      {
        setupSummary: {
          batteryConfig: {
            minCellVoltage: 3.3,
            warningCellVoltage: 3.5,
            maxCellVoltage: 4.3,
          },
        },
      }
    );

    expect(events.map((event) => event.type)).toContain(EVENT_TYPES.BATTERY_WARNING);
    expect(events.map((event) => event.type)).toContain(EVENT_TYPES.BATTERY_CRITICAL);
  });

  it("detects motor chatter during active rpm oscillation", () => {
    const samples = Array.from({ length: 8 }, (_, index) =>
      buildSample(index * 50000, {
        rc: { throttle: index < 2 ? 42 : 68, roll: 190 },
        setpoint: { roll: 240, pitch: 30, yaw: 0 },
        rpm:
          index % 2 === 0
            ? [1520, 1120, 1510, 1130]
            : [1090, 1540, 1080, 1560],
      })
    );

    const events = detectAnalysisEvents({ samples });
    const chatter = events.find((event) => event.type === EVENT_TYPES.MOTOR_CHATTER);

    expect(chatter).toBeTruthy();
    expect(chatter.detail).toContain("oscillation");
    expect(chatter.motorChatterContext).toEqual(
      expect.objectContaining({
        affectedMotorCount: expect.any(Number),
      })
    );
  });

  it("ignores rpm oscillation near idle spin-down", () => {
    const samples = Array.from({ length: 8 }, (_, index) =>
      buildSample(index * 50000, {
        rc: { throttle: 3 },
        rpm:
          index % 2 === 0
            ? [420, 150, 410, 155]
            : [160, 430, 150, 440],
      })
    );

    const events = detectAnalysisEvents({ samples });

    expect(events.map((event) => event.type)).not.toContain(EVENT_TYPES.MOTOR_CHATTER);
  });

  it("treats broad background oscillation as baseline and highlights burstier turn windows", () => {
    const samples = Array.from({ length: 22 }, (_, index) => {
      const burst = index >= 8 && index <= 16;
      return buildSample(index * 50000, {
        rc: {
          throttle: burst ? (index < 11 ? 46 : 76) : 56,
          roll: burst ? 210 : 22,
        },
        setpoint: {
          roll: burst ? 260 : 30,
          pitch: burst ? 70 : 10,
          yaw: 0,
        },
        rpm:
          index % 2 === 0
            ? burst
              ? [1570, 1070, 1540, 1050]
              : [1470, 1410, 1460, 1405]
            : burst
              ? [1040, 1580, 1030, 1590]
              : [1400, 1475, 1405, 1468],
      });
    });

    const events = detectAnalysisEvents({ samples });
    const chatterEvents = events.filter((event) => event.type === EVENT_TYPES.MOTOR_CHATTER);

    expect(chatterEvents).toHaveLength(1);
    expect(chatterEvents[0].startUs).toBeGreaterThanOrEqual(8 * 50000);
    expect(chatterEvents[0].endUs).toBeLessThanOrEqual(16 * 50000);
  });
});
