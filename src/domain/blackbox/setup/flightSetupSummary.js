import {
  FAST_PROTOCOL,
  FF_AVERAGING,
  RATES_TYPE,
  THROTTLE_LIMIT_TYPE,
} from "../../../vendor/log-core/flightlog_fielddefs.js";

const FIRMWARE_TYPES = {
  1: "Baseflight",
  2: "Cleanflight",
  3: "Betaflight",
  4: "INAV",
};

function isPresent(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "number") {
    return !Number.isNaN(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => isPresent(item));
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function pickFirst(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (isPresent(value)) {
      return value;
    }
  }
  return null;
}

function formatNumber(value, digits = 0, suffix = "") {
  if (!isPresent(value)) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return `${Number(value).toFixed(digits).replace(/\.0+$/, "")}${suffix}`;
}

function formatTriplet(values, digits = 0, suffix = "") {
  if (!Array.isArray(values) || !values.slice(0, 3).some((value) => isPresent(value))) {
    return null;
  }

  return values
    .slice(0, 3)
    .map((value) => (isPresent(value) ? formatNumber(value, digits, suffix) : "—"))
    .join(" / ");
}

function formatPidAxis(values) {
  if (!Array.isArray(values) || !values.slice(0, 3).some((value) => isPresent(value))) {
    return null;
  }

  return values
    .slice(0, 3)
    .map((value) => (isPresent(value) ? formatNumber(value) : "—"))
    .join(" / ");
}

function formatDMin(sysConfig) {
  const explicit = pickFirst(sysConfig, ["d_min"]);
  if (Array.isArray(explicit) && explicit.some((value) => isPresent(value))) {
    return formatTriplet(explicit);
  }

  const roll = sysConfig?.rollPID?.[3];
  const pitch = sysConfig?.pitchPID?.[3];
  const yaw = sysConfig?.yawPID?.[3];
  if ([roll, pitch, yaw].some((value) => isPresent(value))) {
    return formatTriplet([roll, pitch, yaw]);
  }

  return null;
}

function enumLabel(value, options) {
  if (!isPresent(value)) {
    return null;
  }

  if (typeof value === "number" && options[value]) {
    return options[value];
  }

  return String(value);
}

function joinBits(parts) {
  const values = parts.filter(Boolean);
  return values.length ? values.join(" · ") : null;
}

function formatLpf(valueA, valueB) {
  return joinBits([
    isPresent(valueA) ? `L1 ${formatNumber(valueA, 0, "Hz")}` : null,
    isPresent(valueB) ? `L2 ${formatNumber(valueB, 0, "Hz")}` : null,
  ]);
}

function formatRpmFilter(sysConfig) {
  const harmonics = pickFirst(sysConfig, ["gyro_rpm_notch_harmonics", "rpm_filter_harmonics"]);
  const minHz = pickFirst(sysConfig, ["gyro_rpm_notch_min", "rpm_filter_min_hz"]);
  const q = pickFirst(sysConfig, ["gyro_rpm_notch_q", "rpm_filter_q"]);
  const fade = pickFirst(sysConfig, ["rpm_filter_fade_range_hz"]);

  return joinBits([
    isPresent(harmonics) ? `${formatNumber(harmonics)} harm` : null,
    isPresent(minHz) ? `min ${formatNumber(minHz, 0, "Hz")}` : null,
    isPresent(q) ? `Q ${formatNumber(q)}` : null,
    isPresent(fade) ? `fade ${formatNumber(fade, 0, "Hz")}` : null,
  ]);
}

function formatDynamicNotch(sysConfig) {
  const count = pickFirst(sysConfig, ["dyn_notch_count"]);
  const minHz = pickFirst(sysConfig, ["dyn_notch_min_hz"]);
  const maxHz = pickFirst(sysConfig, ["dyn_notch_max_hz"]);
  const q = pickFirst(sysConfig, ["dyn_notch_q"]);

  return joinBits([
    isPresent(count) ? `${formatNumber(count)} notch` : null,
    isPresent(minHz) || isPresent(maxHz)
      ? `${formatNumber(minHz, 0, "Hz") ?? "—"}-${formatNumber(maxHz, 0, "Hz") ?? "—"}`
      : null,
    isPresent(q) ? `Q ${formatNumber(q)}` : null,
  ]);
}

