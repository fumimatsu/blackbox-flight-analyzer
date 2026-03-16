import {
  getErrorMagnitude,
  getFlightStatusSummary,
  getLowThrottleReviewSummary,
  getMotorChatterReviewSummary,
} from "../derived/flightDerived.js";
import { EVENT_CONFIG, EVENT_TYPES } from "./eventConfig.js";
import { translate } from "../../../i18n/index.js";
import { getBatteryReviewSummary } from "../../analysis/batteryReview.js";

function axisPeak(values) {
  const numbers = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
  if (!numbers.length) {
    return null;
  }
  return Math.max(...numbers.map((value) => Math.abs(value)));
}

function percentile(values, ratio) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio))
  );
  return sorted[index];
}

function buildMotorChatterThresholds(samples) {
  const activeWindows = samples.filter(
    (sample) =>
      sample.motorChatter.activePairCount >= 4 &&
      (sample.motorChatter.avgThrottle ?? 0) >= 18 &&
      (sample.motorChatter.avgRpm ?? 0) >= 900
  );
  const scores = activeWindows
    .map((sample) => sample.motorChatter.oscillationScore)
    .filter((value) => Number.isFinite(value));
  const normalizedDeltas = activeWindows
    .map((sample) => sample.motorChatter.avgNormalizedDelta)
    .filter((value) => Number.isFinite(value));

  return {
    scoreThreshold: Math.max(0.055, (percentile(scores, 0.97) ?? 0) * 0.92),
    normalizedDeltaThreshold: Math.max(
      0.05,
      (percentile(normalizedDeltas, 0.95) ?? 0) * 0.9
    ),
  };
}

function summarizeSegment(
  type,
  samples,
  locale,
  lowThrottleContext = null,
  batteryContext = null,
  motorChatterContext = null
) {
  const config = EVENT_CONFIG[type];
  const peakError = Math.round(
    Math.max(...samples.map((sample) => sample.errorMagnitude ?? 0))
  );
  const peakThrottle = Math.round(
    Math.max(...samples.map((sample) => sample.rc.throttle ?? 0))
  );
  const peakMotor = Math.round(
    Math.max(...samples.map((sample) => sample.status.motor.max ?? 0))
  );
  const peakTurnInput = Math.round(
    Math.max(...samples.map((sample) => sample.turnInput ?? 0))
  );

  switch (type) {
    case EVENT_TYPES.HIGH_THROTTLE_STRAIGHT:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.highThrottleStraightDetail", { peakThrottle }),
      };
    case EVENT_TYPES.CHOP_TURN:
      return {
        summary: translate(locale, config.labelKey),
        detail: lowThrottleContext
          ? translate(locale, "events.chopTurnDetailLowThrottle", {
              peakTurnInput,
              rpmFloor: lowThrottleContext.hasRpmData
                ? Math.round(lowThrottleContext.rpmFloor ?? 0)
                : translate(locale, "events.lowThrottleNoRpm"),
              recoveryTimeMs: Math.round(lowThrottleContext.recoveryTimeMs ?? 0),
              errorPeak: Math.round(lowThrottleContext.errorPeak ?? 0),
            })
          : translate(locale, "events.chopTurnDetail", { peakTurnInput }),
      };
    case EVENT_TYPES.LOADED_ROLL_ARC:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.loadedRollArcDetail", { peakThrottle }),
      };
    case EVENT_TYPES.HIGH_ERROR_BURST:
      return {
        summary: translate(locale, config.labelKey),
        detail:
          lowThrottleContext && lowThrottleContext.lowThrottleSamples > 0
            ? translate(locale, "events.highErrorBurstDetailLowThrottle", {
                peakError,
                rpmFloor: lowThrottleContext.hasRpmData
                  ? Math.round(lowThrottleContext.rpmFloor ?? 0)
                  : translate(locale, "events.lowThrottleNoRpm"),
                recoveryTimeMs: Math.round(lowThrottleContext.recoveryTimeMs ?? 0),
              })
            : translate(locale, "events.highErrorBurstDetail", { peakError }),
      };
    case EVENT_TYPES.SATURATION_BURST:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.saturationBurstDetail", { peakMotor }),
      };
    case EVENT_TYPES.MOTOR_CHATTER:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.motorChatterDetail", {
          oscillation: Math.round((motorChatterContext?.avgNormalizedDelta ?? 0) * 100),
          flipRate: Math.round((motorChatterContext?.flipRate ?? 0) * 100),
          affectedMotors: motorChatterContext?.affectedMotorCount ?? 0,
          avgThrottle: Math.round(motorChatterContext?.avgThrottle ?? 0),
        }),
      };
    case EVENT_TYPES.BATTERY_WARNING:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.batteryWarningDetail", {
          minVoltage: (batteryContext?.minVoltage ?? 0).toFixed(2),
          warningVoltage: (batteryContext?.warningVoltage ?? 0).toFixed(2),
        }),
      };
    case EVENT_TYPES.BATTERY_CRITICAL:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, "events.batteryCriticalDetail", {
          minVoltage: (batteryContext?.minVoltage ?? 0).toFixed(2),
          criticalVoltage: (batteryContext?.criticalVoltage ?? 0).toFixed(2),
        }),
      };
    default:
      return {
        summary: translate(locale, config.labelKey),
        detail: translate(locale, config.reviewReasonKey),
      };
  }
}

