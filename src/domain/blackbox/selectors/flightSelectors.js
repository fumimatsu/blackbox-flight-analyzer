import { FlightLogParser } from "../../../vendor/log-core/flightlog_parser.js";

const AXES = ["roll", "pitch", "yaw"];
const AXIS_INDEX = { roll: 0, pitch: 1, yaw: 2 };
const THROTTLE_INDEX = 3;
const SAMPLE_LIMIT = 240;
const TIME_FIELD_INDEX = FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_TIME;

function resolveFieldIndex(session, candidates) {
  for (const candidate of candidates) {
    const index = session.fieldIndex[candidate];
    if (index !== undefined) {
      return index;
    }
  }
  return undefined;
}

function getValue(frame, index, fallback = null) {
  if (!frame || index === undefined || frame[index] === undefined || frame[index] === null) {
    return fallback;
  }
  return frame[index];
}

function isPresent(value) {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

function getModeNames(log, frame, session) {
  const flags = getValue(frame, session.fieldIndex.flightModeFlags, 0);
  const modeMap = log.getFlightMode(flags);
  return Object.entries(modeMap)
    .filter(([, active]) => Boolean(active))
    .map(([name]) => name);
}

function isArmedFrame(session, frame) {
  const flags = getValue(frame, session.fieldIndex.flightModeFlags, 0);
  const modeMap = session.log.getFlightMode(flags);
  return Boolean(modeMap.Arm);
}

function getAuxChannels(session, frame) {
  return session.fieldNames
    .filter((name) => /^rcData\[\d+\]$/.test(name))
    .map((name) => ({
      name,
      index: session.fieldIndex[name],
      channel: Number.parseInt(name.match(/\[(\d+)\]/)[1], 10),
    }))
    .filter((entry) => entry.channel >= 4)
    .slice(0, 6)
    .map((entry) => {
      const value = getValue(frame, entry.index);
      return {
        label: `AUX${entry.channel - 3}`,
        value,
        active: isPresent(value) ? value > 1500 : null,
      };
    });
}

function normalizeThrottle(log, raw) {
  if (!isPresent(raw)) {
    return null;
  }
  try {
    return log.rcCommandRawToThrottle(raw);
  } catch {
    return raw;
  }
}

function normalizeRawAxis(session, raw) {
  if (!isPresent(raw)) {
    return null;
  }
  const midrc = session.log.getSysConfig().midrc ?? 1500;
  return raw - midrc;
}

function normalizeRawThrottle(raw) {
  if (!isPresent(raw)) {
    return null;
  }
  return Math.max(0, Math.min(100, (raw - 1000) / 10));
}

function normalizeGyro(log, raw) {
  if (!isPresent(raw)) {
    return null;
  }
  try {
    return log.gyroRawToDegreesPerSecond(raw);
  } catch {
    return raw;
  }
}

function normalizeMotor(log, raw) {
  if (!isPresent(raw)) {
    return null;
  }
  try {
    return log.rcMotorRawToPctPhysical(raw);
  } catch {
    return raw;
  }
}

function getMotorValues(session, frame) {
  return Array.from({ length: session.numMotors || 4 }, (_, index) => {
    const fieldIndex = session.fieldIndex[`motor[${index}]`];
    return normalizeMotor(session.log, getValue(frame, fieldIndex));
  }).filter((value) => Number.isFinite(value));
}

function getRpmValues(session, frame) {
  return session.fieldNames
    .filter((name) => /^(eRPM|rpm)\[\d+\]$/.test(name))
    .slice(0, Math.max(session.numMotors, 4))
    .map((name) => getValue(frame, session.fieldIndex[name]))
    .filter((value) => Number.isFinite(value));
}

function getAxisValue(session, frame, axis, kind, derived = {}) {
  const axisIndex = AXIS_INDEX[axis];

  if (kind === "rc") {
    return getValue(
      frame,
      resolveFieldIndex(session, [`rcCommands[${axisIndex}]`, `rcCommand[${axisIndex}]`])
    );
  }

  if (kind === "setpoint") {
    return getValue(frame, resolveFieldIndex(session, [`setpoint[${axisIndex}]`]));
  }

  if (kind === "gyro") {
    return normalizeGyro(
      session.log,
      getValue(frame, resolveFieldIndex(session, [`gyroADC[${axisIndex}]`]))
    );
  }

  if (kind === "error") {
    const errorIndex = resolveFieldIndex(session, [`axisError[${axisIndex}]`]);
    if (errorIndex !== undefined) {
      return getValue(frame, errorIndex);
    }

    const setpoint = derived.setpoint?.[axis];
    const gyro = derived.gyro?.[axis];
    if (!isPresent(setpoint) || !isPresent(gyro)) {
      return null;
    }
    return setpoint - gyro;
  }

  return null;
}

function mapAxisValues(session, frame, kind) {
  const derived =
    kind === "error"
      ? {
          setpoint: mapAxisValues(session, frame, "setpoint"),
          gyro: mapAxisValues(session, frame, "gyro"),
        }
      : null;

  return AXES.reduce((result, axis) => {
    result[axis] = getAxisValue(session, frame, axis, kind, derived);
    return result;
  }, {});
}

function getThrottleValue(session, frame) {
  const normalizedIndex = resolveFieldIndex(session, [`rcCommands[${THROTTLE_INDEX}]`]);
  if (normalizedIndex !== undefined) {
    return getValue(frame, normalizedIndex);
  }

  const rawIndex = resolveFieldIndex(session, [`rcCommand[${THROTTLE_INDEX}]`]);
  return normalizeThrottle(session.log, getValue(frame, rawIndex));
}

function getRawRcValue(session, frame, axis) {
  const axisIndex = axis === "throttle" ? THROTTLE_INDEX : AXIS_INDEX[axis];
  const rawIndex = resolveFieldIndex(session, [`rcData[${axisIndex}]`]);
  if (rawIndex === undefined) {
    return null;
  }

  const raw = getValue(frame, rawIndex);

  if (axis === "throttle") {
    return normalizeRawThrottle(raw);
  }

  return normalizeRawAxis(session, raw);
}

export function clampTime(session, timeUs) {
  return Math.min(Math.max(timeUs, session.minTimeUs), session.maxTimeUs);
}

export function getFlightSnapshot(session, timeUs) {
  const clamped = clampTime(session, timeUs);
  const frameWindow = session.log.getCurrentFrameAtTime(clamped);
  const frame = frameWindow?.current ?? session.log.getSmoothedFrameAtTime(clamped);
  const modeNames = getModeNames(session.log, frame, session);

  return {
    timeUs: clamped,
    rcRaw: {
      roll: getRawRcValue(session, frame, "roll"),
      pitch: getRawRcValue(session, frame, "pitch"),
      yaw: getRawRcValue(session, frame, "yaw"),
      throttle: getRawRcValue(session, frame, "throttle"),
    },
    rc: {
      ...mapAxisValues(session, frame, "rc"),
      throttle: getThrottleValue(session, frame),
    },
    setpoint: mapAxisValues(session, frame, "setpoint"),
    gyro: mapAxisValues(session, frame, "gyro"),
    error: mapAxisValues(session, frame, "error"),
    motors: getMotorValues(session, frame),
    rpm: getRpmValues(session, frame),
    aux: getAuxChannels(session, frame),
    mode: {
      names: modeNames,
      armed: modeNames.includes("Arm"),
    },
    frame,
  };
}

export function getFirstArmedTimeUs(session) {
  const chunks = session.log.getSmoothedChunksInTimeRange(
    session.minTimeUs,
    session.maxTimeUs
  );

  for (const chunk of chunks) {
    for (const frame of chunk.frames) {
      if (isArmedFrame(session, frame)) {
        return frame[TIME_FIELD_INDEX];
      }
    }
  }

  return null;
}

function flattenChunks(chunks) {
  return chunks.flatMap((chunk) => chunk.frames);
}

function downsampleFrames(frames, limit) {
  if (frames.length <= limit) {
    return frames;
  }
  const step = Math.ceil(frames.length / limit);
  return frames.filter((_, index) => index % step === 0 || index === frames.length - 1);
}

export function getFlightWindow(session, startUs, endUs, limit = SAMPLE_LIMIT) {
  const windowStart = clampTime(session, Math.min(startUs, endUs));
  const windowEnd = clampTime(session, Math.max(startUs, endUs));
  const frames = downsampleFrames(
    flattenChunks(session.log.getSmoothedChunksInTimeRange(windowStart, windowEnd)),
    limit
  ).filter(
    (frame) =>
      frame[TIME_FIELD_INDEX] >= windowStart && frame[TIME_FIELD_INDEX] <= windowEnd
  );

  return {
    startUs: windowStart,
    endUs: windowEnd,
    samples: frames.map((frame) => ({
      timeUs: frame[TIME_FIELD_INDEX],
      rcRaw: {
        roll: getRawRcValue(session, frame, "roll"),
        pitch: getRawRcValue(session, frame, "pitch"),
        yaw: getRawRcValue(session, frame, "yaw"),
        throttle: getRawRcValue(session, frame, "throttle"),
      },
      rc: {
        ...mapAxisValues(session, frame, "rc"),
        throttle: getThrottleValue(session, frame),
      },
      setpoint: mapAxisValues(session, frame, "setpoint"),
      gyro: mapAxisValues(session, frame, "gyro"),
      error: mapAxisValues(session, frame, "error"),
      motors: getMotorValues(session, frame),
      rpm: getRpmValues(session, frame),
      aux: getAuxChannels(session, frame),
    })),
  };
}
