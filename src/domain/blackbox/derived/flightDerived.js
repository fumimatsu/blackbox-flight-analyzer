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

function getFiniteValues(values) {
  return values.filter(
    (value) => value !== null && value !== undefined && !Number.isNaN(value)
  );
}

export function getSaturationFlag(snapshot) {
  const motorStats = getMotorStats(snapshot.motors);
  if (motorStats.max === null || motorStats.spread === null) {
    return false;
  }
  return motorStats.max >= 95 || motorStats.spread >= 35;
}

export function getErrorMagnitude(error) {
  const values = getFiniteValues([error.roll, error.pitch, error.yaw]);
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
  const rpmValues = getFiniteValues(sample?.rpm ?? []);
  if (!rpmValues.length) {
    return null;
  }
  return Math.min(...rpmValues);
}

function getSampleMotorFloor(sample) {
  const motorValues = getFiniteValues(sample?.motors ?? []);
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

export function getMotorChatterReviewSummary(samples, options = {}) {
  const minActiveThrottle = options.minActiveThrottleThreshold ?? 18;
  const minAverageRpm = options.minAverageRpm ?? 900;
  const minFlipNormalizedDelta = options.minFlipNormalizedDelta ?? 0.03;
  const minAffectedMotorSpreadRatio = options.minAffectedMotorSpreadRatio ?? 0.18;
  const maxMotorCount = Math.max(
    0,
    ...samples.map((sample) => getFiniteValues(sample?.rpm ?? []).length)
  );

  if (!samples.length || maxMotorCount === 0) {
    return {
      hasRpmData: false,
      sampleCount: samples.length,
      pairCount: 0,
      activePairCount: 0,
      avgThrottle: null,
      avgRpm: null,
      avgNormalizedDelta: null,
      peakNormalizedDelta: null,
      flipRate: 0,
      oscillationScore: 0,
      affectedMotorCount: 0,
      peakMotorSpreadRatio: null,
      perMotor: [],
    };
  }

  const perMotor = Array.from({ length: maxMotorCount }, (_, index) => ({
    motor: index + 1,
    rpmValues: [],
    activeRpmValues: [],
    activeDeltas: [],
  }));
  const normalizedDeltas = [];
  const activeNormalizedDeltas = [];
  const activeAvgRpms = [];
  const activeThrottles = [];

  for (const sample of samples) {
    for (let index = 0; index < maxMotorCount; index += 1) {
      const rpm = sample?.rpm?.[index];
      if (Number.isFinite(rpm)) {
        perMotor[index].rpmValues.push(rpm);
      }
    }
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const throttleValues = getFiniteValues([
      previous?.rc?.throttle,
      current?.rc?.throttle,
    ]);
    const avgThrottle = average(throttleValues);

    for (let motorIndex = 0; motorIndex < maxMotorCount; motorIndex += 1) {
      const previousRpm = previous?.rpm?.[motorIndex];
      const currentRpm = current?.rpm?.[motorIndex];
      if (!Number.isFinite(previousRpm) || !Number.isFinite(currentRpm)) {
        continue;
      }

      const avgRpm = (previousRpm + currentRpm) / 2;
      const delta = currentRpm - previousRpm;
      const normalizedDelta = Math.abs(delta) / Math.max(avgRpm, 1);
      normalizedDeltas.push(normalizedDelta);

      const isActivePair =
        avgThrottle !== null &&
        avgThrottle >= minActiveThrottle &&
        avgRpm >= minAverageRpm &&
        current?.mode?.armed !== false;

      if (!isActivePair) {
        continue;
      }

      activeNormalizedDeltas.push(normalizedDelta);
      activeAvgRpms.push(avgRpm);
      activeThrottles.push(avgThrottle);
      perMotor[motorIndex].activeRpmValues.push(previousRpm, currentRpm);
      perMotor[motorIndex].activeDeltas.push({
        delta,
        normalizedDelta,
      });
    }
  }

  let signFlips = 0;
  let signOpportunities = 0;
  for (const motor of perMotor) {
    for (let index = 1; index < motor.activeDeltas.length; index += 1) {
      const previous = motor.activeDeltas[index - 1];
      const current = motor.activeDeltas[index];
      if (
        previous.normalizedDelta < minFlipNormalizedDelta ||
        current.normalizedDelta < minFlipNormalizedDelta
      ) {
        continue;
      }
      signOpportunities += 1;
      if (Math.sign(previous.delta) !== Math.sign(current.delta)) {
        signFlips += 1;
      }
    }
  }

  const summarizedMotors = perMotor.map((motor) => {
    const activeValues = motor.activeRpmValues;
    const fallbackValues = motor.rpmValues;
    const values = activeValues.length ? activeValues : fallbackValues;
    const avg = average(values);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const spread = min === null || max === null ? null : max - min;
    const spreadRatio =
      avg === null || spread === null ? null : spread / Math.max(avg, 1);

    return {
      motor: motor.motor,
      min,
      max,
      avg,
      spread,
      spreadRatio,
      activeDeltaCount: motor.activeDeltas.length,
    };
  });

  const affectedMotorCount = summarizedMotors.filter(
    (motor) =>
      motor.spreadRatio !== null && motor.spreadRatio >= minAffectedMotorSpreadRatio
  ).length;
  const peakMotorSpreadRatio = summarizedMotors.reduce(
    (peak, motor) =>
      motor.spreadRatio === null ? peak : Math.max(peak ?? 0, motor.spreadRatio),
    null
  );
  const avgNormalizedDelta = average(activeNormalizedDeltas);
  const overallNormalizedDelta = average(normalizedDeltas);
  const flipRate = signOpportunities ? signFlips / signOpportunities : 0;
  const oscillationScore =
    avgNormalizedDelta === null ? 0 : avgNormalizedDelta * (0.55 + flipRate);

  return {
    hasRpmData: normalizedDeltas.length > 0,
    sampleCount: samples.length,
    pairCount: normalizedDeltas.length,
    activePairCount: activeNormalizedDeltas.length,
    avgThrottle: average(activeThrottles),
    avgRpm: average(activeAvgRpms),
    avgNormalizedDelta,
    overallNormalizedDelta,
    peakNormalizedDelta: normalizedDeltas.length ? Math.max(...normalizedDeltas) : null,
    flipRate,
    oscillationScore,
    affectedMotorCount,
    peakMotorSpreadRatio,
    perMotor: summarizedMotors,
  };
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