function formatRcSmoothing(sysConfig) {
  const mode = enumLabel(
    pickFirst(sysConfig, ["rc_smoothing_mode", "rc_smoothing"]),
    ["Off", "On"]
  );
  const autoFactor = pickFirst(sysConfig, [
    "rc_smoothing_auto_factor_setpoint",
    "rc_smoothing_auto_factor",
  ]);

  return joinBits([
    mode,
    isPresent(autoFactor) ? `auto ${formatNumber(autoFactor)}` : null,
  ]);
}

function formatRcSmoothingCutoffs(sysConfig) {
  const feedforwardHz = pickFirst(sysConfig, [
    "rc_smoothing_feedforward_hz",
    "rc_smoothing_feedforward_cutoff",
  ]);
  const setpointHz = pickFirst(sysConfig, [
    "rc_smoothing_setpoint_hz",
    "rc_smoothing_setpoint_cutoff",
  ]);
  const throttleHz = pickFirst(sysConfig, [
    "rc_smoothing_throttle_hz",
    "rc_smoothing_throttle_cutoff",
  ]);

  return joinBits([
    isPresent(feedforwardHz) ? `FF ${formatNumber(feedforwardHz, 0, "Hz")}` : null,
    isPresent(setpointHz) ? `SP ${formatNumber(setpointHz, 0, "Hz")}` : null,
    isPresent(throttleHz) ? `Thr ${formatNumber(throttleHz, 0, "Hz")}` : null,
  ]);
}

function formatFeedforward(sysConfig) {
  const transition = pickFirst(sysConfig, ["ff_transition", "feedforward_transition"]);
  const boost = pickFirst(sysConfig, ["ff_boost", "feedforward_boost"]);
  const weight = pickFirst(sysConfig, ["dtermSetpointWeight", "ff_weight", "feedforward_weight"]);

  return joinBits([
    isPresent(transition) ? `trans ${formatNumber(transition)}` : null,
    isPresent(boost) ? `boost ${formatNumber(boost)}` : null,
    isPresent(weight) ? `wt ${formatNumber(weight)}` : null,
  ]);
}

function formatAntiGravity(sysConfig) {
  const gain = pickFirst(sysConfig, ["anti_gravity_gain"]);
  const mode = pickFirst(sysConfig, ["anti_gravity_mode"]);
  const threshold = pickFirst(sysConfig, ["anti_gravity_threshold", "anti_gravity_thresh"]);

  return joinBits([
    isPresent(gain) ? `gain ${formatNumber(gain)}` : null,
    isPresent(mode) ? `mode ${formatNumber(mode)}` : null,
    isPresent(threshold) ? `thr ${formatNumber(threshold)}` : null,
  ]);
}

function formatThrottleLimit(sysConfig) {
  const type = enumLabel(pickFirst(sysConfig, ["throttle_limit_type"]), THROTTLE_LIMIT_TYPE);
  const percent = pickFirst(sysConfig, ["throttle_limit_percent"]);

  return joinBits([
    type && type !== "OFF" ? type : null,
    isPresent(percent) ? formatNumber(percent, 0, "%") : null,
  ]) ?? type;
}

function formatTpa(sysConfig) {
  const rate = pickFirst(sysConfig, ["tpa_rate"]);
  const breakpoint = pickFirst(sysConfig, ["tpa_breakpoint"]);
  const lowRate = pickFirst(sysConfig, ["tpa_low_rate"]);
  const lowBreakpoint = pickFirst(sysConfig, ["tpa_low_breakpoint"]);

  return joinBits([
    isPresent(rate) || isPresent(breakpoint)
      ? `${formatNumber(rate) ?? "—"} @ ${formatNumber(breakpoint)}`
      : null,
    isPresent(lowRate) || isPresent(lowBreakpoint)
      ? `low ${formatNumber(lowRate) ?? "—"} @ ${formatNumber(lowBreakpoint)}`
      : null,
  ]);
}

