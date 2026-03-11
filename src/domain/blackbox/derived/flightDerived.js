import { translate } from "../../../i18n/index.js";

export function getThrottleBand(throttle) {
  if (throttle === null || throttle === undefined || Number.isNaN(throttle)) {
    return "unknown";
  }
  if (throttle >= 80) return "high";
  if (throttle >= 55) return "mid-high";
  if (throttle >= 30) return "mid";
  if (throttle > 5) return "low";
  return "idle";
}

export function getMotorStats(motors) {
  if (!motors.length) {
    return { min: null, max: null, spread: null, avg: null };
  }
  const min = Math.min(...motors);
  const max = Math.max(...motors);
  const avg = motors.reduce((sum, value) => sum + value, 0) / motors.length;
  return { min, max, spread: max - min, avg };
}

export function getRpmStats(rpm) {
  if (!rpm.length) {
    return { max: null, avg: null };
  }
  return {
    max: Math.max(...rpm),
    avg: rpm.reduce((sum, value) => sum + value, 0) / rpm.length,
  };
}

export function getSaturationFlag(snapshot) {
  const motorStats = getMotorStats(snapshot.motors);
  if (motorStats.max === null || motorStats.spread === null) {
    return false;
  }
  return motorStats.max >= 95 || motorStats.spread >= 35;
}

export function getErrorMagnitude(error) {
  const values = [error.roll, error.pitch, error.yaw].filter(
    (value) => value !== null && value !== undefined && !Number.isNaN(value)
  );
  if (!values.length) {
    return null;
  }
  return Math.max(...values.map((value) => Math.abs(value)));
}

export function getFlightStatusFlags(snapshot) {
  const motor = getMotorStats(snapshot.motors);
  const rpm = getRpmStats(snapshot.rpm);
  const throttleBand = getThrottleBand(snapshot.rc.throttle);
  const saturation = getSaturationFlag(snapshot);
  const errorMagnitude = getErrorMagnitude(snapshot.error);
  const dataIncomplete =
    throttleBand === "unknown" && errorMagnitude === null && motor.max === null;

  return {
    dataIncomplete,
    headroomLimited: saturation,
    trackingOff: errorMagnitude !== null && errorMagnitude >= 120,
    highSpeedRun: throttleBand === "high",
    throttleOff: throttleBand === "idle",
    throttleBand,
    errorMagnitude,
    motor,
    rpm,
  };
}

export function getFlightStatusSummary(snapshot, locale = "en") {
  const status = getFlightStatusFlags(snapshot);

  let labelKey = "status.settled";
  if (status.dataIncomplete) {
    labelKey = "status.dataIncomplete";
  } else if (status.headroomLimited) labelKey = "status.headroomLimited";
  else if (status.trackingOff) labelKey = "status.trackingOff";
  else if (status.highSpeedRun) labelKey = "status.highSpeedRun";
  else if (status.throttleOff) labelKey = "status.throttleOff";

  return {
    label: translate(locale, labelKey),
    throttleBand:
      status.throttleBand === "mid-high"
        ? translate(locale, "status.band.midHigh")
        : translate(
            locale,
            `status.band.${status.throttleBand === "unknown" ? "unknown" : status.throttleBand}`
          ),
    saturation: status.headroomLimited,
    errorMagnitude: status.errorMagnitude,
    motor: status.motor,
    rpm: status.rpm,
    flags: status,
  };
}

function summarizeStickAxis(samples, axisKey) {
  let min = Infinity;
  let max = -Infinity;

  for (const sample of samples) {
    const value = sample?.rc?.[axisKey];
    if (value === null || value === undefined || Number.isNaN(value)) {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (min === Infinity || max === -Infinity) {
    return { min: null, max: null };
  }

  return { min, max };
}

export function getStickAxisUsage(samples) {
  return {
    throttle: summarizeStickAxis(samples, "throttle"),
    yaw: summarizeStickAxis(samples, "yaw"),
    roll: summarizeStickAxis(samples, "roll"),
    pitch: summarizeStickAxis(samples, "pitch"),
  };
}
