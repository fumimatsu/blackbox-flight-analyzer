import { translate } from "../../../i18n/index.js";

export const EVENT_TYPES = {
  HIGH_THROTTLE_STRAIGHT: "high-throttle-straight",
  CHOP_TURN: "chop-turn",
  LOADED_ROLL_ARC: "loaded-roll-arc",
  HIGH_ERROR_BURST: "high-error-burst",
  SATURATION_BURST: "saturation-burst",
  BATTERY_WARNING: "battery-warning",
  BATTERY_CRITICAL: "battery-critical",
};

export const EVENT_CONFIG = {
  [EVENT_TYPES.HIGH_THROTTLE_STRAIGHT]: {
    minDurationUs: 350000,
    maxGapUs: 100000,
    priority: 1,
    labelKey: "events.highThrottleStraight",
    reviewReasonKey: "events.highThrottleStraightReason",
  },
  [EVENT_TYPES.CHOP_TURN]: {
    minDurationUs: 220000,
    maxGapUs: 80000,
    priority: 2,
    labelKey: "events.chopTurn",
    reviewReasonKey: "events.chopTurnReason",
  },
  [EVENT_TYPES.LOADED_ROLL_ARC]: {
    minDurationUs: 260000,
    maxGapUs: 90000,
    priority: 2,
    labelKey: "events.loadedRollArc",
    reviewReasonKey: "events.loadedRollArcReason",
  },
  [EVENT_TYPES.HIGH_ERROR_BURST]: {
    minDurationUs: 180000,
    maxGapUs: 60000,
    priority: 3,
    labelKey: "events.highErrorBurst",
    reviewReasonKey: "events.highErrorBurstReason",
  },
  [EVENT_TYPES.SATURATION_BURST]: {
    minDurationUs: 160000,
    maxGapUs: 50000,
    priority: 3,
    labelKey: "events.saturationBurst",
    reviewReasonKey: "events.saturationBurstReason",
  },
  [EVENT_TYPES.BATTERY_WARNING]: {
    minDurationUs: 250000,
    maxGapUs: 120000,
    priority: 1,
    labelKey: "events.batteryWarning",
    reviewReasonKey: "events.batteryWarningReason",
  },
  [EVENT_TYPES.BATTERY_CRITICAL]: {
    minDurationUs: 250000,
    maxGapUs: 80000,
    priority: 4,
    labelKey: "events.batteryCritical",
    reviewReasonKey: "events.batteryCriticalReason",
  },
};

export function getEventLabel(type, locale = "en") {
  const config = EVENT_CONFIG[type];
  return config ? translate(locale, config.labelKey) : type;
}