function finalizeSegment(events, type, startUs, endUs, samples, locale, options = {}) {
  const config = EVENT_CONFIG[type];
  if (startUs === null || endUs === null || !samples.length) {
    return;
  }

  const durationUs = endUs - startUs;
  if (durationUs < config.minDurationUs) {
    return;
  }

  const severity = samples.reduce((peak, sample) => Math.max(peak, sample.score ?? 0), 0);
  const lowThrottleSummary =
    type === EVENT_TYPES.CHOP_TURN ||
    (type === EVENT_TYPES.HIGH_ERROR_BURST &&
      samples.some(
        (sample) =>
          sample.rc.throttle !== null &&
          sample.rc.throttle !== undefined &&
          !Number.isNaN(sample.rc.throttle) &&
          sample.rc.throttle <= 20
      ))
      ? getLowThrottleReviewSummary(samples)
      : null;
  const lowThrottleContext = lowThrottleSummary
    ? {
        lowThrottleSamples: lowThrottleSummary.lowThrottleSamples,
        hasRpmData: lowThrottleSummary.hasRpmData,
        rpmFloor: lowThrottleSummary.rpmFloorMin,
        recoveryTimeMs: lowThrottleSummary.recoveryTimeMs,
        errorPeak: lowThrottleSummary.recoveryErrorPeak,
      }
    : null;
  const batteryContext = options.batteryThresholds
    ? {
        warningVoltage: options.batteryThresholds.warningVoltage,
        criticalVoltage: options.batteryThresholds.criticalVoltage,
        minVoltage: Math.min(
          ...samples
            .map((sample) => sample?.battery?.voltage)
            .filter((value) => value !== null && value !== undefined && !Number.isNaN(value))
        ),
      }
    : null;
  const motorChatterContext =
    type === EVENT_TYPES.MOTOR_CHATTER
      ? getMotorChatterReviewSummary(samples)
      : null;
  const summary = summarizeSegment(
    type,
    samples,
    locale,
    lowThrottleContext,
    batteryContext,
    motorChatterContext
  );

  events.push({
    id: `${type}-${startUs}`,
    type,
    startUs,
    endUs,
    durationUs,
    severity,
    priority: config.priority,
    summary: summary.summary,
    detail: summary.detail,
    reviewReason: translate(locale, config.reviewReasonKey),
    lowThrottleContext,
    batteryContext,
    motorChatterContext,
  });
}

function segmentByPredicate(samples, type, predicate, locale, options = {}) {
  const events = [];
  const config = EVENT_CONFIG[type];
  let currentStartUs = null;
  let currentEndUs = null;
  let currentSamples = [];

  for (const sample of samples) {
    const matched = predicate(sample);
    const nextSample = matched === true ? sample : matched ? { ...sample, ...matched } : null;

    if (nextSample) {
      currentStartUs ??= sample.timeUs;
      currentEndUs = sample.timeUs;
      currentSamples.push(nextSample);
      continue;
    }

    if (
      currentStartUs !== null &&
      currentEndUs !== null &&
      sample.timeUs - currentEndUs <= config.maxGapUs
    ) {
      continue;
    }

    if (currentStartUs !== null) {
      finalizeSegment(
        events,
        type,
        currentStartUs,
        currentEndUs,
        currentSamples,
        locale,
        options
      );
      currentStartUs = null;
      currentEndUs = null;
      currentSamples = [];
    }
  }

  if (currentStartUs !== null && currentEndUs !== null) {
    finalizeSegment(
      events,
      type,
      currentStartUs,
      currentEndUs,
      currentSamples,
      locale,
      options
    );
  }

  return events;
}

