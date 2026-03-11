import { getErrorMagnitude, getFlightStatusSummary } from "../blackbox/derived/flightDerived.js";
import { EVENT_TYPES } from "../blackbox/events/eventConfig.js";

const OFFICIAL_SOURCES = {
  freestyle: "https://www.betaflight.com/docs/wiki/guides/current/Freestyle-Tuning-Principles",
  tuning43: "https://www.betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes",
  tuning42: "https://www.betaflight.com/docs/wiki/tuning/4-2-Tuning-Notes",
};

function mean(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values) {
  if (!values.length) {
    return null;
  }
  return Math.max(...values);
}

function buildEvidence(flight) {
  const samples = flight?.window?.samples ?? [];
  const events = flight?.events ?? [];

  const statuses = samples.map((sample) => getFlightStatusSummary(sample));
  const errorMagnitudes = samples
    .map((sample) => getErrorMagnitude(sample.error))
    .filter((value) => value !== null);
  const lowThrottleErrors = samples
    .filter((sample) => sample.rc.throttle !== null && sample.rc.throttle <= 20)
    .map((sample) => getErrorMagnitude(sample.error))
    .filter((value) => value !== null);
  const motorPeaks = statuses
    .map((status) => status.motor.max)
    .filter((value) => value !== null);

  return {
    samples,
    events,
    totalSamples: samples.length,
    eventCounts: events.reduce((counts, event) => {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      return counts;
    }, {}),
    saturationShare:
      statuses.filter((status) => status.saturation).length / Math.max(statuses.length, 1),
    lowThrottleErrorMean: mean(lowThrottleErrors),
    peakError: max(errorMagnitudes),
    peakMotor: max(motorPeaks),
  };
}

function confidenceLabel(score) {
  if (score >= 0.75) {
    return "medium";
  }
  return "low";
}

export const DIAGNOSTIC_RULES = [
  {
    id: "headroom-limited",
    label: "Headroom limitation likely",
    eventTypes: [EVENT_TYPES.SATURATION_BURST, EVENT_TYPES.LOADED_ROLL_ARC],
    predicate(evidence) {
      return (
        (evidence.eventCounts[EVENT_TYPES.SATURATION_BURST] ?? 0) >= 1 &&
        evidence.saturationShare >= 0.06 &&
        (evidence.peakMotor ?? 0) >= 95
      );
    },
    evidenceSummary(evidence) {
      return `Consistent with repeated headroom-limited output. Saturation share ${(
        evidence.saturationShare * 100
      ).toFixed(1)}%, peak motor ${Math.round(evidence.peakMotor ?? 0)}%.`;
    },
    likelyChecks: [
      "Check whether the move is power-limited before assuming a PID/filter issue.",
      "Check prop / motor / weight / throttle cap headroom on the affected build.",
      "If this shows up only in specific loaded turns, compare the same event after setup changes.",
    ],
    confidence(evidence) {
      const score = Math.min(
        1,
        evidence.saturationShare * 4 +
          ((evidence.eventCounts[EVENT_TYPES.SATURATION_BURST] ?? 0) >= 2 ? 0.25 : 0.1)
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.freestyle],
  },
  {
    id: "low-throttle-instability",
    label: "Low-throttle instability worth checking",
    eventTypes: [EVENT_TYPES.CHOP_TURN, EVENT_TYPES.HIGH_ERROR_BURST],
    predicate(evidence) {
      return (
        (evidence.eventCounts[EVENT_TYPES.CHOP_TURN] ?? 0) >= 1 &&
        (evidence.eventCounts[EVENT_TYPES.HIGH_ERROR_BURST] ?? 0) >= 1 &&
        evidence.saturationShare < 0.05 &&
        (evidence.lowThrottleErrorMean ?? 0) >= 75
      );
    },
    evidenceSummary(evidence) {
      return `Consistent with instability after throttle reduction. Mean low-throttle error ${(
        evidence.lowThrottleErrorMean ?? 0
      ).toFixed(1)}°/s with little saturation.`;
    },
    likelyChecks: [
      "Check D-term authority versus filter delay if chops and low-throttle turns look messy.",
      "Check RPM / dynamic notch setup if noise control still forces high filter delay.",
      "Check low-throttle motor behavior and dynamic idle before making large PID changes.",
    ],
    confidence(evidence) {
      const score = Math.min(
        1,
        ((evidence.lowThrottleErrorMean ?? 0) / 140) +
          ((evidence.eventCounts[EVENT_TYPES.CHOP_TURN] ?? 0) >= 2 ? 0.2 : 0.1)
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.freestyle, OFFICIAL_SOURCES.tuning42],
  },
];

export function evaluateDiagnosticRules(flight) {
  if (!flight?.window?.samples?.length) {
    return [];
  }

  const evidence = buildEvidence(flight);

  return DIAGNOSTIC_RULES.filter((rule) => rule.predicate(evidence)).map((rule) => ({
    id: rule.id,
    label: rule.label,
    eventTypes: rule.eventTypes,
    confidence: rule.confidence(evidence),
    evidenceSummary: rule.evidenceSummary(evidence),
    likelyChecks: rule.likelyChecks,
    officialSources: rule.officialSources,
  }));
}
