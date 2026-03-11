export const EVENT_TYPES = {
  HIGH_THROTTLE_STRAIGHT: "high-throttle-straight",
  CHOP_TURN: "chop-turn",
  LOADED_ROLL_ARC: "loaded-roll-arc",
  HIGH_ERROR_BURST: "high-error-burst",
  SATURATION_BURST: "saturation-burst",
};

export const EVENT_CONFIG = {
  [EVENT_TYPES.HIGH_THROTTLE_STRAIGHT]: {
    minDurationUs: 350000,
    maxGapUs: 100000,
    priority: 1,
    label: "High-throttle straight",
    reviewReason: "Useful for checking tracking and smoothness when pilot input is low.",
  },
  [EVENT_TYPES.CHOP_TURN]: {
    minDurationUs: 220000,
    maxGapUs: 80000,
    priority: 2,
    label: "Throttle chop + turn",
    reviewReason: "Useful for spotting instability when throttle drops into a turn.",
  },
  [EVENT_TYPES.LOADED_ROLL_ARC]: {
    minDurationUs: 260000,
    maxGapUs: 90000,
    priority: 2,
    label: "Loaded roll arc",
    reviewReason: "Useful for checking loaded-turn tracking under sustained roll demand.",
  },
  [EVENT_TYPES.HIGH_ERROR_BURST]: {
    minDurationUs: 180000,
    maxGapUs: 60000,
    priority: 3,
    label: "Tracking-off burst",
    reviewReason: "Useful when tracking error spikes without obvious motor saturation.",
  },
  [EVENT_TYPES.SATURATION_BURST]: {
    minDurationUs: 160000,
    maxGapUs: 50000,
    priority: 3,
    label: "Headroom-limited burst",
    reviewReason: "Useful for locating moments where motors appear to max out.",
  },
};

export function getEventLabel(type) {
  return EVENT_CONFIG[type]?.label ?? type;
}
