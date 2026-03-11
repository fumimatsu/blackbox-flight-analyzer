import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "./store/useAppStore.js";
import {
  createVideoAsset,
  loadFlightSessionsFromFile,
} from "../domain/blackbox/adapter/flightLogAdapter.js";
import {
  clampTime,
  getFirstArmedTimeUs,
  getFlightSnapshot,
  getFlightWindow,
} from "../domain/blackbox/selectors/flightSelectors.js";
import { detectAnalysisEvents } from "../domain/blackbox/events/detectEvents.js";
import { EVENT_TYPES } from "../domain/blackbox/events/eventConfig.js";
import {
  getFlightStatusSummary,
  getMotorStats,
  getRpmStats,
} from "../domain/blackbox/derived/flightDerived.js";
import { getCompareSummary } from "../domain/compare/compareMetrics.js";
import {
  calculateAutoVideoOffset,
  detectArmedOverlayTime,
} from "../domain/sync/autoVideoSync.js";

const OVERLAY_SAMPLE_INTERVAL_US = 25000;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;
const PLAYBACK_RATE_STEP = 0.05;

function formatMicroseconds(timeUs) {
  const totalMs = Math.max(0, Math.round(timeUs / 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(millis).padStart(3, "0")}`;
}

function percent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(digits)}%`;
}

function formatPlaybackRate(rate) {
  return `${rate.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function signed(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function mapStickAxis(value, scale = 500) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return clampPercent(50 + (value / scale) * 42);
}

function mapThrottleAxis(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return clampPercent(100 - value);
}

function formatMaybeValue(value, digits = 0, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function negateMaybe(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return -value;
}

function mapMaybePoint(xValue, yValue) {
  if (xValue === null || yValue === null) {
    return null;
  }
  return { x: xValue, y: yValue };
}

function getTimeCursorX(currentTimeUs, startUs, endUs, width) {
  if (
    currentTimeUs === null ||
    currentTimeUs === undefined ||
    Number.isNaN(currentTimeUs)
  ) {
    return width / 2;
  }
  const rangeUs = Math.max(endUs - startUs, 1);
  const ratio = Math.max(0, Math.min(1, (currentTimeUs - startUs) / rangeUs));
  return ratio * width;
}

function useSelectedFlight() {
  return useAppStore((state) =>
    state.flights.find((flight) => flight.id === state.selectedFlightId) ?? null
  );
}

function prepareFlight(flight) {
  if (!flight) {
    return null;
  }
  const window = getFlightWindow(flight, flight.minTimeUs, flight.maxTimeUs);
  return {
    ...flight,
    window,
    events: detectAnalysisEvents(window),
  };
}

function StickOverlay({
  title,
  xValue,
  yValue,
  xLabel,
  yLabel,
  trail,
  rawPoint = null,
  setpointPoint = null,
  miniGraph = null,
}) {
  const rawActive = Boolean(rawPoint);
  const setpointActive = Boolean(setpointPoint);
  const commandActive = xValue !== null && yValue !== null;

  return (
    <div className="stick-card">
      <div className="stick-card__title">{title}</div>
      <div className="stick-card__arena">
        <div className="stick-card__crosshair stick-card__crosshair--x" />
        <div className="stick-card__crosshair stick-card__crosshair--y" />
        {trail.map((point, index) => (
          <div
            key={`${point.x}-${point.y}-${index}`}
            className="stick-card__trail"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              opacity: 0.22 + ((index + 1) / Math.max(trail.length, 1)) * 0.7,
            }}
          />
        ))}
        <div
          className={`stick-card__dot stick-card__dot--raw ${
            rawActive ? "" : "stick-card__dot--inactive"
          }`}
          style={{
            left: `${rawActive ? rawPoint.x : 50}%`,
            top: `${rawActive ? rawPoint.y : 50}%`,
          }}
        />
        <div
          className={`stick-card__dot stick-card__dot--setpoint ${
            setpointActive ? "" : "stick-card__dot--inactive"
          }`}
          style={{
            left: `${setpointActive ? setpointPoint.x : 50}%`,
            top: `${setpointActive ? setpointPoint.y : 50}%`,
          }}
        />
        <div
          className="stick-card__cross-dot"
          style={{
            left: `${commandActive ? xValue : 50}%`,
            top: `${commandActive ? yValue : 50}%`,
            opacity: commandActive ? 1 : 0.25,
          }}
        >
          <div className="stick-card__cross-dot-x" />
          <div className="stick-card__cross-dot-y" />
        </div>
      </div>
      <div className="stick-card__labels">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
      <div className="stick-card__legend">
        <span className="stick-card__legend-item">
          <i className="stick-card__legend-dot stick-card__legend-dot--command" />
          RC
        </span>
        <span
          className={`stick-card__legend-item ${
            rawActive ? "" : "stick-card__legend-item--inactive"
          }`}
        >
          <i className="stick-card__legend-dot stick-card__legend-dot--raw" />
          Raw
        </span>
        <span
          className={`stick-card__legend-item ${
            setpointActive ? "" : "stick-card__legend-item--inactive"
          }`}
        >
          <i className="stick-card__legend-dot stick-card__legend-dot--setpoint" />
          Setpoint
        </span>
      </div>
      {miniGraph}
    </div>
  );
}

function StatusPill({ label, value, accent = "neutral", compact = false }) {
  return (
    <div className={`status-pill status-pill--${accent} ${compact ? "status-pill--compact" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function thresholdY(value, minValue, maxValue, height) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const clamped = Math.max(minValue, Math.min(maxValue, value));
  return height - ((clamped - minValue) / Math.max(maxValue - minValue, 1)) * height;
}

function polylinePoints(samples, valueSelector, width, height) {
  const indexed = samples
    .map((sample, index) => ({ index, sample, value: valueSelector(sample) }))
    .filter(({ value }) => value !== null && value !== undefined && !Number.isNaN(value));

  if (!indexed.length) {
    return "";
  }
  const values = indexed.map(({ value }) => value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const startTimeUs = samples[0]?.timeUs ?? 0;
  const endTimeUs = samples[samples.length - 1]?.timeUs ?? startTimeUs;
  const timeRangeUs = Math.max(endTimeUs - startTimeUs, 1);
  return indexed
    .map(({ index, sample, value }) => {
      const x =
        sample.timeUs !== undefined
          ? ((sample.timeUs - startTimeUs) / timeRangeUs) * width
          : (index / Math.max(samples.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function fixedScalePolylinePoints(
  samples,
  valueSelector,
  width,
  height,
  minValue,
  maxValue
) {
  const indexed = samples
    .map((sample, index) => ({ index, sample, value: valueSelector(sample) }))
    .filter(({ value }) => value !== null && value !== undefined && !Number.isNaN(value));

  if (!indexed.length) {
    return "";
  }

  const range = maxValue - minValue || 1;
  const startTimeUs = samples[0]?.timeUs ?? 0;
  const endTimeUs = samples[samples.length - 1]?.timeUs ?? startTimeUs;
  const timeRangeUs = Math.max(endTimeUs - startTimeUs, 1);
  return indexed
    .map(({ index, sample, value }) => {
      const x =
        sample.timeUs !== undefined
          ? ((sample.timeUs - startTimeUs) / timeRangeUs) * width
          : (index / Math.max(samples.length - 1, 1)) * width;
      const clampedValue = Math.max(minValue, Math.min(maxValue, value));
      const y = height - ((clampedValue - minValue) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function multiPolylinePoints(seriesList, width, height, minValue, maxValue) {
  const range = maxValue - minValue || 1;

  return seriesList.map((series) => {
    const startTimeUs = series.samples[0]?.timeUs ?? 0;
    const endTimeUs = series.samples[series.samples.length - 1]?.timeUs ?? startTimeUs;
    const timeRangeUs = Math.max(endTimeUs - startTimeUs, 1);
    const indexed = series.samples
      .map((sample, index) => ({ index, sample, value: series.valueSelector(sample) }))
      .filter(({ value }) => value !== null && value !== undefined && !Number.isNaN(value));

    return {
      key: series.key,
      className: series.className,
      points: indexed
        .map(({ index, sample, value }) => {
          const x =
            sample.timeUs !== undefined
              ? ((sample.timeUs - startTimeUs) / timeRangeUs) * width
              : (index / Math.max(series.samples.length - 1, 1)) * width;
          const clampedValue = Math.max(minValue, Math.min(maxValue, value));
          const y = height - ((clampedValue - minValue) / range) * height;
          return `${x},${y}`;
        })
        .join(" "),
    };
  });
}

function getStatusSegments(samples, minDurationUs = 100000) {
  const derived = samples.map((sample) => ({
    timeUs: sample.timeUs,
    label: getFlightStatusSummary(sample).label,
  }));

  if (!derived.length) {
    return [];
  }

  const buildRuns = (items) => {
    const runs = [];

    for (const sample of items) {
      const last = runs[runs.length - 1];
      if (last && last.label === sample.label) {
        last.endUs = sample.timeUs;
        last.count += 1;
        continue;
      }

      runs.push({
        label: sample.label,
        startUs: sample.timeUs,
        endUs: sample.timeUs,
        count: 1,
      });
    }

    return runs;
  };

  const expandRuns = (runs) =>
    runs.flatMap((run) =>
      Array.from({ length: run.count }, (_, index) => ({
        timeUs:
          run.count <= 1
            ? run.startUs
            : Math.round(
                run.startUs + ((run.endUs - run.startUs) * index) / (run.count - 1)
              ),
        label: run.label,
      }))
    );

  let runs = buildRuns(derived);
  let changed = true;

  while (changed) {
    changed = false;

    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      const durationUs = run.endUs - run.startUs;
      if (durationUs >= minDurationUs || runs.length <= 1) {
        continue;
      }

      const previous = runs[index - 1] ?? null;
      const next = runs[index + 1] ?? null;
      let replacementLabel = null;

      if (previous && next && previous.label === next.label) {
        replacementLabel = previous.label;
      } else if (previous && next) {
        const previousDurationUs = previous.endUs - previous.startUs;
        const nextDurationUs = next.endUs - next.startUs;
        replacementLabel =
          previousDurationUs >= nextDurationUs ? previous.label : next.label;
      } else if (previous) {
        replacementLabel = previous.label;
      } else if (next) {
        replacementLabel = next.label;
      }

      if (!replacementLabel || replacementLabel === run.label) {
        continue;
      }

      runs[index] = {
        ...run,
        label: replacementLabel,
      };
      runs = buildRuns(expandRuns(runs));
      changed = true;
      break;
    }
  }

  return runs;
}

function ErrorTrendCard({ snapshot, samples, currentTimeUs }) {
  const width = 176;
  const height = 38;
  const startUs = samples[0]?.timeUs ?? currentTimeUs ?? 0;
  const endUs = samples[samples.length - 1]?.timeUs ?? startUs;
  const cursorX = getTimeCursorX(currentTimeUs, startUs, endUs, width);
  const lines = multiPolylinePoints(
    [
      {
        key: "roll",
        className: "trend-metric__line trend-metric__line--roll",
        samples,
        valueSelector: (sample) =>
          sample.error.roll === null ? null : Math.abs(sample.error.roll),
      },
      {
        key: "pitch",
        className: "trend-metric__line trend-metric__line--pitch",
        samples,
        valueSelector: (sample) =>
          sample.error.pitch === null ? null : Math.abs(sample.error.pitch),
      },
      {
        key: "yaw",
        className: "trend-metric__line trend-metric__line--yaw",
        samples,
        valueSelector: (sample) =>
          sample.error.yaw === null ? null : Math.abs(sample.error.yaw),
      },
    ],
    width,
    height,
    0,
    180
  );
  const thresholdLineY = thresholdY(90, 0, 180, height);

  return (
    <div className="trend-metric trend-metric--wide">
      <div className="trend-metric__header">
        <span>Error</span>
        <div className="trend-metric__values">
          <strong className="trend-metric__value trend-metric__value--roll">
            <span className="trend-metric__value-label">R</span>
            <span className="trend-metric__value-number">
              {formatMaybeValue(
                snapshot.error.roll === null ? null : Math.abs(snapshot.error.roll),
                1
              )}
            </span>
          </strong>
          <strong className="trend-metric__value trend-metric__value--pitch">
            <span className="trend-metric__value-label">P</span>
            <span className="trend-metric__value-number">
              {formatMaybeValue(
                snapshot.error.pitch === null ? null : Math.abs(snapshot.error.pitch),
                1
              )}
            </span>
          </strong>
          <strong className="trend-metric__value trend-metric__value--yaw">
            <span className="trend-metric__value-label">Y</span>
            <span className="trend-metric__value-number">
              {formatMaybeValue(
                snapshot.error.yaw === null ? null : Math.abs(snapshot.error.yaw),
                1
              )}
            </span>
          </strong>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-metric__chart">
        <rect x="0" y="0" width={width} height={height} className="trend-metric__bg" />
        {thresholdLineY !== null ? (
          <line
            x1="0"
            x2={width}
            y1={thresholdLineY}
            y2={thresholdLineY}
            className="trend-metric__threshold"
          />
        ) : null}
        <line
          x1={cursorX}
          x2={cursorX}
          y1="0"
          y2={height}
          className="trend-metric__cursor"
        />
        {lines.some((line) => line.points) ? (
          lines.map((line) => (
            <polyline key={line.key} points={line.points} className={line.className} />
          ))
        ) : (
          <text x={width / 2} y={height / 2 + 4} textAnchor="middle" className="trend-metric__empty">
            no data
          </text>
        )}
      </svg>
    </div>
  );
}

function statusClassName(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function StatusTimelineCard({ snapshot, samples, currentTimeUs }) {
  const width = 176;
  const height = 34;
  const segments = getStatusSegments(samples);
  const startUs = samples[0]?.timeUs ?? 0;
  const endUs = samples[samples.length - 1]?.timeUs ?? startUs;
  const rangeUs = Math.max(endUs - startUs, 1);
  const cursorX = getTimeCursorX(currentTimeUs, startUs, endUs, width);

  return (
    <div className="status-timeline">
      <div className="status-timeline__header">
        <span>Status</span>
        <strong>{snapshot ? getFlightStatusSummary(snapshot).label : "n/a"}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="status-timeline__chart">
        <rect x="0" y="0" width={width} height={height} className="status-timeline__bg" />
        {segments.map((segment, index) => {
          const x = ((segment.startUs - startUs) / rangeUs) * width;
          const endX = ((segment.endUs - startUs) / rangeUs) * width;
          return (
            <rect
              key={`${segment.label}-${index}`}
              x={x}
              y="6"
              width={Math.max(endX - x, 6)}
              height={height - 12}
              rx="6"
              className={`status-timeline__segment status-timeline__segment--${statusClassName(
                segment.label
              )}`}
            />
          );
        })}
        <line x1={cursorX} x2={cursorX} y1="0" y2={height} className="status-timeline__cursor" />
      </svg>
    </div>
  );
}

function MotorDetailCard({ motors, spread, saturation }) {
  const peak = motors.length ? Math.max(...motors) : null;

  return (
    <div className="motor-detail">
      <div className="motor-detail__header">
        <span>Motors</span>
        <div className="motor-detail__summary">
          <strong>{peak === null ? "n/a" : percent(peak)}</strong>
          <em>Spread {percent(spread)}</em>
          <em>Headroom {peak === null ? "n/a" : saturation ? "Low" : "OK"}</em>
        </div>
      </div>
      <div className="motor-detail__grid">
        {Array.from({ length: 4 }, (_, index) => {
          const value = motors[index] ?? null;
          const fill = value === null ? 0 : Math.max(0, Math.min(100, value));
          const state =
            value === null ? "missing" : value >= 95 ? "warn" : peak !== null && value === peak ? "peak" : "ok";

          return (
            <div key={`motor-${index}`} className={`motor-detail__cell motor-detail__cell--${state}`}>
              <span className="motor-detail__label">M{index + 1}</span>
              <div className="motor-detail__bar">
                <div className="motor-detail__fill" style={{ height: `${fill}%` }} />
              </div>
              <strong className="motor-detail__value">
                {value === null ? "n/a" : `${Math.round(value)}%`}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StickHistoryMini({
  channels,
  currentTimeUs,
  width = 250,
  height = 54,
}) {
  const startUs = channels[0]?.samples[0]?.timeUs ?? currentTimeUs ?? 0;
  const endUs =
    channels[0]?.samples[channels[0].samples.length - 1]?.timeUs ?? startUs;
  const cursorX = getTimeCursorX(currentTimeUs, startUs, endUs, width);

  return (
    <div className="stick-history-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="stick-history">
        <rect x="0" y="0" width={width} height={height} className="stick-history__bg" />
        <line
          x1={cursorX}
          x2={cursorX}
          y1="0"
          y2={height}
          className="stick-history__cursor"
        />
        {channels.map((channel) => (
          <polyline
            key={channel.key}
            points={fixedScalePolylinePoints(
              channel.samples,
              channel.valueSelector,
              width,
              height,
              channel.minValue,
              channel.maxValue
            )}
            className={channel.className}
          />
        ))}
      </svg>
      <div className="stick-history__legend">
        {channels.map((channel) => (
          <span key={channel.key} className="stick-history__legend-item">
            <i className={`stick-history__legend-swatch ${channel.legendClassName}`} />
            {channel.legendLabel}
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryGraph({ flight, currentTimeUs }) {
  const width = 960;
  const laneHeight = 42;
  const lanes = [
    {
      key: "throttle",
      label: "Throttle",
      className: "history__line history__line--throttle",
      valueSelector: (sample) => sample.rc.throttle,
    },
    {
      key: "roll",
      label: "Roll error",
      className: "history__line history__line--roll",
      valueSelector: (sample) => sample.error.roll,
    },
    {
      key: "pitch",
      label: "Pitch error",
      className: "history__line history__line--pitch",
      valueSelector: (sample) => sample.error.pitch,
    },
    {
      key: "rpm",
      label: "RPM avg",
      className: "history__line history__line--rpm",
      valueSelector: (sample) => getRpmStats(sample.rpm).avg,
    },
  ];
  const height = laneHeight * lanes.length;
  const cursor =
    ((currentTimeUs - flight.minTimeUs) / Math.max(flight.durationUs, 1)) * width;

  return (
    <div className="history">
      <div className="history__header">
        <h3>Compact History</h3>
        <span>{formatMicroseconds(currentTimeUs - flight.minTimeUs)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="history__svg">
        {flight.events.map((event) => {
          const x =
            ((event.startUs - flight.minTimeUs) / Math.max(flight.durationUs, 1)) *
            width;
          const eventWidth =
            (event.durationUs / Math.max(flight.durationUs, 1)) * width;
          return (
            <rect
              key={event.id}
              x={x}
              y="0"
              width={Math.max(eventWidth, 2)}
              height={height}
              className={`history__event history__event--${event.type}`}
            />
          );
        })}
        {lanes.map((lane, index) => (
          <g key={lane.key} transform={`translate(0, ${index * laneHeight})`}>
            <rect
              x="0"
              y="0"
              width={width}
              height={laneHeight}
              className="history__lane-bg"
            />
            <line
              x1="0"
              x2={width}
              y1={laneHeight - 1}
              y2={laneHeight - 1}
              className="history__lane-divider"
            />
            <polyline
              points={polylinePoints(
                flight.window.samples,
                lane.valueSelector,
                width,
                laneHeight - 6
              )}
              className={lane.className}
              transform="translate(0, 3)"
            />
          </g>
        ))}
        <line x1={cursor} x2={cursor} y1="0" y2={height} className="history__cursor" />
      </svg>
      <div className="history__legend history__legend--stacked">
        {lanes.map((lane) => (
          <span key={lane.key} className="history__legend-item">
            <i className={`history__legend-swatch history__legend-swatch--${lane.key}`} />
            {lane.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function EventList({ events, onSelect }) {
  return (
    <div className="event-list">
      <h3>Analysis Events</h3>
      {events.length ? (
        events.slice(0, 12).map((event) => (
          <button
            key={event.id}
            className="event-list__item"
            type="button"
            onClick={() => onSelect(event.startUs)}
          >
            <strong>{event.summary}</strong>
            <span>{formatMicroseconds(event.startUs)}</span>
          </button>
        ))
      ) : (
        <p className="muted">No event matched the current heuristics.</p>
      )}
    </div>
  );
}

function ComparePanel({ flights, compareSession, onFlightChange, onEventTypeChange }) {
  const preparedA = useMemo(
    () => prepareFlight(flights.find((flight) => flight.id === compareSession.flightAId)),
    [flights, compareSession.flightAId]
  );
  const preparedB = useMemo(
    () => prepareFlight(flights.find((flight) => flight.id === compareSession.flightBId)),
    [flights, compareSession.flightBId]
  );
  const summary = useMemo(
    () => getCompareSummary(preparedA, preparedB, compareSession.selectedEventType),
    [preparedA, preparedB, compareSession.selectedEventType]
  );

  return (
    <aside className="compare-panel">
      <div className="compare-panel__header">
        <h3>Compare</h3>
        <p>Single-video compare foundation with same-event metrics.</p>
      </div>
      <div className="compare-panel__controls">
        <label>
          Flight A
          <select
            value={compareSession.flightAId ?? ""}
            onChange={(event) => onFlightChange("flightAId", event.target.value)}
          >
            <option value="">Select</option>
            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Flight B
          <select
            value={compareSession.flightBId ?? ""}
            onChange={(event) => onFlightChange("flightBId", event.target.value)}
          >
            <option value="">Select</option>
            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Event focus
          <select
            value={compareSession.selectedEventType ?? ""}
            onChange={(event) => onEventTypeChange(event.target.value || null)}
          >
            <option value="">Whole flight</option>
            {Object.values(EVENT_TYPES).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      {summary ? (
        <div className="compare-panel__metrics">
          {summary.metrics.map((metric) => (
            <div key={metric.label} className="compare-metric">
              <span>{metric.label}</span>
              <strong>
                A {metric.a.toFixed(1)} / B {metric.b.toFixed(1)}
              </strong>
              <em>{signed(metric.delta, 1)}</em>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Load two logs to enable A/B summaries.</p>
      )}
    </aside>
  );
}

export function App() {
  const videoRef = useRef(null);
  const playbackFrameRef = useRef(0);
  const playbackClockRef = useRef(0);
  const autoSyncAbortRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [loadErrors, setLoadErrors] = useState([]);
  const [syncNoticeVisible, setSyncNoticeVisible] = useState(false);
  const flights = useAppStore((state) => state.flights);
  const selectedFlight = useSelectedFlight();
  const preparedFlight = useMemo(() => prepareFlight(selectedFlight), [selectedFlight]);
  const compareSession = useAppStore((state) => state.compareSession);
  const overlayState = useAppStore((state) => state.overlayState);
  const currentTimeUs = useAppStore((state) => state.currentTimeUs);
  const playback = useAppStore((state) => state.playback);
  const videoSync = useAppStore((state) => state.videoSync);
  const addFlight = useAppStore((state) => state.addFlight);
  const assignVideo = useAppStore((state) => state.assignVideo);
  const selectFlight = useAppStore((state) => state.selectFlight);
  const setCurrentTimeUs = useAppStore((state) => state.setCurrentTimeUs);
  const setPlayback = useAppStore((state) => state.setPlayback);
  const setPlaybackRate = useAppStore((state) => state.setPlaybackRate);
  const setVideoOffset = useAppStore((state) => state.setVideoOffset);
  const setCompareFlight = useAppStore((state) => state.setCompareFlight);
  const setCompareEventType = useAppStore((state) => state.setCompareEventType);
  const setVideoSyncMeta = useAppStore((state) => state.setVideoSyncMeta);
  const setStickMiniGraphEnabled = useAppStore(
    (state) => state.setStickMiniGraphEnabled
  );
  const setStickMiniGraphWindowUs = useAppStore(
    (state) => state.setStickMiniGraphWindowUs
  );

  const snapshot = useMemo(() => {
    if (!preparedFlight) {
      return null;
    }
    return getFlightSnapshot(preparedFlight, currentTimeUs);
  }, [preparedFlight, currentTimeUs]);

  const overlaySummary = snapshot ? getFlightStatusSummary(snapshot) : null;

  const stickTrail = useMemo(() => {
    if (!preparedFlight || !snapshot) {
      return { left: [], right: [] };
    }
    const startUs = Math.max(currentTimeUs - 1000000, preparedFlight.minTimeUs);
    const trailWindow = getFlightWindow(preparedFlight, startUs, currentTimeUs, 120);
    const trailSamples = trailWindow.samples
      .filter((sample) => sample.timeUs < currentTimeUs)
      .slice(-32);

    return {
      left: trailSamples
        .map((sample) =>
          mapMaybePoint(mapStickAxis(sample.rc.yaw), mapThrottleAxis(sample.rc.throttle))
        )
        .filter(Boolean),
      right: trailSamples
        .map((sample) =>
          mapMaybePoint(mapStickAxis(sample.rc.roll), mapStickAxis(negateMaybe(sample.rc.pitch)))
        )
        .filter(Boolean),
    };
  }, [preparedFlight, snapshot, currentTimeUs]);

  const stickGraphWindow = useMemo(() => {
    if (!preparedFlight) {
      return null;
    }

    return getFlightWindow(
      preparedFlight,
      currentTimeUs - overlayState.stickMiniGraphWindowUs,
      currentTimeUs + overlayState.stickMiniGraphWindowUs,
      180,
      {
        sampleStrategy: "fixed-interval",
        sampleIntervalUs: OVERLAY_SAMPLE_INTERVAL_US,
        anchorUs: preparedFlight.minTimeUs,
      }
    );
  }, [preparedFlight, currentTimeUs, overlayState.stickMiniGraphWindowUs]);

  const firstArmedTimeUs = useMemo(
    () => (preparedFlight ? getFirstArmedTimeUs(preparedFlight) : null),
    [preparedFlight]
  );
  const metricsWindow = useMemo(() => {
    if (!preparedFlight) {
      return null;
    }
    return getFlightWindow(
      preparedFlight,
      currentTimeUs - 1000000,
      currentTimeUs + 1000000,
      120,
      {
        sampleStrategy: "fixed-interval",
        sampleIntervalUs: OVERLAY_SAMPLE_INTERVAL_US,
        anchorUs: preparedFlight.minTimeUs,
      }
    );
  }, [preparedFlight, currentTimeUs]);

  async function runAutoSyncArmed(session = preparedFlight) {
    if (!session?.video || firstArmedTimeUs === null) {
      return;
    }

    autoSyncAbortRef.current?.abort();
    const abortController = new AbortController();
    autoSyncAbortRef.current = abortController;

    setVideoSyncMeta(session.id, {
      detectionStatus: "running",
      detectionMessage: "Scanning DVR for ARMED... Press Esc to cancel.",
    });

    try {
      const detected = await detectArmedOverlayTime(session.video.url, {
        maxScanSeconds: 10,
        signal: abortController.signal,
      });

      if (!detected) {
        setVideoSyncMeta(session.id, {
          detectionStatus: "failed",
          detectionMessage: "ARMED text was not detected in the first 10 seconds.",
        });
        return;
      }

      const offsetSeconds = calculateAutoVideoOffset(
        firstArmedTimeUs,
        detected.timeSeconds,
        session.minTimeUs
      );

      setVideoOffset(session.id, offsetSeconds);
      setVideoSyncMeta(session.id, {
        detectionStatus: "done",
        armedVideoTimeSeconds: detected.timeSeconds,
        armedLogTimeUs: firstArmedTimeUs,
        confidence: detected.confidence,
        detectionMessage: `ARMED detected at ${detected.timeSeconds.toFixed(
          2
        )}s (OCR ${detected.confidence.toFixed(0)}%)`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setVideoSyncMeta(session.id, {
          detectionStatus: "cancelled",
          detectionMessage: "Auto sync cancelled.",
        });
        return;
      }
      setVideoSyncMeta(session.id, {
        detectionStatus: "failed",
        detectionMessage:
          error instanceof Error ? error.message : "Auto sync failed.",
      });
    } finally {
      if (autoSyncAbortRef.current === abortController) {
        autoSyncAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!preparedFlight) {
      return undefined;
    }

    cancelAnimationFrame(playbackFrameRef.current);
    playbackFrameRef.current = 0;
    playbackClockRef.current = 0;

    const sync = videoSync[preparedFlight.id] ?? { offsetSeconds: 0 };

    const tick = (timestamp) => {
      if (preparedFlight.video && video && !video.paused && !video.seeking) {
        const syncedTimeUs =
          preparedFlight.minTimeUs +
          (video.currentTime - (sync.offsetSeconds ?? 0)) * 1000000;
        setCurrentTimeUs(clampTime(preparedFlight, syncedTimeUs));
      } else if (playback.isPlaying && !preparedFlight.video) {
        if (!playbackClockRef.current) {
          playbackClockRef.current = timestamp;
        }

        const deltaMs = timestamp - playbackClockRef.current;
        playbackClockRef.current = timestamp;

        setCurrentTimeUs((prevTimeUs) => {
          const nextTimeUs = prevTimeUs + deltaMs * 1000 * playback.rate;
          if (nextTimeUs >= preparedFlight.maxTimeUs) {
            setPlayback(false);
            return preparedFlight.maxTimeUs;
          }
          return nextTimeUs;
        });
      }

      if (
        (preparedFlight.video && video) ||
        (playback.isPlaying && !preparedFlight.video)
      ) {
        playbackFrameRef.current = requestAnimationFrame(tick);
      }
    };

    if ((preparedFlight.video && video) || playback.isPlaying) {
      playbackFrameRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = 0;
      playbackClockRef.current = 0;
    };
  }, [playback.isPlaying, playback.rate, preparedFlight, setCurrentTimeUs, setPlayback, videoSync]);

  useEffect(() => {
    const video = videoRef.current;
    if (!preparedFlight || !video || !preparedFlight.video) {
      return;
    }
    const sync = videoSync[preparedFlight.id] ?? { offsetSeconds: 0 };
    const expectedTime =
      (currentTimeUs - preparedFlight.minTimeUs) / 1000000 + (sync.offsetSeconds ?? 0);
    if (Math.abs(video.currentTime - expectedTime) > 0.08 && !video.seeking) {
      video.currentTime = Math.max(expectedTime, 0);
    }
  }, [currentTimeUs, preparedFlight, videoSync]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.playbackRate = playback.rate;
    if (playback.isPlaying) {
      void video.play().catch(() => setPlayback(false));
    } else {
      video.pause();
    }
  }, [playback, setPlayback]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code === "Escape" && preparedFlight?.id) {
        const syncState = videoSync[preparedFlight.id];
        if (syncState?.detectionStatus === "running") {
          event.preventDefault();
          autoSyncAbortRef.current?.abort();
        }
        return;
      }

      if (event.code !== "Space") {
        return;
      }

      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (isTypingTarget) {
        return;
      }

      event.preventDefault();
      setPlayback(!playback.isPlaying);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playback.isPlaying, preparedFlight, setPlayback, videoSync]);

  async function handleLogFiles(fileList) {
    setBusy(true);
    setLoadErrors([]);
    try {
      for (const file of Array.from(fileList)) {
        try {
          const result = await loadFlightSessionsFromFile(file);

          if (!result.sessions.length) {
            throw new Error("No readable log section was found in this file.");
          }

          for (const flight of result.sessions) {
            addFlight(flight);
          }

          if (result.unreadableSections.length) {
            setLoadErrors((current) => [
              ...current,
              `${file.name}: skipped ${result.unreadableSections.length} unreadable section(s).`,
            ]);
          }
        } catch (error) {
          setLoadErrors((current) => [
            ...current,
            `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          ]);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function handleVideoFiles(fileList) {
    if (!selectedFlight) {
      return;
    }
    const [file] = Array.from(fileList);
    if (!file) {
      return;
    }
    assignVideo(selectedFlight.id, createVideoAsset(file));
    setVideoSyncMeta(selectedFlight.id, {
      detectionStatus: "idle",
      detectionMessage: "DVR loaded. Preparing ARMED auto sync...",
    });
  }

  useEffect(() => {
    if (!preparedFlight?.video || firstArmedTimeUs === null) {
      return;
    }

    const state = videoSync[preparedFlight.id];
    if (state?.detectionStatus && state.detectionStatus !== "idle") {
      return;
    }

    void runAutoSyncArmed(preparedFlight);
  }, [preparedFlight, firstArmedTimeUs]);

  useEffect(() => {
    if (!preparedFlight?.id) {
      setSyncNoticeVisible(false);
      return undefined;
    }

    const state = videoSync[preparedFlight.id];
    const status = state?.detectionStatus;

    if (status === "running") {
      setSyncNoticeVisible(true);
      return undefined;
    }

    if (status === "done" || status === "failed" || status === "cancelled") {
      setSyncNoticeVisible(true);
      const timeoutId = window.setTimeout(() => setSyncNoticeVisible(false), 3200);
      return () => window.clearTimeout(timeoutId);
    }

    setSyncNoticeVisible(false);
    return undefined;
  }, [preparedFlight?.id, videoSync]);

  useEffect(() => {
    return () => {
      autoSyncAbortRef.current?.abort();
      autoSyncAbortRef.current = null;
    };
  }, []);

  if (!preparedFlight) {
    return (
      <div className="empty-state">
        <div className="empty-state__hero">
          <p className="eyebrow">Blackbox Flight Analyzer</p>
          <h1>Video-first Blackbox analysis for DVR review.</h1>
          <p>
            Load one or more `.bbl` logs first. Then attach a DVR clip to the selected
            flight and start reviewing sticks, tracking error, motor headroom, events,
            and A/B comparisons.
          </p>
          <div className="toolbar">
            <label className="file-button">
              Open logs
              <input
                type="file"
                accept=".bbl,.txt,.cfl,.bfl,.log"
                multiple
                onChange={(event) => handleLogFiles(event.target.files)}
              />
            </label>
          </div>
          {busy ? <p className="muted">Loading logs...</p> : null}
          {loadErrors.map((error) => (
            <p key={error} className="muted">
              {error}
            </p>
          ))}
        </div>
      </div>
    );
  }

  const sync = videoSync[preparedFlight.id] ?? { offsetSeconds: 0 };
  const motorStats = snapshot ? getMotorStats(snapshot.motors) : null;
  const showSyncNotice =
    syncNoticeVisible &&
    preparedFlight.video &&
    ["running", "done", "failed", "cancelled"].includes(sync.detectionStatus ?? "");

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Blackbox Flight Analyzer MVP</p>
          <h1>Video-led review with event-based comparison.</h1>
        </div>
        <div className="toolbar">
          <label className="file-button">
            Add logs
            <input
              type="file"
              accept=".bbl,.txt,.cfl,.bfl,.log"
              multiple
              onChange={(event) => handleLogFiles(event.target.files)}
            />
          </label>
          <label className="file-button file-button--ghost">
            Attach DVR
            <input
              type="file"
              accept=".mp4,.mov,.avi,.mpeg,.webm"
              onChange={(event) => handleVideoFiles(event.target.files)}
            />
          </label>
          <button className="transport" type="button" onClick={() => setPlayback(!playback.isPlaying)}>
            {playback.isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="transport"
            type="button"
            onClick={() => void runAutoSyncArmed(preparedFlight)}
            disabled={!preparedFlight.video || firstArmedTimeUs === null}
          >
            Auto sync ARMED
          </button>
          <label className="rate-slider">
            <span className="rate-slider__label">Playback</span>
            <div className="rate-slider__control">
              <input
                className="rate-slider__range"
                type="range"
                min={MIN_PLAYBACK_RATE}
                max={MAX_PLAYBACK_RATE}
                step={PLAYBACK_RATE_STEP}
                value={playback.rate}
                onChange={(event) => setPlaybackRate(Number(event.target.value))}
              />
              <strong className="rate-slider__value">
                {formatPlaybackRate(playback.rate)}
              </strong>
            </div>
          </label>
          <button
            className={`transport ${
              overlayState.stickMiniGraphEnabled ? "" : "transport--muted"
            }`}
            type="button"
            onClick={() =>
              setStickMiniGraphEnabled(!overlayState.stickMiniGraphEnabled)
            }
          >
            Stick graphs {overlayState.stickMiniGraphEnabled ? "On" : "Off"}
          </button>
          <select
            className="rate-select"
            value={overlayState.stickMiniGraphWindowUs}
            onChange={(event) =>
              setStickMiniGraphWindowUs(Number(event.target.value))
            }
          >
            <option value="500000">+-0.5s</option>
            <option value="1000000">+-1.0s</option>
            <option value="1500000">+-1.5s</option>
            <option value="2000000">+-2.0s</option>
          </select>
        </div>
        {loadErrors.map((error) => (
          <p key={error} className="muted">
            {error}
          </p>
        ))}
      </header>

      <section className="flight-strip">
        {flights.map((flight) => (
          <button
            key={flight.id}
            type="button"
            className={`flight-tab ${flight.id === preparedFlight.id ? "flight-tab--active" : ""}`}
            onClick={() => selectFlight(flight.id)}
            title={
              flight.totalLogSections > 1
                ? `${flight.fileName} · ${flight.logSectionLabel}`
                : flight.fileName
            }
          >
            {flight.totalLogSections > 1 ? (
              <>
                <div className="flight-tab__header">
                  <strong className="flight-tab__section">{flight.logSectionLabel}</strong>
                  <span className="flight-tab__duration">
                    {formatMicroseconds(flight.durationUs)}
                  </span>
                </div>
                <span className="flight-tab__source">{flight.fileName}</span>
              </>
            ) : (
              <>
                <strong className="flight-tab__section">{flight.name}</strong>
                <span className="flight-tab__duration">
                  {formatMicroseconds(flight.durationUs)}
                </span>
              </>
            )}
          </button>
        ))}
      </section>

      <main className="workspace">
        <section className="viewer">
          <div className="viewer__stage">
            {preparedFlight.video ? (
              <video
                ref={videoRef}
                className="viewer__video"
                src={preparedFlight.video.url}
                preload="auto"
                controls={false}
                muted
              />
            ) : (
              <div className="viewer__placeholder">
                <p>No DVR attached to this flight.</p>
                <span>Attach a video to overlay sticks and flight-state OSD on top.</span>
              </div>
            )}
            <div className="viewer__scrim" />
            {showSyncNotice ? (
              <div className="sync-notice-wrap">
                <div
                  className={`sync-notice sync-notice--${
                    sync.detectionStatus === "done"
                      ? "success"
                      : sync.detectionStatus === "cancelled"
                        ? "neutral"
                      : sync.detectionStatus === "failed"
                        ? "error"
                        : "running"
                  }`}
                >
                  <span className="sync-notice__eyebrow">Auto sync</span>
                  <strong className="sync-notice__title">
                    {sync.detectionStatus === "running"
                      ? "Scanning DVR..."
                      : sync.detectionStatus === "done"
                        ? "Sync OK"
                        : sync.detectionStatus === "cancelled"
                          ? "Sync cancelled"
                        : "Sync failed"}
                  </strong>
                  <p className="sync-notice__message">
                    {sync.detectionStatus === "running"
                      ? "Looking for ARMED in the DVR. Press Esc to cancel."
                      : sync.detectionMessage ?? "Auto sync finished."}
                  </p>
                </div>
              </div>
            ) : null}
            {snapshot ? (
              <>
                <div className="overlay overlay--top">
                  <StatusPill
                    label="ARM"
                    value={snapshot.mode.armed ? "Armed" : "Disarmed"}
                    accent={snapshot.mode.armed ? "good" : "warning"}
                    compact
                  />
                  <StatusPill
                    label="Mode"
                    value={snapshot.mode.names.slice(0, 3).join(", ") || "Acro"}
                    compact
                  />
                  <StatusPill label="Throttle" value={overlaySummary.throttleBand} compact />
                  <StatusPill label="Offset" value={`${(sync.offsetSeconds ?? 0).toFixed(2)}s`} compact />
                </div>
                <div className="overlay overlay--summary">
                  <StatusTimelineCard
                    snapshot={snapshot}
                    samples={metricsWindow?.samples ?? []}
                    currentTimeUs={currentTimeUs}
                  />
                  <ErrorTrendCard
                    snapshot={snapshot}
                    samples={metricsWindow?.samples ?? []}
                    currentTimeUs={currentTimeUs}
                  />
                </div>
                <div className="overlay overlay--sticks overlay--sticks-left">
                  <StickOverlay
                    title="Throttle / Yaw"
                    xValue={mapStickAxis(snapshot.rc.yaw)}
                    yValue={mapThrottleAxis(snapshot.rc.throttle)}
                    xLabel={`Yaw rc ${formatMaybeValue(snapshot.rc.yaw, 0)} / sp ${formatMaybeValue(snapshot.setpoint.yaw, 0)}`}
                    yLabel={`Thr rc ${formatMaybeValue(snapshot.rc.throttle, 0)} / raw ${formatMaybeValue(snapshot.rcRaw.throttle, 0, "%")}`}
                    trail={stickTrail.left}
                    rawPoint={
                      snapshot.rcRaw.yaw !== null && snapshot.rcRaw.throttle !== null
                        ? {
                            x: mapStickAxis(snapshot.rcRaw.yaw),
                            y: mapThrottleAxis(snapshot.rcRaw.throttle),
                          }
                        : null
                    }
                    setpointPoint={mapMaybePoint(
                      mapStickAxis(snapshot.setpoint.yaw),
                      mapThrottleAxis(snapshot.rc.throttle)
                    )}
                    miniGraph={
                      overlayState.stickMiniGraphEnabled && stickGraphWindow ? (
                        <StickHistoryMini
                          currentTimeUs={currentTimeUs}
                          channels={[
                            {
                              key: "throttle",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.throttle,
                              minValue: 0,
                              maxValue: 100,
                              className:
                                "stick-history__line stick-history__line--throttle",
                              legendClassName:
                                "stick-history__legend-swatch--throttle",
                              legendLabel: "Thr",
                            },
                            {
                              key: "yaw",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.yaw,
                              minValue: -500,
                              maxValue: 500,
                              className: "stick-history__line stick-history__line--yaw",
                              legendClassName: "stick-history__legend-swatch--yaw",
                              legendLabel: "Yaw",
                            },
                          ]}
                        />
                      ) : null
                    }
                  />
                </div>
                <div className="overlay overlay--sticks overlay--sticks-right">
                  <StickOverlay
                    title="Roll / Pitch"
                    xValue={mapStickAxis(snapshot.rc.roll)}
                    yValue={mapStickAxis(negateMaybe(snapshot.rc.pitch))}
                    xLabel={`Roll rc ${formatMaybeValue(snapshot.rc.roll, 0)} / sp ${formatMaybeValue(snapshot.setpoint.roll, 0)}`}
                    yLabel={`Pitch rc ${formatMaybeValue(snapshot.rc.pitch, 0)} / sp ${formatMaybeValue(snapshot.setpoint.pitch, 0)}`}
                    trail={stickTrail.right}
                    rawPoint={
                      snapshot.rcRaw.roll !== null && snapshot.rcRaw.pitch !== null
                        ? {
                            x: mapStickAxis(snapshot.rcRaw.roll),
                            y: mapStickAxis(negateMaybe(snapshot.rcRaw.pitch)),
                          }
                        : null
                    }
                    setpointPoint={mapMaybePoint(
                      mapStickAxis(snapshot.setpoint.roll),
                      mapStickAxis(negateMaybe(snapshot.setpoint.pitch))
                    )}
                    miniGraph={
                      overlayState.stickMiniGraphEnabled && stickGraphWindow ? (
                        <StickHistoryMini
                          currentTimeUs={currentTimeUs}
                          channels={[
                            {
                              key: "roll",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.roll,
                              minValue: -500,
                              maxValue: 500,
                              className:
                                "stick-history__line stick-history__line--roll",
                              legendClassName: "stick-history__legend-swatch--roll",
                              legendLabel: "Roll",
                            },
                            {
                              key: "pitch",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.pitch,
                              minValue: -500,
                              maxValue: 500,
                              className:
                                "stick-history__line stick-history__line--pitch",
                              legendClassName: "stick-history__legend-swatch--pitch",
                              legendLabel: "Pitch",
                            },
                          ]}
                        />
                      ) : null
                    }
                  />
                </div>
                <div className="overlay overlay--bottom">
                  <MotorDetailCard
                    motors={snapshot.motors}
                    spread={motorStats?.spread}
                    saturation={overlaySummary.saturation}
                  />
                  {snapshot.aux.slice(0, 3).map((aux) => (
                    <StatusPill
                      key={aux.label}
                      label={aux.label}
                      value={aux.active === null ? "n/a" : aux.active ? "High" : "Low"}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="timeline">
            <div className="timeline__meta">
              <span>{formatMicroseconds(currentTimeUs - preparedFlight.minTimeUs)}</span>
              <span>{preparedFlight.fileName}</span>
            </div>
            <input
              className="timeline__slider"
              type="range"
              min={preparedFlight.minTimeUs}
              max={preparedFlight.maxTimeUs}
              step="1000"
              value={currentTimeUs}
              onChange={(event) => setCurrentTimeUs(Number(event.target.value))}
            />
            <div className="timeline__controls">
              <label>
                Video offset
                <input
                  type="number"
                  step="0.05"
                  value={sync.offsetSeconds ?? 0}
                  onChange={(event) => setVideoOffset(preparedFlight.id, Number(event.target.value))}
                />
              </label>
              <label>
                Auto sync
                <div className="timeline__sync-status">
                  {sync.detectionStatus === "running"
                    ? "Scanning in viewer... Press Esc to cancel."
                    : sync.detectionStatus === "done"
                      ? `OK: ${sync.detectionMessage ?? "Auto sync finished."}`
                      : sync.detectionStatus === "cancelled"
                        ? `Cancelled: ${sync.detectionMessage ?? "Auto sync cancelled."}`
                      : sync.detectionStatus === "failed"
                        ? `NG: ${sync.detectionMessage ?? "Auto sync failed."}`
                        : sync.detectionMessage ?? "Not run"}
                </div>
              </label>
            </div>
          </div>

          <HistoryGraph flight={preparedFlight} currentTimeUs={currentTimeUs} />
        </section>

        <section className="sidecar">
          <EventList events={preparedFlight.events} onSelect={setCurrentTimeUs} />
          <ComparePanel
            flights={flights}
            compareSession={compareSession}
            onFlightChange={setCompareFlight}
            onEventTypeChange={setCompareEventType}
          />
        </section>
      </main>
    </div>
  );
}