function overlaps(a, b) {
  if (
    a.type === EVENT_TYPES.MOTOR_CHATTER ||
    b.type === EVENT_TYPES.MOTOR_CHATTER
  ) {
    return false;
  }
  return a.startUs < b.endUs && b.startUs < a.endUs;
}

function pruneOverlappingEvents(events) {
  const sorted = [...events].sort((left, right) => {
    if (left.startUs !== right.startUs) {
      return left.startUs - right.startUs;
    }
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return right.severity - left.severity;
  });

  const kept = [];
  for (const event of sorted) {
    const overlapping = kept.find((candidate) => overlaps(candidate, event));
    if (!overlapping) {
      kept.push(event);
      continue;
    }

    const replace =
      event.priority > overlapping.priority ||
      (event.priority === overlapping.priority && event.severity > overlapping.severity);

    if (replace) {
      const index = kept.indexOf(overlapping);
      kept[index] = event;
    }
  }

  return kept.sort((left, right) => left.startUs - right.startUs);
}

export function detectAnalysisEvents(windowSlice, locale = "en", options = {}) {
  const samples = windowSlice.samples;
  if (!samples.length) {
    return [];
  }

  const batteryReview = getBatteryReviewSummary(samples, options.setupSummary);

  const derived = samples.map((sample, index) => {
    const previous = samples[index - 1];
    const status = getFlightStatusSummary(sample);
    const rcTurnInput = axisPeak([sample.rc.roll, sample.rc.pitch, sample.rc.yaw]);
    const setpointTurnInput = axisPeak([
      sample.setpoint.roll,
      sample.setpoint.pitch,
      sample.setpoint.yaw,
    ]);

    return {
      ...sample,
      previousThrottle: previous?.rc.throttle ?? sample.rc.throttle,
      throttleDrop:
        previous?.rc.throttle !== null &&
        previous?.rc.throttle !== undefined &&
        sample.rc.throttle !== null &&
        sample.rc.throttle !== undefined
          ? previous.rc.throttle - sample.rc.throttle
          : null,
      throttleRise:
        previous?.rc.throttle !== null &&
        previous?.rc.throttle !== undefined &&
        sample.rc.throttle !== null &&
        sample.rc.throttle !== undefined
          ? sample.rc.throttle - previous.rc.throttle
          : null,
      status,
      errorMagnitude: getErrorMagnitude(sample.error),
      turnInput: rcTurnInput,
      setpointTurnInput,
      batteryState:
        batteryReview.hasThresholds &&
        sample?.battery?.voltage !== null &&
        sample?.battery?.voltage !== undefined &&
        !Number.isNaN(sample.battery.voltage)
          ? sample.battery.voltage <= batteryReview.criticalVoltage
            ? "critical"
            : sample.battery.voltage <= batteryReview.warningVoltage
              ? "warning"
              : null
          : null,
    };
  });
  const derivedWithMotorChatter = derived.map((sample, index) => {
    const localStart = Math.max(0, index - 3);
    const localEnd = Math.min(derived.length, index + 4);
    const motorChatter = getMotorChatterReviewSummary(derived.slice(localStart, localEnd));

    return {
      ...sample,
      motorChatter,
    };
  });
  const motorChatterThresholds = buildMotorChatterThresholds(derivedWithMotorChatter);

  const events = [
    ...segmentByPredicate(derivedWithMotorChatter, EVENT_TYPES.HIGH_THROTTLE_STRAIGHT, (sample) => {
      if (
        sample.rc.throttle === null ||
        sample.turnInput === null ||
        sample.rc.throttle < 75 ||
        sample.turnInput > 16
      ) {
        return false;
      }

      return {
        score: (sample.rc.throttle ?? 0) + ((sample.errorMagnitude ?? 0) * 0.3),
      };
    }, locale),
    ...segmentByPredicate(derivedWithMotorChatter, EVENT_TYPES.CHOP_TURN, (sample) => {
      if (
        sample.previousThrottle === null ||
        sample.rc.throttle === null ||
        sample.turnInput === null ||
        sample.previousThrottle < 55 ||
        sample.rc.throttle > 28 ||
        (sample.throttleDrop ?? 0) < 18 ||
        sample.turnInput < 22
      ) {
        return false;
      }

      return {
        score: (sample.throttleDrop ?? 0) + sample.turnInput,
      };
    }, locale),
    ...segmentByPredicate(derivedWithMotorChatter, EVENT_TYPES.LOADED_ROLL_ARC, (sample) => {
      if (
        sample.rc.throttle === null ||
        sample.setpoint.roll === null ||
        sample.setpoint.pitch === null ||
        sample.rc.throttle < 35 ||
        Math.abs(sample.setpoint.roll) < 180 ||
        Math.abs(sample.setpoint.pitch) > 260
      ) {
        return false;
      }

      return {
        score: Math.abs(sample.setpoint.roll) + (sample.rc.throttle ?? 0),
      };
    }, locale),
    ...segmentByPredicate(derivedWithMotorChatter, EVENT_TYPES.HIGH_ERROR_BURST, (sample) => {
      if (
        sample.errorMagnitude === null ||
        sample.errorMagnitude < 110 ||
        sample.status.saturation
      ) {
        return false;
      }

      return {
        score: sample.errorMagnitude,
      };
    }, locale),
    ...segmentByPredicate(derivedWithMotorChatter, EVENT_TYPES.SATURATION_BURST, (sample) => {
      if (!sample.status.saturation || sample.rc.throttle === null || sample.rc.throttle < 45) {
        return false;
      }

      return {
        score: (sample.status.motor.max ?? 0) + (sample.errorMagnitude ?? 0) * 0.2,
      };
    }, locale),
    ...segmentByPredicate(
      derivedWithMotorChatter,
      EVENT_TYPES.MOTOR_CHATTER,
      (sample) => {
        const turnDemand = Math.max(
          sample.turnInput ?? 0,
          (sample.setpointTurnInput ?? 0) * 0.75
        );
        const throttlePunch =
          (sample.throttleRise ?? 0) >= 10 ||
          ((sample.previousThrottle ?? 0) < 55 && (sample.rc.throttle ?? 0) >= 62);
        const loadedDemand =
          turnDemand >= 135 ||
          throttlePunch ||
          ((sample.rc.throttle ?? 0) >= 72 && (sample.motorChatter.flipRate ?? 0) >= 0.35);

        if (
          sample.mode?.armed === false ||
          sample.motorChatter.activePairCount < 4 ||
          (sample.motorChatter.avgThrottle ?? 0) < 22 ||
          (sample.motorChatter.avgRpm ?? 0) < 900 ||
          !loadedDemand
        ) {
          return false;
        }

        if (
          (sample.motorChatter.oscillationScore ?? 0) <
            motorChatterThresholds.scoreThreshold ||
          (sample.motorChatter.avgNormalizedDelta ?? 0) <
            motorChatterThresholds.normalizedDeltaThreshold ||
          (sample.motorChatter.affectedMotorCount < 2 &&
            (sample.motorChatter.peakMotorSpreadRatio ?? 0) < 0.24)
        ) {
          return false;
        }

        return {
          score:
            (sample.motorChatter.oscillationScore ?? 0) * 1000 +
            (sample.motorChatter.flipRate ?? 0) * 100 +
            turnDemand * 0.2 +
            ((sample.throttleRise ?? 0) * 4),
        };
      },
      locale
    ),
    ...segmentByPredicate(
      derivedWithMotorChatter,
      EVENT_TYPES.BATTERY_WARNING,
      (sample) => {
        if (sample.batteryState !== "warning") {
          return false;
        }
        return {
          score:
            ((batteryReview.warningVoltage ?? sample.battery.voltage ?? 0) -
              (sample.battery?.voltage ?? 0)) *
            10,
        };
      },
      locale,
      {
        batteryThresholds: {
          warningVoltage: batteryReview.warningVoltage,
          criticalVoltage: batteryReview.criticalVoltage,
        },
      }
    ),
    ...segmentByPredicate(
      derivedWithMotorChatter,
      EVENT_TYPES.BATTERY_CRITICAL,
      (sample) => {
        if (sample.batteryState !== "critical") {
          return false;
        }
        return {
          score:
            ((batteryReview.criticalVoltage ?? sample.battery.voltage ?? 0) -
              (sample.battery?.voltage ?? 0)) *
            10,
        };
      },
      locale,
      {
        batteryThresholds: {
          warningVoltage: batteryReview.warningVoltage,
          criticalVoltage: batteryReview.criticalVoltage,
        },
      }
    ),
  ];

  return pruneOverlappingEvents(events);
}
