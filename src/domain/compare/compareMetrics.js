import { getErrorMagnitude, getFlightStatusSummary } from "../blackbox/derived/flightDerived.js";
import { getEventLabel } from "../blackbox/events/eventConfig.js";
import { translate } from "../../i18n/index.js";

const MIN_TOTAL_SAMPLES = 20;
const MIN_CONDITION_SAMPLES = 20;

function mean(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function definedNumbers(values) {
  return values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
}

function rmse(values) {
  const filtered = definedNumbers(values);
  if (!filtered.length) {
    return null;
  }
  const meanSquare = filtered.reduce((sum, value) => sum + value * value, 0) / filtered.length;
  return Math.sqrt(meanSquare);
}

function filterByEventType(events, type) {
  if (!type) {
    return events;
  }
  return events.filter((event) => event.type === type);
}

function selectSamples(flight, eventType) {
  const events = filterByEventType(flight.events, eventType);
  const ranges = events.length
    ? events.map((event) => [event.startUs, event.endUs])
    : [[flight.window.startUs, flight.window.endUs]];

  const samples = flight.window.samples.filter((sample) =>
    ranges.some(([startUs, endUs]) => sample.timeUs >= startUs && sample.timeUs <= endUs)
  );

  return {
    samples,
    eventCount: events.length,
    durationUs:
      samples.length > 1
        ? Math.max(samples[samples.length - 1].timeUs - samples[0].timeUs, 0)
        : 0,
  };
}

function summarize(flight, eventType, locale) {
  const selected = selectSamples(flight, eventType);
  const highThrottle = selected.samples
    .filter((sample) => sample.rc.throttle !== null && sample.rc.throttle >= 70)
    .map((sample) => getErrorMagnitude(sample.error))
    .filter((value) => value !== null);
  const loadedTurn = selected.samples
    .filter(
      (sample) =>
        sample.rc.throttle !== null &&
        sample.rc.throttle >= 35 &&
        sample.setpoint.roll !== null &&
        Math.abs(sample.setpoint.roll) >= 180
    )
    .map((sample) => getErrorMagnitude(sample.error))
    .filter((value) => value !== null);

  return {
    sampleCount: selected.samples.length,
    durationUs: selected.durationUs,
    eventCount: selected.eventCount,
    rollErrors: selected.samples.map((sample) => sample.error.roll),
    pitchErrors: selected.samples.map((sample) => sample.error.pitch),
    saturationSamples: selected.samples.map((sample) =>
      getFlightStatusSummary(sample, locale).saturation ? 1 : 0
    ),
    highThrottleErrors: highThrottle,
    loadedTurnErrors: loadedTurn,
  };
}

function buildMetric({
  locale,
  label,
  meaning,
  smallerIsBetter = true,
  unit = "",
  aValues,
  bValues,
  aggregate,
  threshold,
}) {
  const aCount = aValues.length;
  const bCount = bValues.length;
  const minRequired = threshold ?? MIN_CONDITION_SAMPLES;

  if (aCount < minRequired || bCount < minRequired) {
    return {
      metric: null,
      note: translate(locale, "compare.hiddenNeedSamples", {
        label,
        minRequired,
        aCount,
        bCount,
      }),
    };
  }

  const a = aggregate(aValues);
  const b = aggregate(bValues);
  if (a === null || b === null) {
    return {
      metric: null,
      note: translate(locale, "compare.hiddenInvalid", { label }),
    };
  }

  return {
    metric: {
      label,
      meaning,
      smallerIsBetter,
      unit,
      a,
      b,
      delta: b - a,
      sampleCountA: aCount,
      sampleCountB: bCount,
    },
    note: null,
  };
}

function formatScope(eventType, locale) {
  return eventType
    ? translate(locale, "compare.eventScope", { label: getEventLabel(eventType, locale) })
    : translate(locale, "compare.wholeFlightScope");
}

export function getCompareSummary(flightA, flightB, eventType = null, locale = "en") {
  if (!flightA || !flightB) {
    return null;
  }

  const summaryA = summarize(flightA, eventType, locale);
  const summaryB = summarize(flightB, eventType, locale);
  const notes = [];

  if (!eventType) {
    notes.push(translate(locale, "compare.wholeFlightCaveat"));
  } else if (summaryA.eventCount !== summaryB.eventCount) {
    notes.push(
      translate(locale, "compare.eventCountMismatch", {
        a: summaryA.eventCount,
        b: summaryB.eventCount,
      })
    );
  }

  const metricResults = [
    buildMetric({
      locale,
      label: translate(locale, "compare.rollTrackingRmse"),
      meaning: translate(locale, "compare.rollTrackingMeaning"),
      unit: "°/s",
      aValues: definedNumbers(summaryA.rollErrors),
      bValues: definedNumbers(summaryB.rollErrors),
      aggregate: rmse,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      locale,
      label: translate(locale, "compare.pitchTrackingRmse"),
      meaning: translate(locale, "compare.pitchTrackingMeaning"),
      unit: "°/s",
      aValues: definedNumbers(summaryA.pitchErrors),
      bValues: definedNumbers(summaryB.pitchErrors),
      aggregate: rmse,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      locale,
      label: translate(locale, "compare.saturationShare"),
      meaning: translate(locale, "compare.saturationShareMeaning"),
      unit: "%",
      aValues: summaryA.saturationSamples,
      bValues: summaryB.saturationSamples,
      aggregate: (values) => mean(values) * 100,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      locale,
      label: translate(locale, "compare.highThrottleTracking"),
      meaning: translate(locale, "compare.highThrottleTrackingMeaning"),
      unit: "°/s",
      aValues: summaryA.highThrottleErrors,
      bValues: summaryB.highThrottleErrors,
      aggregate: mean,
    }),
    buildMetric({
      locale,
      label: translate(locale, "compare.loadedTurnTracking"),
      meaning: translate(locale, "compare.loadedTurnTrackingMeaning"),
      unit: "°/s",
      aValues: summaryA.loadedTurnErrors,
      bValues: summaryB.loadedTurnErrors,
      aggregate: mean,
    }),
  ];

  for (const result of metricResults) {
    if (result.note) {
      notes.push(result.note);
    }
  }

  const metrics = metricResults
    .map((result) => result.metric)
    .filter(Boolean);

  return {
    scopeLabel: formatScope(eventType, locale),
    metrics,
    notes,
    coverage: {
      a: {
        label: "A",
        sampleCount: summaryA.sampleCount,
        durationSeconds: summaryA.durationUs / 1000000,
        eventCount: summaryA.eventCount,
      },
      b: {
        label: "B",
        sampleCount: summaryB.sampleCount,
        durationSeconds: summaryB.durationUs / 1000000,
        eventCount: summaryB.eventCount,
      },
    },
  };
}
