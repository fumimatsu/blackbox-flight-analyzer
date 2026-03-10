export const EVENT_TYPES = {
  HIGH_THROTTLE_STRAIGHT: "high-throttle-straight",
  CHOP_TURN: "chop-turn",
  LOADED_ROLL_ARC: "loaded-roll-arc",
  HIGH_ERROR_BURST: "high-error-burst",
  SATURATION_BURST: "saturation-burst",
};

export const EVENT_CONFIG = {
  [EVENT_TYPES.HIGH_THROTTLE_STRAIGHT]: { minDurationUs: 350000 },
  [EVENT_TYPES.CHOP_TURN]: { minDurationUs: 250000 },
  [EVENT_TYPES.LOADED_ROLL_ARC]: { minDurationUs: 300000 },
  [EVENT_TYPES.HIGH_ERROR_BURST]: { minDurationUs: 150000 },
  [EVENT_TYPES.SATURATION_BURST]: { minDurationUs: 120000 },
};
