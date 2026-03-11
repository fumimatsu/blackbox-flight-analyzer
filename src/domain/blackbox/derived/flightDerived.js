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

function getSampleRpmFloor(sample) {
  const rpmValues = (sample?.rpm ?? []).filter(
    (value) => value !== null && value !== undefined && !Number.isNaN(value)
  );
  if (!rpmValues.length) {
    return null;
  }
  return Math.min(...rpmValues);
}

function getSampleMotorFloor(sample) {
  const motorValues = (sample?.motors ?? []).filter(
    (value) => value !== null && value !== undefined && !Number.isNaN(value)
  );
  if (!motorValues.length) {
    return null;
  }
  return Math.min(...motorValues);
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getLowThrottleReviewSummary(samples, options = {}) {
  const idleThrottle = options.idleThrottleThreshold ?? 5;
  const lowThrottle = options.lowThrottleThreshold ?? 20;
  const recoveryWindowUs = options.recoveryWindowUs ?? 300000;

  const lowThrottleSamples = samples.filter(
    (sample) =>
      sample?.rc?.throttle !== null &&
      sample?.rc?.throttle !== undefined &&
      !Number.isNaN(sample.rc.throttle) &&
      sample.rc.throttle <= lowThrottle
  );
  const zeroThrottleSamples = lowThrottleSamples.filter(
    (sample) => sample.rc.throttle <= idleThrottle
  );
  const hasRpmData = lowThrottleSamples.some((sample) => getSampleRpmFloor(sample) !== null);

  const rpmFloors = lowThrottleSamples
    .map((sample) => getSampleRpmFloor(sample))
    .filter((value) => value !== null);
  const motorFloors = lowThrottleSamples
    .map((sample) => getSampleMotorFloor(sample))
    .filter((value) => value !== null);

  const recoveryWindows = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousThrottle = previous?.rc?.throttle;
    const currentThrottle = current?.rc?.throttle;

    if (
      previousThrottle === null ||
      previousThrottle === undefined ||
      currentThrottle === null ||
      currentThrottle === undefined ||
      Number.isNaN(previousThrottle) ||
      Number.isNaN(currentThrottle)
    ) {
      continue;
    }

    if (!(previousThrottle <= lowThrottle && currentThrottle > lowThrottle)) {
      continue;
    }

    const lowSegment = [];
    let lowIndex = index - 1;
    while (lowIndex >= 0) {
      const sample = samples[lowIndex];
      if (
        sample?.rc?.throttle === null ||
        sample?.rc?.throttle === undefined ||
        Number.isNaN(sample.rc.throttle) ||
        sample.rc.throttle > lowThrottle
      ) {
        break;
      }
      lowSegment.unshift(sample);
      lowIndex -= 1;
    }

    const baselineRpmFloor = average(
      lowSegment
        .map((sample) => getSampleRpmFloor(sample))
        .filter((value) => value !== null)
    );
    const baselineMotorFloor = average(
      lowSegment
        .map((sample) => getSampleMotorFloor(sample))
        .filter((value) => value !== null)
    );

    const windowSamples = [];
    let endIndex = index;
    while (endIndex < samples.length) {
      const sample = samples[endIndex];
      if ((sample.timeUs ?? 0) - current.timeUs > recoveryWindowUs) {
        break;
      }
      windowSamples.push(sample);
      endIndex += 1;
    }

    const rpmDip = windowSamples
      .map((sample) => getSampleRpmFloor(sample))
      .filter((value) => value !== null);
    const errorPeaks = windowSamples
      .map((sample) => getErrorMagnitude(sample.error))
      .filter((value) => value !== null);

    let recoveredAtUs = null;
    for (const sample of windowSamples) {
      const sampleRpmFloor = getSampleRpmFloor(sample);
      const sampleError = getErrorMagnitude(sample.error);
      const rpmRecovered =
        baselineRpmFloor === null ||
        sampleRpmFloor === null ||
        sampleRpmFloor >= baselineRpmFloor * 0.9;
      const errorRecovered = sampleError === null || sampleError <= 90;
      if (rpmRecovered && errorRecovered) {
        recoveredAtUs = sample.timeUs;
        break;
      }
    }

    const endUs =
      recoveredAtUs ??
      windowSamples[windowSamples.length - 1]?.timeUs ??
      current.timeUs;

    recoveryWindows.push({
      startUs: current.timeUs,
      endUs,
      recoveryTimeMs: Math.max(0, (endUs - current.timeUs) / 1000),
      rpmDip: rpmDip.length ? Math.min(...rpmDip) : null,
      motorFloor:
        average(
          windowSamples
            .map((sample) => getSampleMotorFloor(sample))
            .filter((value) => value !== null)
        ) ?? baselineMotorFloor,
      errorPeak: errorPeaks.length ? Math.max(...errorPeaks) : null,
      baselineRpmFloor,
      baselineMotorFloor,
    });
  }

  return {
    lowThrottleSamples: lowThrottleSamples.length,
    zeroThrottleSamples: zeroThrottleSamples.length,
    rpmFloor: rpmFloors.length ? Math.min(...rpmFloors) : null,
    rpmFloorMin: rpmFloors.length ? Math.min(...rpmFloors) : null,
    rpmFloorAvg: average(rpmFloors),
    motorFloor: motorFloors.length ? Math.min(...motorFloors) : null,
    recoveryWindows,
    recoveryErrorPeak: recoveryWindows.reduce(
      (peak, window) =>
        window.errorPeak === null ? peak : Math.max(peak ?? 0, window.errorPeak),
      null
    ),
    recoveryRpmDip: recoveryWindows.reduce(
      (dip, window) =>
        window.rpmDip === null ? dip : Math.min(dip ?? window.rpmDip, window.rpmDip),
      null
    ),
    recoveryTimeMs: recoveryWindows.reduce(
      (peak, window) => Math.max(peak, window.recoveryTimeMs ?? 0),
      0
    ),
    hasRpmData,
  };
}
