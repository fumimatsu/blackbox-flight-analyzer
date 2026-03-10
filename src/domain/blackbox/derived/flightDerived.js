export function getThrottleBand(throttle) {
  if (throttle >= 80) return "high";
  if (throttle >= 55) return "mid-high";
  if (throttle >= 30) return "mid";
  if (throttle > 5) return "low";
  return "idle";
}

export function getMotorStats(motors) {
  if (!motors.length) {
    return { min: 0, max: 0, spread: 0, avg: 0 };
  }
  const min = Math.min(...motors);
  const max = Math.max(...motors);
  const avg = motors.reduce((sum, value) => sum + value, 0) / motors.length;
  return { min, max, spread: max - min, avg };
}

export function getRpmStats(rpm) {
  if (!rpm.length) {
    return { max: 0, avg: 0 };
  }
  return {
    max: Math.max(...rpm),
    avg: rpm.reduce((sum, value) => sum + value, 0) / rpm.length,
  };
}

export function getSaturationFlag(snapshot) {
  const motorStats = getMotorStats(snapshot.motors);
  return motorStats.max >= 95 || motorStats.spread >= 35;
}

export function getErrorMagnitude(error) {
  return Math.max(
    Math.abs(error.roll ?? 0),
    Math.abs(error.pitch ?? 0),
    Math.abs(error.yaw ?? 0)
  );
}

export function getFlightStatusSummary(snapshot) {
  const throttleBand = getThrottleBand(snapshot.rc.throttle);
  const saturation = getSaturationFlag(snapshot);
  const errorMagnitude = getErrorMagnitude(snapshot.error);

  let label = "Settled";
  if (saturation) label = "Headroom limited";
  else if (errorMagnitude >= 120) label = "Tracking off";
  else if (throttleBand === "high") label = "High-speed run";
  else if (throttleBand === "idle") label = "Throttle off";

  return {
    label,
    throttleBand,
    saturation,
    errorMagnitude,
    motor: getMotorStats(snapshot.motors),
    rpm: getRpmStats(snapshot.rpm),
  };
}
