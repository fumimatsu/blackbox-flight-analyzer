import { describe, expect, it } from "vitest";
import { getStickIntentReviewSummary } from "./stickIntentReview.js";

function buildSample(timeUs, overrides = {}) {
  return {
    timeUs,
    rc: {
      throttle: 40,
      roll: 0,
      pitch: 0,
      yaw: 0,
      ...(overrides.rc ?? {}),
    },
    rcRaw: {
      throttle: 40,
      roll: 0,
      pitch: 0,
      yaw: 0,
      ...(overrides.rcRaw ?? {}),
    },
    setpoint: {
      roll: 0,
      pitch: 0,
      yaw: 0,
      ...(overrides.setpoint ?? {}),
    },
    debug: overrides.debug ?? { mode: null, values: null },
    radio: overrides.radio ?? { rssi: null },
  };
}

describe("getStickIntentReviewSummary", () => {
  it("summarizes RC vs setpoint and raw vs command divergence", () => {
    const samples = [
      buildSample(0, {
        rc: { roll: 0 },
        rcRaw: { roll: 0 },
        setpoint: { roll: 0 },
      }),
      buildSample(25000, {
        rc: { roll: 40 },
        rcRaw: { roll: 0 },
        setpoint: { roll: 80 },
      }),
      buildSample(50000, {
        rc: { roll: 90 },
        rcRaw: { roll: 10 },
        setpoint: { roll: 140 },
      }),
    ];

    const summary = getStickIntentReviewSummary(samples);

    expect(summary.hasAnyData).toBe(true);
    expect(summary.primaryAxis?.axis).toBe("roll");
    expect(summary.axes.roll.rcSetpointGapPeak).toBe(50);
    expect(summary.axes.roll.rawCommandGapPeak).toBe(80);
    expect(summary.axes.roll.heldInputShare).toBeGreaterThan(0);
  });

  it("summarizes feedforward and link-related debug fields when present", () => {
    const samples = Array.from({ length: 4 }, (_, index) =>
      buildSample(index * 25000, {
        debug: {
          mode: "RX_TIMING",
          values: [250, 500, 1, 250, 500, 450, 92, 1],
        },
        radio: { rssi: 84 - index },
      })
    );

    const summary = getStickIntentReviewSummary(samples, {
      groups: [
        {
          key: "feedforward",
          items: [
            { key: "feedforward", value: "trans 12" },
            { key: "rcSmoothing", value: "On · auto 35" },
          ],
        },
      ],
    });

    expect(summary.debug?.mode).toBe("RX_TIMING");
    expect(summary.debug?.linkQualityAvg).toBe(92);
    expect(summary.configuration.feedforward).toBe("trans 12");
    expect(summary.radio.rssiAvg).toBeGreaterThan(80);
  });

  it("stays usable when raw and debug data are absent", () => {
    const summary = getStickIntentReviewSummary([
      buildSample(0, {
        rcRaw: { roll: null, pitch: null, yaw: null, throttle: null },
        debug: { mode: null, values: null },
        radio: { rssi: null },
      }),
    ]);

    expect(summary.hasDebugData).toBe(false);
    expect(summary.hasRawData).toBe(false);
    expect(summary.axes.roll.rawCommandGapPeak).toBeNull();
  });
});
