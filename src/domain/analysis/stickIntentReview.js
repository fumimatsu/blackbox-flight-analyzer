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

function clamp(value, min, maxValue) {
  return Math.max(min, Math.min(maxValue, value));
}

function averageAbsolute(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
}

function summarizeAxis(samples, axis) {
  const rcSetpointGaps = [];
  const rawCommandGaps = [];
  const rcSetpointDeltaGaps = [];
  let activeSamples = 0;
  let heldInputFrames = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = index > 0 ? samples[index - 1] : null;
    const rcValue = sample?.rc?.[axis];
    const setpointValue = sample?.setpoint?.[axis];
    const rawValue = sample?.rcRaw?.[axis];

    if (isPresent(rcValue) && isPresent(setpointValue)) {
      rcSetpointGaps.push(Math.abs(setpointValue - rcValue));
    }

    if (isPresent(rawValue) && isPresent(rcValue)) {
      rawCommandGaps.push(Math.abs(rawValue - rcValue));
    }

    if (!previous) {
      continue;
    }

    const previousRc = previous?.rc?.[axis];
    const previousSetpoint = previous?.setpoint?.[axis];
    const previousRaw = previous?.rcRaw?.[axis];

    const rcDelta =
      isPresent(rcValue) && isPresent(previousRc) ? Math.abs(rcValue - previousRc) : null;
    const setpointDelta =
      isPresent(setpointValue) && isPresent(previousSetpoint)
        ? Math.abs(setpointValue - previousSetpoint)
        : null;
    const rawDelta =
      isPresent(rawValue) && isPresent(previousRaw) ? Math.abs(rawValue - previousRaw) : null;

    if (isPresent(rcDelta) && isPresent(setpointDelta)) {
      rcSetpointDeltaGaps.push(Math.abs(setpointDelta - rcDelta));
    }

    const activeMagnitude = max(
      [rcDelta, setpointDelta, rawDelta].filter(isPresent)
    );
    if (!isPresent(activeMagnitude) || activeMagnitude < 8) {
      continue;
    }

    activeSamples += 1;
    if (
      isPresent(rawDelta) &&
      rawDelta <= 1 &&
      ((isPresent(rcDelta) && rcDelta >= 8) || (isPresent(setpointDelta) && setpointDelta >= 8))
    ) {
      heldInputFrames += 1;
    }
  }

  return {
    axis,
    activeSamples,
    rcSetpointGapMean: mean(rcSetpointGaps),
    rcSetpointGapPeak: max(rcSetpointGaps),
    rawCommandGapMean: mean(rawCommandGaps),
    rawCommandGapPeak: max(rawCommandGaps),
    rcSetpointDeltaGapMean: mean(rcSetpointDeltaGaps),
    heldInputShare: activeSamples ? heldInputFrames / activeSamples : null,
    hasRawData: rawCommandGaps.length > 0,
  };
}

function summarizeConfig(setupSummary) {
  const feedforwardGroup = setupSummary?.groups?.find((group) => group.key === "feedforward");
  const ratesGroup = setupSummary?.groups?.find((group) => group.key === "rates");

  const getItemValue = (group, key) => group?.items?.find((item) => item.key === key)?.value ?? null;

  return {
    feedforward: getItemValue(feedforwardGroup, "feedforward"),
    rcSmoothing: getItemValue(feedforwardGroup, "rcSmoothing"),
    rcSmoothingCutoffs: getItemValue(feedforwardGroup, "rcSmoothingCutoffs"),
    ratesType: getItemValue(ratesGroup, "ratesType"),
  };
}

function summarizeRadio(samples) {
  const rssiValues = samples
    .map((sample) => sample?.radio?.rssi)
    .filter(isPresent);

  return {
    rssiAvg: mean(rssiValues),
    hasRssiData: rssiValues.length > 0,
  };
}

function formatDebugMetric(key, value, digits = 0, suffix = "") {
  if (!isPresent(value)) {
    return null;
  }

  return {
    key,
    value,
    display: `${Number(value).toFixed(digits).replace(/\.0+$/, "")}${suffix}`,
  };
}

