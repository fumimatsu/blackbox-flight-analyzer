import { getErrorMagnitude, getFlightStatusSummary } from "../derived/flightDerived.js";
import { EVENT_CONFIG, EVENT_TYPES } from "./eventConfig.js";

function finalizeSegment(events, type, config, start, end, samples) {
  if (start === null || end === null) {
    return;
  }
  const durationUs = end - start;
  if (durationUs < config.minDurationUs) {
    return;
  }
  const severity =
    samples.reduce((peak, sample) => Math.max(peak, sample.score ?? 0), 0) || durationUs;

  events.push({
    id: `${type}-${start}`,
    type,
    startUs: start,
    endUs: end,
    durationUs,
    severity,
    summary: samples[samples.length - 1]?.summary ?? type,
  });
}

function segmentByPredicate(samples, type, predicate) {
  const events = [];
  const config = EVENT_CONFIG[type];
  let currentStart = null;
  let currentSamples = [];

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const matches = predicate(sample, index, samples);

    if (matches) {
      currentStart ??= sample.timeUs;
      currentSamples.push(matches === true ? sample : { ...sample, ...matches });
      continue;
    }

    if (currentStart !== null) {
      finalizeSegment(events, type, config, currentStart, sample.timeUs, currentSamples);
      currentStart = null;
      currentSamples = [];
    }
  }

  if (currentStart !== null && currentSamples.length) {
    finalizeSegment(
      events,
      type,
      config,
      currentStart,
      currentSamples[currentSamples.length - 1].timeUs,
      currentSamples
    );
  }

  return events;
}

export function detectAnalysisEvents(windowSlice) {
  const samples = windowSlice.samples;
  if (!samples.length) {
    return [];
  }

  const derived = samples.map((sample, index) => {
    const previous = samples[index - 1];
    const status = getFlightStatusSummary(sample);
    return {
      ...sample,
      previousThrottle: previous?.rc.throttle ?? sample.rc.throttle,
      status,
      errorMagnitude: getErrorMagnitude(sample.error),
    };
  });

  return [
    ...segmentByPredicate(
      derived,
      EVENT_TYPES.HIGH_THROTTLE_STRAIGHT,
      (sample) =>
        sample.rc.throttle !== null &&
        sample.rc.roll !== null &&
        sample.rc.pitch !== null &&
        sample.rc.throttle >= 72 &&
        Math.abs(sample.rc.roll) < 12 &&
        Math.abs(sample.rc.pitch) < 12 && {
          score: sample.rc.throttle,
          summary: "High-throttle straight",
        }
    ),
    ...segmentByPredicate(
      derived,
      EVENT_TYPES.CHOP_TURN,
      (sample) =>
        sample.previousThrottle !== null &&
        sample.rc.throttle !== null &&
        sample.rc.roll !== null &&
        sample.rc.pitch !== null &&
        sample.rc.yaw !== null &&
        sample.previousThrottle >= 60 &&
        sample.rc.throttle <= 30 &&
        (Math.abs(sample.rc.roll) >= 18 ||
          Math.abs(sample.rc.pitch) >= 18 ||
          Math.abs(sample.rc.yaw) >= 18) && {
          score: Math.abs(sample.previousThrottle - sample.rc.throttle),
          summary: "Throttle chop + turn",
        }
    ),
    ...segmentByPredicate(
      derived,
      EVENT_TYPES.LOADED_ROLL_ARC,
      (sample) =>
        sample.rc.throttle !== null &&
        sample.setpoint.roll !== null &&
        sample.setpoint.pitch !== null &&
        sample.rc.throttle >= 35 &&
        Math.abs(sample.setpoint.roll) >= 180 &&
        Math.abs(sample.setpoint.pitch) <= 220 && {
          score: Math.abs(sample.setpoint.roll),
          summary: "Loaded roll arc",
        }
    ),
    ...segmentByPredicate(
      derived,
      EVENT_TYPES.HIGH_ERROR_BURST,
      (sample) =>
        sample.errorMagnitude !== null &&
        sample.errorMagnitude >= 90 && {
          score: sample.errorMagnitude,
          summary: "High error burst",
        }
    ),
    ...segmentByPredicate(
      derived,
      EVENT_TYPES.SATURATION_BURST,
      (sample) =>
        sample.status.saturation && {
          score: sample.status.motor.max,
          summary: "Motor saturation burst",
        }
    ),
  ].sort((left, right) => left.startUs - right.startUs);
}
