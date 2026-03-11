import {
  getErrorMagnitude,
  getFlightStatusSummary,
  getLowThrottleReviewSummary,
} from "../blackbox/derived/flightDerived.js";
import { EVENT_TYPES } from "../blackbox/events/eventConfig.js";
import { translate } from "../../i18n/index.js";
import { getStickIntentReviewSummary } from "./stickIntentReview.js";

const OFFICIAL_SOURCES = {
  freestyle: "https://www.betaflight.com/docs/wiki/guides/current/Freestyle-Tuning-Principles",
  tuning43: "https://www.betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes",
  tuning42: "https://www.betaflight.com/docs/wiki/tuning/4-2-Tuning-Notes",
  rxNotes: "https://www.betaflight.com/docs/development/Rx",
  pidTab: "https://betaflight.com/docs/wiki/configurator/pid-tuning-tab",
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

function buildEvidence(flight, locale) {
  const samples = flight?.window?.samples ?? [];
  const events = flight?.events ?? [];
  const setupSummary = flight?.setupSummary ?? null;

  const statuses = samples.map((sample) => getFlightStatusSummary(sample, locale));
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
  const lowThrottleSummary = getLowThrottleReviewSummary(samples);
  const stickIntentSummary = getStickIntentReviewSummary(samples, setupSummary);
  const dynamicIdleItem = setupSummary?.groups
    ?.find((group) => group.key === "idleThrottle")
    ?.items?.find((item) => item.key === "dynamicIdleMinRpm");

  return {
    samples,
    events,
    setupSummary,
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
    lowThrottleSummary,
    stickIntentSummary,
    dynamicIdleConfigured: dynamicIdleItem?.value ?? null,
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
    labelKey: "diagnostics.headroomLabel",
    eventTypes: [EVENT_TYPES.SATURATION_BURST, EVENT_TYPES.LOADED_ROLL_ARC],
    predicate(evidence) {
      return (
        (evidence.eventCounts[EVENT_TYPES.SATURATION_BURST] ?? 0) >= 1 &&
        evidence.saturationShare >= 0.06 &&
        (evidence.peakMotor ?? 0) >= 95
      );
    },
    evidenceSummary(evidence, locale) {
      return translate(locale, "diagnostics.headroomEvidence", {
        share: (evidence.saturationShare * 100).toFixed(1),
        peak: Math.round(evidence.peakMotor ?? 0),
      });
    },
    likelyCheckKeys: [
      "diagnostics.headroomCheck1",
      "diagnostics.headroomCheck2",
      "diagnostics.headroomCheck3",
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
    labelKey: "diagnostics.lowThrottleLabel",
    eventTypes: [EVENT_TYPES.CHOP_TURN, EVENT_TYPES.HIGH_ERROR_BURST],
    predicate(evidence) {
      return (
        (evidence.eventCounts[EVENT_TYPES.CHOP_TURN] ?? 0) >= 1 &&
        (evidence.eventCounts[EVENT_TYPES.HIGH_ERROR_BURST] ?? 0) >= 1 &&
        evidence.saturationShare < 0.05 &&
        (evidence.lowThrottleErrorMean ?? 0) >= 75
      );
    },
    evidenceSummary(evidence, locale) {
      if (!evidence.lowThrottleSummary.hasRpmData) {
        return translate(locale, "diagnostics.lowThrottleEvidenceNoRpm", {
          value: (evidence.lowThrottleErrorMean ?? 0).toFixed(1),
          recovery: Math.round(evidence.lowThrottleSummary.recoveryTimeMs ?? 0),
        });
      }

      return translate(locale, "diagnostics.lowThrottleEvidence", {
        value: (evidence.lowThrottleErrorMean ?? 0).toFixed(1),
        rpmFloor: Math.round(evidence.lowThrottleSummary.rpmFloorMin ?? 0),
        recovery: Math.round(evidence.lowThrottleSummary.recoveryTimeMs ?? 0),
      });
    },
    likelyCheckKeys: [
      "diagnostics.lowThrottleCheck1",
      "diagnostics.lowThrottleCheck2",
      "diagnostics.lowThrottleCheck3",
    ],
    confidence(evidence) {
      const score = Math.min(
        1,
        ((evidence.lowThrottleErrorMean ?? 0) / 140) +
          ((evidence.lowThrottleSummary.recoveryTimeMs ?? 0) / 350) +
          ((evidence.eventCounts[EVENT_TYPES.CHOP_TURN] ?? 0) >= 2 ? 0.2 : 0.1)
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.freestyle, OFFICIAL_SOURCES.tuning42],
  },
  {
    id: "low-throttle-authority",
    labelKey: "diagnostics.lowThrottleAuthorityLabel",
    eventTypes: [EVENT_TYPES.CHOP_TURN, EVENT_TYPES.HIGH_ERROR_BURST],
    predicate(evidence) {
      return (
        (evidence.eventCounts[EVENT_TYPES.CHOP_TURN] ?? 0) >= 1 &&
        evidence.saturationShare < 0.08 &&
        evidence.lowThrottleSummary.lowThrottleSamples >= 3 &&
        (
          (evidence.lowThrottleSummary.hasRpmData &&
            (evidence.lowThrottleSummary.rpmFloorMin ?? Infinity) <= 1000 &&
            (evidence.lowThrottleSummary.recoveryTimeMs ?? 0) >= 120) ||
          (!evidence.lowThrottleSummary.hasRpmData &&
            (evidence.lowThrottleSummary.recoveryErrorPeak ?? 0) >= 110)
        )
      );
    },
    evidenceSummary(evidence, locale) {
      const dynamicIdleState = evidence.dynamicIdleConfigured
        ? translate(locale, "diagnostics.dynamicIdleConfigured", {
            value: evidence.dynamicIdleConfigured,
          })
        : translate(locale, "diagnostics.dynamicIdleUnknown");

      if (!evidence.lowThrottleSummary.hasRpmData) {
        return translate(locale, "diagnostics.lowThrottleAuthorityEvidenceNoRpm", {
          recovery: Math.round(evidence.lowThrottleSummary.recoveryTimeMs ?? 0),
          errorPeak: Math.round(evidence.lowThrottleSummary.recoveryErrorPeak ?? 0),
          dynamicIdle: dynamicIdleState,
        });
      }

      return translate(locale, "diagnostics.lowThrottleAuthorityEvidence", {
        rpmFloor: Math.round(evidence.lowThrottleSummary.rpmFloorMin ?? 0),
        recovery: Math.round(evidence.lowThrottleSummary.recoveryTimeMs ?? 0),
        dynamicIdle: dynamicIdleState,
      });
    },
    likelyCheckKeys: [
      "diagnostics.lowThrottleAuthorityCheck1",
      "diagnostics.lowThrottleAuthorityCheck2",
      "diagnostics.lowThrottleAuthorityCheck3",
    ],
    confidence(evidence) {
      const score = Math.min(
        1,
        ((evidence.lowThrottleSummary.recoveryTimeMs ?? 0) / 260) +
          (
            evidence.lowThrottleSummary.hasRpmData
              ? Math.max(0, (1200 - (evidence.lowThrottleSummary.rpmFloorMin ?? 1200)) / 400)
              : Math.max(0, (evidence.lowThrottleSummary.recoveryErrorPeak ?? 0) / 180)
          )
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.freestyle, OFFICIAL_SOURCES.tuning43],
  },
  {
    id: "stick-side-command-shaping",
    labelKey: "diagnostics.stickSideLabel",
    eventTypes: [
      EVENT_TYPES.HIGH_THROTTLE_STRAIGHT,
      EVENT_TYPES.LOADED_ROLL_ARC,
      EVENT_TYPES.HIGH_ERROR_BURST,
    ],
    predicate(evidence) {
      const primaryAxis = evidence.stickIntentSummary.primaryAxis;
      if (!primaryAxis) {
        return false;
      }

      return (
        evidence.saturationShare < 0.08 &&
        (
          (primaryAxis.rcSetpointDeltaGapMean ?? 0) >= 14 ||
          (primaryAxis.heldInputShare ?? 0) >= 0.24 ||
          (primaryAxis.rawCommandGapMean ?? 0) >= 18
        )
      );
    },
    evidenceSummary(evidence, locale) {
      const axis = evidence.stickIntentSummary.primaryAxis;
      const smoothingState = evidence.stickIntentSummary.configuration.rcSmoothing
        ? translate(locale, "diagnostics.stickSideConfig", {
            value: evidence.stickIntentSummary.configuration.rcSmoothing,
          })
        : translate(locale, "diagnostics.stickSideNoConfig");

      return translate(locale, "diagnostics.stickSideEvidence", {
        axis: translate(locale, `overlay.${axis.axis}`),
        rcGap: (axis.rcSetpointGapPeak ?? 0).toFixed(0),
        deltaGap: (axis.rcSetpointDeltaGapMean ?? 0).toFixed(1),
        held: Math.round((axis.heldInputShare ?? 0) * 100),
        smoothing: smoothingState,
      });
    },
    likelyCheckKeys: [
      "diagnostics.stickSideCheck1",
      "diagnostics.stickSideCheck2",
      "diagnostics.stickSideCheck3",
    ],
    confidence(evidence) {
      const axis = evidence.stickIntentSummary.primaryAxis;
      const score = Math.min(
        1,
        ((axis.rcSetpointDeltaGapMean ?? 0) / 28) +
          ((axis.heldInputShare ?? 0) * 1.2) +
          ((axis.rawCommandGapMean ?? 0) / 60)
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.tuning43, OFFICIAL_SOURCES.pidTab],
  },
  {
    id: "rc-link-quality",
    labelKey: "diagnostics.rcLinkLabel",
    eventTypes: [EVENT_TYPES.HIGH_THROTTLE_STRAIGHT, EVENT_TYPES.HIGH_ERROR_BURST],
    predicate(evidence) {
      const linkQuality = evidence.stickIntentSummary.debug?.linkQualityAvg;
      return linkQuality !== null && linkQuality !== undefined && linkQuality < 95;
    },
    evidenceSummary(evidence, locale) {
      return translate(locale, "diagnostics.rcLinkEvidence", {
        mode: evidence.stickIntentSummary.debug?.mode ?? "debug",
        lq: Math.round(evidence.stickIntentSummary.debug?.linkQualityAvg ?? 0),
      });
    },
    likelyCheckKeys: [
      "diagnostics.rcLinkCheck1",
      "diagnostics.rcLinkCheck2",
      "diagnostics.rcLinkCheck3",
    ],
    confidence(evidence) {
      const score = Math.min(
        1,
        Math.max(0, (100 - (evidence.stickIntentSummary.debug?.linkQualityAvg ?? 100)) / 12)
      );
      return confidenceLabel(score);
    },
    officialSources: [OFFICIAL_SOURCES.tuning43, OFFICIAL_SOURCES.rxNotes],
  },
];

export function evaluateDiagnosticRules(flight, locale = "en") {
  if (!flight?.window?.samples?.length) {
    return [];
  }

  const evidence = buildEvidence(flight, locale);

  return DIAGNOSTIC_RULES.filter((rule) => rule.predicate(evidence)).map((rule) => ({
    id: rule.id,
    label: translate(locale, rule.labelKey),
    eventTypes: rule.eventTypes,
    confidence: translate(locale, `diagnostics.confidence${rule.confidence(evidence).replace(/^./, (value) => value.toUpperCase())}`),
    evidenceSummary: rule.evidenceSummary(evidence, locale),
    likelyChecks: rule.likelyCheckKeys.map((key) => translate(locale, key)),
    officialSources: rule.officialSources,
  }));
}
