import { describe, expect, it } from "vitest";
import { FlightLogParser } from "../../../vendor/log-core/flightlog_parser.js";
import { FlightLog } from "../../../vendor/log-core/flightlog.js";
import { getDebugModeIndex } from "../../../vendor/log-core/debugModes.js";
import { loadFlightSessionFromFile } from "./flightLogAdapter.js";
import { getFlightSnapshot } from "../selectors/flightSelectors.js";

// Synthetic encoded log, not a recording: exercise real header and binary decoding.
function unsignedVB(value) {
  const bytes = [];
  do {
    let byte = value & 127;
    value = Math.floor(value / 128);
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function makeLog(version = "2026.6.2", quaternion = [0, 0, 0]) {
  const names = ["loopIteration", "time", "imuQuaternion[0]", "imuQuaternion[1]",
    "imuQuaternion[2]", "motor[0]", "motor[1]", "motor[2]", "motor[3]",
    "eRPM[0]", "eRPM[1]", "eRPM[2]", "eRPM[3]", "servo[0]", "debug[0]"];
  const signed = names.map((_, index) => index >= 2 && index <= 4 ? 1 : 0);
  const api = version.startsWith("2026") ? "1.48.0" : "1.47.0";
  const header = [
    "H Product:Blackbox flight data recorder by Nicholas Sherlock",
    "H Data version:2", "H I interval:1", "H P interval:1/1",
    `H Firmware revision:Betaflight ${version} (test) TEST`,
    "H minthrottle:1000", "H maxthrottle:2000", "H motorOutput:48,2047",
    "H motor_pwm_protocol:6", "H motor_poles:14", "H acc_1G:2048",
    "H gyro_scale:3f800000", "H fields_disabled_mask:0",
    "H DeviceUID:00112233445566778899aabb",
    `H debug_mode:${getDebugModeIndex("RX_TIMING", api)}`,
    `H Field I name:${names.join(",")}`,
    `H Field I signed:${signed.join(",")}`,
    `H Field I predictor:${names.map(() => 0).join(",")}`,
    `H Field I encoding:${signed.map((s) => s ? 0 : 1).join(",")}`,
    `H Field P predictor:${names.map(() => 1).join(",")}`,
    `H Field P encoding:${signed.map((s) => s ? 0 : 1).join(",")}`,
    "H Field H name:GPS_home[0],GPS_home[1],GPS_home[2],GPS_home_epoch",
    "H Field H signed:1,1,1,0", "H Field H predictor:0,0,0,0",
    "H Field H encoding:0,0,0,1",
    "H Field G name:time,GPS_numSat,GPS_coord[0],GPS_coord[1],GPS_altitude,GPS_speed,GPS_ground_course,GPS_time",
    "H Field G signed:0,0,1,1,1,0,0,0", "H Field G predictor:0,0,0,0,0,0,0,0",
    "H Field G encoding:1,1,0,0,0,1,1,1", "",
  ].join("\n");
  const bytes = [...new TextEncoder().encode(header)];
  for (let index = 0; index < 12; index++) {
    bytes.push(73);
    const frame = [index, 1000000 + index * 10000, ...quaternion,
      400, 500, 600, 700, 1200, 1300, 1400, 1500, 1500, 42];
    frame.forEach((value, field) => bytes.push(...unsignedVB(
      signed[field] ? (value >= 0 ? value * 2 : -value * 2 - 1) : value
    )));
  }
  return new Uint8Array(bytes);
}

describe("Blackbox 2025.12 / 2026.6 compatibility", () => {
  it.each(["2025.12.0", "2026.6.2"])("loads %s through the actual adapter", async (version) => {
    const session = await loadFlightSessionFromFile(new File([makeLog(version)], "modern.bbl"));
    const config = session.log.getSysConfig();
    expect(config.firmwareVersion).toBe(version);
    expect(config.apiVersion).toBe(version.startsWith("2026") ? "1.48.0" : "1.47.0");
    expect(config.deviceUID).toBe("00112233445566778899aabb");
    expect(session.durationUs).toBe(110000);
    const snapshot = getFlightSnapshot(session, session.minTimeUs + 50000);
    expect(snapshot.attitude.roll).toBeCloseTo(0);
    expect(snapshot.attitude.pitch).toBeCloseTo(0);
    expect(snapshot.rpm).toEqual([1200, 1300, 1400, 1500]);
    expect(snapshot.motors).toHaveLength(4);
    expect(snapshot.motors[0]).toBeLessThan(snapshot.motors[3]);
    expect(snapshot.debug.mode).toBe("RX_TIMING");
    expect(snapshot.frame[session.fieldIndex["servo[0]"]]).toBe(1500);
  });

  it("uses recorded quaternion attitude when gyro and accelerometer fields are absent", async () => {
    const session = await loadFlightSessionFromFile(new File([
      makeLog("2026.6.2", [Math.round(Math.sin(Math.PI / 8) * 32767), 0, 0]),
    ], "attitude.bbl"));
    expect(getFlightSnapshot(session, session.minTimeUs).attitude.roll).toBeCloseTo(45, 1);
  });

  it("decodes altitude and epoch in GPS home frames and GPS time in G frames", () => {
    const base = makeLog();
    const extra = [72];
    [350000000, 1390000000, 1234].forEach((v) => extra.push(...unsignedVB(v * 2)));
    extra.push(...unsignedVB(1790000000), 71);
    [1120000, 12, 350000010 * 2, 1390000010 * 2, 13000 * 2, 500, 900, 123456789]
      .forEach((v) => extra.push(...unsignedVB(v)));
    // A following frame boundary terminates the GPS frame.
    extra.push(69, 255, ...new TextEncoder().encode("End of log\0"));
    const parser = new FlightLogParser(new Uint8Array([...base, ...extra]));
    parser.parseHeader();
    const frames = [];
    parser.onFrameReady = (valid, frame, type) => {
      if (valid && (type === "H" || type === "G")) frames.push({ type, frame: [...frame] });
    };
    parser.parseLogData(false);
    expect(frames.find((f) => f.type === "H")?.frame).toEqual([350000000, 1390000000, 1234, 1790000000]);
    expect(frames.find((f) => f.type === "G")?.frame.at(-1)).toBe(123456789);
  });

  it("uses the modern disabled-field mask and keeps the old mask layout", () => {
    for (const [version, rpmBit] of [["2026.6.2", 13], ["4.5.0", 12]]) {
      const log = new FlightLog(makeLog(version));
      expect(log.openLog(0)).toBe(true);
      log.getSysConfig().fields_disabled_mask = 1 << rpmBit;
      expect(log.isFieldDisabled().RPM).toBe(true);
      expect(log.isFieldDisabled().GPS).toBe(false);
    }
  });
});
