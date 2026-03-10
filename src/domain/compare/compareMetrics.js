import { getErrorMagnitude, getFlightStatusSummary } from "../blackbox/derived/flightDerived.js";

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rmse(values) {
  if (!values.length) {
    return 0;
  }
  return Math.sqrt(mean(values.map((value) => value * value)));
}

function filterByEventType(events, type) {
  if (!type) {
    return events;
  }
  return events.filter((event) => event.type === type);
}

export function getCompareSummary(flightA, flightB, eventType = null) {
  if (!flightA || !flightB) {
    return null;
  }

  const selectSamples = (flight) => {
    const events = filterByEventType(flight.events, eventType);
    const ranges = events.length
      ? events.map((event) => [event.startUs, event.endUs])
      : [[flight.window.startUs, flight.window.endUs]];

    return flight.window.samples.filter((sample) =>
      ranges.some(([startUs, endUs]) => sample.timeUs >= startUs && sample.timeUs <= endUs)
    );
  };

  const summarize = (flight) => {
    const samples = selectSamples(flight);
    return {
      rollRmse: rmse(samples.map((sample) => sample.error.roll ?? 0)),
      pitchRmse: rmse(samples.map((sample) => sample.error.pitch ?? 0)),
      saturationRate:
        samples.filter((sample) => getFlightStatusSummary(sample).saturation).length /
        Math.max(samples.length, 1),
      highThrottleError: mean(
        samples
          .filter((sample) => sample.rc.throttle >= 70)
          .map((sample) => getErrorMagnitude(sample.error))
      ),
      loadedTurnError: mean(
        samples
          .filter((sample) => sample.rc.throttle >= 35 && Math.abs(sample.setpoint.roll) >= 180)
          .map((sample) => getErrorMagnitude(sample.error))
      ),
      eventCount: filterByEventType(flight.events, eventType).length,
    };
  };

  const summaryA = summarize(flightA);
  const summaryB = summarize(flightB);

  return {
    metrics: [
      {
        label: "Roll error RMSE",
        a: summaryA.rollRmse,
        b: summaryB.rollRmse,
        delta: summaryB.rollRmse - summaryA.rollRmse,
      },
      {
        label: "Pitch error RMSE",
        a: summaryA.pitchRmse,
        b: summaryB.pitchRmse,
        delta: summaryB.pitchRmse - summaryA.pitchRmse,
      },
      {
        label: "Saturation rate",
        a: summaryA.saturationRate * 100,
        b: summaryB.saturationRate * 100,
        delta: (summaryB.saturationRate - summaryA.saturationRate) * 100,
      },
      {
        label: "High-throttle error",
        a: summaryA.highThrottleError,
        b: summaryB.highThrottleError,
        delta: summaryB.highThrottleError - summaryA.highThrottleError,
      },
      {
        label: "Loaded-turn error",
        a: summaryA.loadedTurnError,
        b: summaryB.loadedTurnError,
        delta: summaryB.loadedTurnError - summaryA.loadedTurnError,
      },
      {
        label: "Matched events",
        a: summaryA.eventCount,
        b: summaryB.eventCount,
        delta: summaryB.eventCount - summaryA.eventCount,
      },
    ],
  };
}
