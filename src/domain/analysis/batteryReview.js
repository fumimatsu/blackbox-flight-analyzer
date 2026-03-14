function isPresent(value) {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

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

const MAX_REASONABLE_CELL_COUNT = 12;

export function getBatteryConfig(setupSummary) {
  const config = setupSummary?.batteryConfig;
  if (!config) {
    return null;
  }

  const warningCellVoltage = config.warningCellVoltage;
  const criticalCellVoltage = config.minCellVoltage;
  const maxCellVoltage = config.maxCellVoltage;

  if (
    !isPresent(warningCellVoltage) ||
    !isPresent(criticalCellVoltage) ||
    !isPresent(maxCellVoltage)
  ) {
    return null;
  }

  return {
    warningCellVoltage,
    criticalCellVoltage,
    maxCellVoltage,
    sagCompensation: config.sagCompensation ?? null,
    cellCountEstimate: config.cellCountEstimate ?? null,
  };
}

export function estimateBatteryCellCount(samples, batteryConfig) {
  if (!batteryConfig) {
    return null;
  }

  const peakVoltage = max(
    samples
      .map((sample) => sample?.battery?.voltage)
      .filter((value) => isPresent(value))
  );

  if (!isPresent(peakVoltage) || !isPresent(batteryConfig.maxCellVoltage)) {
    const vendorEstimate = Math.round(batteryConfig.cellCountEstimate ?? 0);
    return Number.isFinite(vendorEstimate) &&
      vendorEstimate >= 1 &&
      vendorEstimate <= MAX_REASONABLE_CELL_COUNT
      ? vendorEstimate
      : null;
  }

  const observedEstimate = Math.round(peakVoltage / batteryConfig.maxCellVoltage);
  const safeObservedEstimate =
    Number.isFinite(observedEstimate) &&
    observedEstimate >= 1 &&
    observedEstimate <= MAX_REASONABLE_CELL_COUNT
      ? observedEstimate
      : null;
  const vendorEstimate = Math.round(batteryConfig.cellCountEstimate ?? 0);
  const safeVendorEstimate =
    Number.isFinite(vendorEstimate) &&
    vendorEstimate >= 1 &&
    vendorEstimate <= MAX_REASONABLE_CELL_COUNT
      ? vendorEstimate
      : null;

  if (safeVendorEstimate !== null && safeObservedEstimate !== null) {
    return Math.abs(safeVendorEstimate - safeObservedEstimate) <= 1
      ? safeVendorEstimate
      : safeObservedEstimate;
  }

  return safeVendorEstimate ?? safeObservedEstimate;
}

function classifyBatteryState(voltage, thresholds) {
  if (!isPresent(voltage) || !thresholds) {
    return null;
  }
  if (voltage <= thresholds.criticalVoltage) {
    return "critical";
  }
  if (voltage <= thresholds.warningVoltage) {
    return "warning";
  }
  return null;
}

function buildWarningWindows(samples, thresholds) {
  const windows = [];
  let current = null;

  for (const sample of samples) {
    const state = classifyBatteryState(sample?.battery?.voltage, thresholds);

    if (state) {
      if (!current || current.level !== state) {
        if (current) {
          windows.push(current);
        }
        current = {
          level: state,
          startUs: sample.timeUs,
          endUs: sample.timeUs,
          minVoltage: sample.battery.voltage,
          avgThrottle: [],
        };
      }

      current.endUs = sample.timeUs;
      current.minVoltage = Math.min(current.minVoltage, sample.battery.voltage);
      if (isPresent(sample?.rc?.throttle)) {
        current.avgThrottle.push(sample.rc.throttle);
      }
      continue;
    }

    if (current) {
      windows.push(current);
      current = null;
    }
  }

  if (current) {
    windows.push(current);
  }

  return windows.map((window) => ({
    ...window,
    durationUs: window.endUs - window.startUs,
    avgThrottle: mean(window.avgThrottle),
  }));
}

export function getBatteryReviewSummary(samples, setupSummary) {
  const batteryConfig = getBatteryConfig(setupSummary);
  const voltageSamples = samples
    .map((sample) => sample?.battery?.voltage)
    .filter((value) => isPresent(value));

  if (!voltageSamples.length) {
    return {
      hasVoltageData: false,
      hasThresholds: false,
      batteryConfig,
      cellCount: null,
      minVoltage: null,
      maxVoltage: null,
      sagRange: null,
      warningSamples: 0,
      criticalSamples: 0,
      warningWindows: [],
      criticalWindows: [],
      warningVoltage: null,
      criticalVoltage: null,
      firstWarningProgress: null,
      firstCriticalProgress: null,
      likelyWeakPack: false,
      likelyHeavyUsage: false,
    };
  }

  const cellCount = estimateBatteryCellCount(samples, batteryConfig);
  const thresholds =
    batteryConfig && cellCount
      ? {
          warningVoltage: batteryConfig.warningCellVoltage * cellCount,
          criticalVoltage: batteryConfig.criticalCellVoltage * cellCount,
        }
      : null;

  const warningWindows = thresholds ? buildWarningWindows(samples, thresholds) : [];
  const criticalWindows = warningWindows.filter((window) => window.level === "critical");
  const lowWindows = warningWindows.filter((window) => window.level === "warning");
  const startUs = samples[0]?.timeUs ?? 0;
  const endUs = samples[samples.length - 1]?.timeUs ?? startUs;
  const durationUs = Math.max(endUs - startUs, 1);
  const firstWarningUs = lowWindows[0]?.startUs ?? criticalWindows[0]?.startUs ?? null;
  const firstCriticalUs = criticalWindows[0]?.startUs ?? null;
  const firstWarningProgress =
    firstWarningUs === null ? null : (firstWarningUs - startUs) / durationUs;
  const firstCriticalProgress =
    firstCriticalUs === null ? null : (firstCriticalUs - startUs) / durationUs;
  const avgThrottleAtWarning = mean(
    warningWindows
      .map((window) => window.avgThrottle)
      .filter((value) => isPresent(value))
  );

  return {
    hasVoltageData: true,
    hasThresholds: Boolean(thresholds),
    batteryConfig,
    cellCount,
    minVoltage: Math.min(...voltageSamples),
    maxVoltage: Math.max(...voltageSamples),
    sagRange: Math.max(...voltageSamples) - Math.min(...voltageSamples),
    warningSamples: samples.filter(
      (sample) => classifyBatteryState(sample?.battery?.voltage, thresholds) === "warning"
    ).length,
    criticalSamples: samples.filter(
      (sample) => classifyBatteryState(sample?.battery?.voltage, thresholds) === "critical"
    ).length,
    warningWindows: lowWindows,
    criticalWindows,
    warningVoltage: thresholds?.warningVoltage ?? null,
    criticalVoltage: thresholds?.criticalVoltage ?? null,
    firstWarningProgress,
    firstCriticalProgress,
    avgThrottleAtWarning,
    likelyWeakPack:
      firstWarningProgress !== null &&
      firstWarningProgress < 0.45 &&
      (avgThrottleAtWarning ?? 100) < 60,
    likelyHeavyUsage:
      firstWarningProgress !== null &&
      firstWarningProgress >= 0.7 &&
      (avgThrottleAtWarning ?? 0) >= 55,
  };
}
