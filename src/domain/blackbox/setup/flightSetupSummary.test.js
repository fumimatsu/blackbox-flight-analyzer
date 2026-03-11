import { describe, expect, it } from "vitest";
import { getFlightSetupSummary } from "./flightSetupSummary.js";

function buildSession(sysConfig) {
  return {
    log: {
      getSysConfig() {
        return sysConfig;
      },
    },
  };
}

describe("getFlightSetupSummary", () => {
  it("builds review-oriented groups from modern sysConfig fields", () => {
    const summary = getFlightSetupSummary(
      buildSession({
        firmwareType: 3,
        firmwareVersion: "4.5.0",
        rollPID: [52, 58, 38, 42],
        pitchPID: [55, 60, 40, 45],
        yawPID: [48, 54, 0, 0],
        gyro_lowpass_hz: 160,
        gyro_lowpass2_hz: 330,
        dterm_lpf1_static_hz: 120,
        dterm_lpf2_static_hz: 210,
        gyro_rpm_notch_harmonics: 3,
        gyro_rpm_notch_min: 90,
        gyro_rpm_notch_q: 500,
        dyn_notch_count: 3,
        dyn_notch_min_hz: 120,
        dyn_notch_max_hz: 650,
        pid_process_denom: 2,
        rates_type: 3,
        rc_rates: [1.2, 1.2, 1.05],
        rates: [0.72, 0.72, 0.64],
        rc_expo: [0.1, 0.1, 0],
        rate_limits: [900, 900, 700],
        ff_transition: 20,
        ff_averaging: 2,
        ff_boost: 18,
        ff_max_rate_limit: 850,
        dtermSetpointWeight: 120,
        rc_smoothing_mode: 1,
        rc_smoothing_auto_factor_setpoint: 35,
        rc_smoothing_feedforward_hz: 55,
        rc_smoothing_setpoint_hz: 60,
        rc_smoothing_throttle_hz: 45,
        dynamic_idle_min_rpm: 35,
        anti_gravity_gain: 5000,
        anti_gravity_threshold: 350,
        minthrottle: 1050,
        throttle_boost: 5,
        fast_pwm_protocol: 7,
        motor_poles: 14,
        throttle_limit_type: 1,
        throttle_limit_percent: 90,
        tpa_rate: 65,
        tpa_breakpoint: 1350,
        motor_output_limit: 92,
      })
    );

    expect(summary.firmware.display).toBe("Betaflight 4.5.0");
    expect(summary.groups.map((group) => group.key)).toEqual([
      "pid",
      "filters",
      "rates",
      "feedforward",
      "idleThrottle",
      "drive",
    ]);
    expect(summary.groups.find((group) => group.key === "pid")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "rollPid", value: "52 / 58 / 38" }),
        expect.objectContaining({ key: "dMin", value: "42 / 45 / 0" }),
      ])
    );
    expect(summary.groups.find((group) => group.key === "drive")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "protocol", value: "DSHOT600" }),
        expect.objectContaining({ key: "throttleLimit", value: "SCALE · 90%" }),
      ])
    );
  });

  it("absorbs alias fields and hides empty groups", () => {
    const summary = getFlightSetupSummary(
      buildSession({
        firmwareType: 3,
        firmwareVersion: "4.3.0",
        rollPID: [46, 52, 34],
        pitchPID: [46, 52, 34],
        yawPID: [50, 55, 0],
        d_min: [30, 31, 0],
        feedforward_transition: 12,
        feedforward_max_rate_limit: 720,
        dyn_idle_min_rpm: 32,
        motor_pwm_protocol: 6,
        motor_poles: 12,
      })
    );

    expect(summary.groups.find((group) => group.key === "filters")).toBeUndefined();
    expect(summary.groups.find((group) => group.key === "feedforward")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "feedforward", value: "trans 12" }),
        expect.objectContaining({ key: "ffLimit", value: "720°/s" }),
      ])
    );
    expect(summary.groups.find((group) => group.key === "idleThrottle")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "dynamicIdleMinRpm", value: "32rpm" }),
      ])
    );
  });
});
