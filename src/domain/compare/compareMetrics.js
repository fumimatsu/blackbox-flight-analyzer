import { getErrorMagnitude, getFlightStatusSummary } from "../blackbox/derived/flightDerived.js";

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

function summarize(flight, eventType) {
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
      getFlightStatusSummary(sample).saturation ? 1 : 0
    ),
    highThrottleErrors: highThrottle,
    loadedTurnErrors: loadedTurn,
  };
}

function buildMetric({
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
      note: `${label} hidden: needs >= ${minRequired} aligned samples in both flights (A ${aCount}, B ${bCount}).`,
    };
  }

  const a = aggregate(aValues);
  const b = aggregate(bValues);
  if (a === null || b === null) {
    return {
      metric: null,
      note: `${label} hidden: aligned samples did not produce a valid value.`,
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

function formatScope(eventType) {
  return eventType ? `${eventType} events` : "Whole-flight window";
}

export function getCompareSummary(flightA, flightB, eventType = null) {
  if (!flightA || !flightB) {
    return null;
  }

  const summaryA = summarize(flightA, eventType);
  const summaryB = summarize(flightB, eventType);
  const notes = [];

  if (!eventType) {
    notes.push(
      "Whole-flight compare is broad. Use Event focus when you want tighter scene matching."
    );
  } else if (summaryA.eventCount !== summaryB.eventCount) {
    notes.push(
      `Event counts differ (${summaryA.eventCount} vs ${summaryB.eventCount}), so metrics compare pooled matching samples rather than pairwise events.`
    );
  }

  const metricResults = [
    buildMetric({
      label: "Roll tracking RMSE",
      meaning: "Lower means roll tracking stayed closer to the requested motion.",
      unit: "°/s",
      aValues: definedNumbers(summaryA.rollErrors),
      bValues: definedNumbers(summaryB.rollErrors),
      aggregate: rmse,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      label: "Pitch tracking RMSE",
      meaning: "Lower means pitch tracking stayed closer to the requested motion.",
      unit: "°/s",
      aValues: definedNumbers(summaryA.pitchErrors),
      bValues: definedNumbers(summaryB.pitchErrors),
      aggregate: rmse,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      label: "Saturation share",
      meaning: "Lower means less time spent with headroom-limited motor output.",
      unit: "%",
      aValues: summaryA.saturationSamples,
      bValues: summaryB.saturationSamples,
      aggregate: (values) => mean(values) * 100,
      threshold: MIN_TOTAL_SAMPLES,
    }),
    buildMetric({
      label: "High-throttle tracking",
      meaning: "Lower means better tracking while throttle was already high.",
      unit: "°/s",
      aValues: summaryA.highThrottleErrors,
      bValues: summaryB.highThrottleErrors,
      aggregate: mean,
    }),
    buildMetric({
      label: "Loaded-turn tracking",
      meaning: "Lower means less tracking error during committed roll-loaded turns.",
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
    scopeLabel: formatScope(eventType),
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