function formatFirmware(sysConfig) {
  const type = FIRMWARE_TYPES[sysConfig?.firmwareType] ?? "Flight controller";
  const version = isPresent(sysConfig?.firmwareVersion) ? String(sysConfig.firmwareVersion) : null;

  return {
    type,
    version,
    display: version ? `${type} ${version}` : type,
  };
}

function normalizeCellVoltage(raw) {
  if (!isPresent(raw)) {
    return null;
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric >= 100) {
    return numeric / 100;
  }

  return numeric / 10;
}

function getBatteryConfig(sysConfig, session) {
  const minCellVoltage = pickFirst(sysConfig, ["vbatmincellvoltage"]);
  const warningCellVoltage = pickFirst(sysConfig, ["vbatwarningcellvoltage"]);
  const maxCellVoltage = pickFirst(sysConfig, ["vbatmaxcellvoltage"]);
  const sagCompensation = pickFirst(sysConfig, ["vbat_sag_compensation"]);
  const cellCountEstimate = session?.log?.getNumCellsEstimate?.() ?? null;

  if (
    !isPresent(minCellVoltage) &&
    !isPresent(warningCellVoltage) &&
    !isPresent(maxCellVoltage) &&
    !isPresent(sagCompensation)
  ) {
    return null;
  }

  return {
    minCellVoltage: normalizeCellVoltage(minCellVoltage),
    warningCellVoltage: normalizeCellVoltage(warningCellVoltage),
    maxCellVoltage: normalizeCellVoltage(maxCellVoltage),
    sagCompensation: isPresent(sagCompensation) ? Number(sagCompensation) : null,
    cellCountEstimate: isPresent(cellCountEstimate) ? Number(cellCountEstimate) : null,
  };
}

function makeItem(key, value, rawValue = value) {
  if (!isPresent(value)) {
    return null;
  }
  return { key, value: String(value), rawValue };
}

function buildGroup(key, items) {
  const visibleItems = items.filter(Boolean);
  return {
    key,
    items: visibleItems,
    hasData: visibleItems.length > 0,
  };
}