function summarizeDebug(samples) {
  const debugSamples = samples.filter(
    (sample) => sample?.debug?.mode && Array.isArray(sample?.debug?.values)
  );
  if (!debugSamples.length) {
    return null;
  }

  const mode = debugSamples[0].debug.mode;
  const valuesByIndex = Array.from({ length: 8 }, (_, index) =>
    debugSamples
      .map((sample) => sample.debug.values[index])
      .filter(isPresent)
  );

  const truthyShare = (values) => {
    if (!values.length) {
      return null;
    }
    return values.filter((value) => Boolean(value)).length / values.length;
  };

  const numericItem = (key, index, digits = 0, suffix = "", transform = (value) => value) =>
    formatDebugMetric(key, mean(valuesByIndex[index].map(transform)), digits, suffix);

  const absoluteItem = (key, index, digits = 0, suffix = "", transform = (value) => value) =>
    formatDebugMetric(
      key,
      averageAbsolute(valuesByIndex[index].map(transform)),
      digits,
      suffix
    );

  switch (mode) {
    case "FEEDFORWARD":
      return {
        mode,
        items: [
          absoluteItem("setpointSpeed", 1, 0, "°/s/s"),
          absoluteItem("rcDelta", 3, 1, "", (value) => value / 10),
          numericItem("jitterAttenuator", 4, 0, "%"),
        ].filter(Boolean),
        linkQualityAvg: null,
      };
    case "FEEDFORWARD_LIMIT":
      return {
        mode,
        items: [
          numericItem("jitterAttenuator", 0, 0, "%"),
          numericItem("ffSmoothing", 6, 3, "", (value) => value / 1000),
          numericItem("smoothedRxRateHz", 7, 0, "Hz"),
        ].filter(Boolean),
        linkQualityAvg: null,
      };
    case "RC_SMOOTHING":
      return {
        mode,
        items: [
          numericItem("ffPt1", 4, 3, "", (value) => value / 1000),
          numericItem("outlierCount", 6),
          numericItem("validCount", 7),
        ].filter(Boolean),
        linkQualityAvg: null,
      };
    case "RC_SMOOTHING_RATE":
      return {
        mode,
        items: [
          numericItem("frameRateMs", 0, 2, "ms", (value) => value / 1000),
          numericItem("smoothedRxRateHz", 2, 0, "Hz"),
          formatDebugMetric(
            "updateShare",
            truthyShare(valuesByIndex[3]),
            null,
            ""
          ),
        ]
          .map((item) =>
            item?.key === "updateShare" && isPresent(item.value)
              ? {
                  ...item,
                  display: `${Math.round(clamp(item.value, 0, 1) * 100)}%`,
                }
              : item
          )
          .filter(Boolean),
        linkQualityAvg: null,
      };
    case "RX_TIMING": {
      const linkQualityAvg = mean(valuesByIndex[6]);
      return {
        mode,
        items: [
          numericItem("packetIntervalMs", 0, 2, "ms", (value) => value / 100),
          numericItem("currentRxRateHz", 4, 0, "Hz"),
          numericItem("smoothedRxRateHz", 5, 0, "Hz"),
          numericItem("linkQuality", 6, 0, "%"),
        ].filter(Boolean),
        linkQualityAvg,
      };
    }
    case "CRSF_LINK_STATISTICS_UPLINK":
    case "GHST":
    case "RX_EXPRESSLRS_SPI": {
      const linkQualityIndex = mode === "RX_EXPRESSLRS_SPI" ? 3 : 3;
      const linkQualityAvg = mean(valuesByIndex[linkQualityIndex]);
      const items = [
        numericItem("linkQuality", linkQualityIndex, 0, "%"),
      ];
      if (mode === "RX_EXPRESSLRS_SPI") {
        items.push(numericItem("radioRssi", 1));
        items.push(numericItem("snr", 2));
      } else if (mode === "GHST") {
        items.push(numericItem("radioRssi", 2));
      }
      return {
        mode,
        items: items.filter(Boolean),
        linkQualityAvg,
      };
    }
    default:
      return {
        mode,
        items: [],
        linkQualityAvg: null,
      };
  }
}

export function getStickIntentReviewSummary(samples, setupSummary = null) {
  if (!samples?.length) {
    return {
      axes: {},
      primaryAxis: null,
      configuration: summarizeConfig(setupSummary),
      debug: null,
      radio: summarizeRadio([]),
      hasRawData: false,
      hasSetpointData: false,
      hasDebugData: false,
      hasAnyData: false,
    };
  }

  const axes = {
    roll: summarizeAxis(samples, "roll"),
    pitch: summarizeAxis(samples, "pitch"),
    yaw: summarizeAxis(samples, "yaw"),
  };

  const rankedAxes = Object.values(axes).sort((left, right) => {
    const leftScore =
      (left.rcSetpointGapPeak ?? 0) +
      (left.rawCommandGapPeak ?? 0) * 0.6 +
      (left.rcSetpointDeltaGapMean ?? 0) * 0.8;
    const rightScore =
      (right.rcSetpointGapPeak ?? 0) +
      (right.rawCommandGapPeak ?? 0) * 0.6 +
      (right.rcSetpointDeltaGapMean ?? 0) * 0.8;
    return rightScore - leftScore;
  });

  const debug = summarizeDebug(samples);
  const radio = summarizeRadio(samples);
  const hasRawData = rankedAxes.some((axis) => axis.hasRawData);
  const hasSetpointData = rankedAxes.some((axis) => isPresent(axis.rcSetpointGapPeak));

  return {
    axes,
    primaryAxis: rankedAxes[0] ?? null,
    configuration: summarizeConfig(setupSummary),
    debug,
    radio,
    hasRawData,
    hasSetpointData,
    hasDebugData: Boolean(debug?.mode),
    hasAnyData: hasRawData || hasSetpointData || Boolean(debug?.mode) || radio.hasRssiData,
  };
}