export function getFlightSetupSummary(session) {
  const sysConfig = session?.log?.getSysConfig?.();

  if (!sysConfig) {
    return {
      firmware: null,
      groups: [],
      hasData: false,
    };
  }

  const groups = [
    buildGroup("pid", [
      makeItem("rollPid", formatPidAxis(sysConfig.rollPID), sysConfig.rollPID?.slice(0, 3)),
      makeItem("pitchPid", formatPidAxis(sysConfig.pitchPID), sysConfig.pitchPID?.slice(0, 3)),
      makeItem("yawPid", formatPidAxis(sysConfig.yawPID), sysConfig.yawPID?.slice(0, 3)),
      makeItem("dMin", formatDMin(sysConfig)),
    ]),
    buildGroup("filters", [
      makeItem(
        "gyroLpf",
        formatLpf(
          pickFirst(sysConfig, ["gyro_lowpass_hz", "gyro_soft_hz"]),
          pickFirst(sysConfig, ["gyro_lowpass2_hz", "gyro_soft2_hz"])
        )
      ),
      makeItem(
        "dtermLpf",
        formatLpf(
          pickFirst(sysConfig, ["dterm_lpf1_static_hz", "dterm_lpf_hz"]),
          pickFirst(sysConfig, ["dterm_lpf2_static_hz", "dterm_lpf2_hz"])
        )
      ),
      makeItem("rpmFilter", formatRpmFilter(sysConfig)),
      makeItem("dynamicNotch", formatDynamicNotch(sysConfig)),
      makeItem(
        "pidLoop",
        isPresent(sysConfig.pid_process_denom)
          ? `x${formatNumber(sysConfig.pid_process_denom)}`
          : null,
        sysConfig.pid_process_denom
      ),
    ]),
    buildGroup("rates", [
      makeItem("ratesType", enumLabel(sysConfig.rates_type, RATES_TYPE), sysConfig.rates_type),
      makeItem("rcRate", formatTriplet(sysConfig.rc_rates), sysConfig.rc_rates),
      makeItem("superRate", formatTriplet(sysConfig.rates), sysConfig.rates),
      makeItem("expo", formatTriplet(sysConfig.rc_expo), sysConfig.rc_expo),
      makeItem("rateLimit", formatTriplet(sysConfig.rate_limits), sysConfig.rate_limits),
    ]),
    buildGroup("feedforward", [
      makeItem("feedforward", formatFeedforward(sysConfig)),
      makeItem(
        "ffAveraging",
        enumLabel(
          pickFirst(sysConfig, ["ff_averaging", "feedforward_averaging"]),
          FF_AVERAGING
        )
      ),
      makeItem(
        "ffLimit",
        isPresent(pickFirst(sysConfig, ["ff_max_rate_limit", "feedforward_max_rate_limit"]))
          ? formatNumber(
              pickFirst(sysConfig, ["ff_max_rate_limit", "feedforward_max_rate_limit"]),
              0,
              "°/s"
            )
          : null
      ),
      makeItem("rcSmoothing", formatRcSmoothing(sysConfig)),
      makeItem("rcSmoothingCutoffs", formatRcSmoothingCutoffs(sysConfig)),
    ]),
    buildGroup("idleThrottle", [
      makeItem(
        "dynamicIdleMinRpm",
        isPresent(pickFirst(sysConfig, ["dynamic_idle_min_rpm", "dyn_idle_min_rpm"]))
          ? formatNumber(
              pickFirst(sysConfig, ["dynamic_idle_min_rpm", "dyn_idle_min_rpm"]),
              0,
              "rpm"
            )
          : null,
        pickFirst(sysConfig, ["dynamic_idle_min_rpm", "dyn_idle_min_rpm"])
      ),
      makeItem("antiGravity", formatAntiGravity(sysConfig)),
      makeItem(
        "minThrottle",
        isPresent(sysConfig.minthrottle) ? formatNumber(sysConfig.minthrottle) : null,
        sysConfig.minthrottle
      ),
      makeItem(
        "throttleBoost",
        isPresent(sysConfig.throttle_boost) ? formatNumber(sysConfig.throttle_boost) : null,
        sysConfig.throttle_boost
      ),
    ]),
    buildGroup("drive", [
      makeItem(
        "protocol",
        enumLabel(
          pickFirst(sysConfig, ["fast_pwm_protocol", "motor_pwm_protocol"]),
          FAST_PROTOCOL
        )
      ),
      makeItem(
        "motorPoles",
        isPresent(sysConfig.motor_poles) ? formatNumber(sysConfig.motor_poles) : null,
        sysConfig.motor_poles
      ),
      makeItem("throttleLimit", formatThrottleLimit(sysConfig)),
      makeItem("tpa", formatTpa(sysConfig)),
      makeItem(
        "outputLimit",
        isPresent(sysConfig.motor_output_limit)
          ? formatNumber(sysConfig.motor_output_limit, 0, "%")
          : null,
        sysConfig.motor_output_limit
      ),
    ]),
    buildGroup("battery", [
      makeItem(
        "batteryWarning",
        isPresent(sysConfig.vbatwarningcellvoltage)
          ? formatNumber(normalizeCellVoltage(sysConfig.vbatwarningcellvoltage), 2, "V/cell")
          : null,
        sysConfig.vbatwarningcellvoltage
      ),
      makeItem(
        "batteryCritical",
        isPresent(sysConfig.vbatmincellvoltage)
          ? formatNumber(normalizeCellVoltage(sysConfig.vbatmincellvoltage), 2, "V/cell")
          : null,
        sysConfig.vbatmincellvoltage
      ),
      makeItem(
        "batteryMax",
        isPresent(sysConfig.vbatmaxcellvoltage)
          ? formatNumber(normalizeCellVoltage(sysConfig.vbatmaxcellvoltage), 2, "V/cell")
          : null,
        sysConfig.vbatmaxcellvoltage
      ),
      makeItem(
        "batterySagCompensation",
        isPresent(sysConfig.vbat_sag_compensation)
          ? formatNumber(sysConfig.vbat_sag_compensation, 0, "%")
          : null,
        sysConfig.vbat_sag_compensation
      ),
    ]),
  ].filter((group) => group.hasData);

  return {
    firmware: formatFirmware(sysConfig),
    batteryConfig: getBatteryConfig(sysConfig, session),
    groups,
    hasData: groups.length > 0,
  };
}
