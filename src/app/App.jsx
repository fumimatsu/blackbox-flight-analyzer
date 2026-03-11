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
import { EVENT_TYPES, getEventLabel } from "../domain/blackbox/events/eventConfig.js";
import {
  getFlightStatusFlags,
  getFlightStatusSummary,
  getMotorStats,
  getRpmStats,
  getStickAxisUsage,
} from "../domain/blackbox/derived/flightDerived.js";
import { getCompareSummary } from "../domain/compare/compareMetrics.js";
import {
  calculateAutoVideoOffset,
  detectArmedOverlayTime,
} from "../domain/sync/autoVideoSync.js";
import { evaluateDiagnosticRules } from "../domain/analysis/diagnosticRules.js";
import { getFlightSetupSummary } from "../domain/blackbox/setup/flightSetupSummary.js";
import { SUPPORTED_LOCALES, translate } from "../i18n/index.js";
import { SetupSummaryPanel } from "./SetupSummaryPanel.jsx";

const OVERLAY_SAMPLE_INTERVAL_US = 25000;
const DIAGNOSTIC_EVENT_PADDING_US = 300000;
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

function formatCompareValue(metric, value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (metric.unit === "%") {
    return `${value.toFixed(1)}%`;
  }
  if (metric.unit) {
    return `${value.toFixed(1)}${metric.unit}`;
  }
  return value.toFixed(1);
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

function getAxisMeta(axisKey, t) {
  switch (axisKey) {
    case "roll":
      return {
        title: t("overlay.roll"),
        shortTitle: "Roll",
        mapValue: (value) => mapStickAxis(value),
        getValue: (snapshot, source) => snapshot[source].roll,
        getRawValue: (snapshot) => snapshot.rcRaw.roll,
        getSetpointValue: (snapshot) => snapshot.setpoint.roll,
        minValue: -500,
        maxValue: 500,
        lineClassName: "stick-history__line stick-history__line--roll",
        legendClassName: "stick-history__legend-swatch--roll",
      };
    case "pitch":
      return {
        title: t("overlay.pitch"),
        shortTitle: "Pitch",
        mapValue: (value) => mapStickAxis(negateMaybe(value)),
        getValue: (snapshot, source) => snapshot[source].pitch,
        getRawValue: (snapshot) => snapshot.rcRaw.pitch,
        getSetpointValue: (snapshot) => snapshot.setpoint.pitch,
        minValue: -500,
        maxValue: 500,
        lineClassName: "stick-history__line stick-history__line--pitch",
        legendClassName: "stick-history__legend-swatch--pitch",
      };
    case "yaw":
      return {
        title: t("overlay.yaw"),
        shortTitle: "Yaw",
        mapValue: (value) => mapStickAxis(value),
        getValue: (snapshot, source) => snapshot[source].yaw,
        getRawValue: (snapshot) => snapshot.rcRaw.yaw,
        getSetpointValue: (snapshot) => snapshot.setpoint.yaw,
        minValue: -500,
        maxValue: 500,
        lineClassName: "stick-history__line stick-history__line--yaw",
        legendClassName: "stick-history__legend-swatch--yaw",
      };
    case "throttle":
    default:
      return {
        title: t("overlay.throttle"),
        shortTitle: t("overlay.throttleShort"),
        mapValue: (value) => mapThrottleAxis(value),
        getValue: (snapshot, source) => snapshot[source].throttle,
        getRawValue: (snapshot) => snapshot.rcRaw.throttle,
        getSetpointValue: () => null,
        minValue: 0,
        maxValue: 100,
        lineClassName: "stick-history__line stick-history__line--throttle",
        legendClassName: "stick-history__legend-swatch--throttle",
      };
  }
}

function buildAxisLabel(snapshot, axisMeta) {
  const rcValue = axisMeta.getValue(snapshot, "rc");
  if (axisMeta.getSetpointValue(snapshot) !== null) {
    return `${axisMeta.shortTitle} rc ${formatMaybeValue(rcValue, 0)} / sp ${formatMaybeValue(
      axisMeta.getSetpointValue(snapshot),
      0
    )}`;
  }
  return `${axisMeta.shortTitle} rc ${formatMaybeValue(rcValue, 0)} / raw ${formatMaybeValue(
    axisMeta.getRawValue(snapshot),
    0,
    "%"
  )}`;
}

function formatUsageDescriptor(axisKey, usage, t) {
  if (!usage || (usage.min === null && usage.max === null)) {
    return null;
  }

  const isThrottle = axisKey === "throttle";
  const minValue = isThrottle ? 0 : -500;
  const maxValue = isThrottle ? 100 : 500;
  const range = maxValue - minValue || 1;
  const clampValue = (value) => Math.max(minValue, Math.min(maxValue, value ?? 0));
  const startValue = isThrottle ? Math.max(0, clampValue(usage.min)) : clampValue(usage.min);
  const endValue = clampValue(usage.max);
  const startPercent = ((startValue - minValue) / range) * 100;
  const endPercent = ((endValue - minValue) / range) * 100;

  return {
    key: axisKey,
    label: getAxisMeta(axisKey, t).shortTitle,
    centered: !isThrottle,
    startPercent,
    endPercent,
    valuesLabel: isThrottle
      ? `${formatMaybeValue(Math.max(0, clampValue(usage.min)), 0, "%")} / ${formatMaybeValue(
          Math.max(0, clampValue(usage.max)),
          0,
          "%"
        )}`
      : `-${formatMaybeValue(Math.abs(Math.min(0, clampValue(usage.min))) / 5, 0, "%")} / +${formatMaybeValue(
          Math.max(0, clampValue(usage.max)) / 5,
          0,
          "%"
        )}`,
    className: `stick-usage__range stick-usage__range--${axisKey}`,
  };
}

function buildStickUsage(stickKey, stickMode, usageSummary, t) {
  const isMode1 = stickMode === "mode1";
  const axes =
    stickKey === "left"
      ? isMode1
        ? ["yaw", "pitch"]
        : ["yaw", "throttle"]
      : isMode1
        ? ["roll", "throttle"]
        : ["roll", "pitch"];

  return axes
    .map((axisKey) => formatUsageDescriptor(axisKey, usageSummary?.[axisKey], t))
    .filter(Boolean);
}

function buildStickConfig(
  snapshot,
  trailSamples,
  stickKey,
  stickMode,
  t,
  stickGraphWindow,
  miniGraphEnabled,
  currentTimeUs,
  usageSummary
) {
  const isMode1 = stickMode === "mode1";
  const axes =
    stickKey === "left"
      ? isMode1
        ? ["yaw", "pitch"]
        : ["yaw", "throttle"]
      : isMode1
        ? ["roll", "throttle"]
        : ["roll", "pitch"];
  const [xAxisKey, yAxisKey] = axes;
  const xAxis = getAxisMeta(xAxisKey, t);
  const yAxis = getAxisMeta(yAxisKey, t);

  const titleMap = {
    "yaw-throttle": t("overlay.throttleYaw"),
    "roll-pitch": t("overlay.rollPitch"),
    "yaw-pitch": t("overlay.pitchYaw"),
    "roll-throttle": t("overlay.rollThrottle"),
  };

  const trail = trailSamples
    .map((sample) =>
      mapMaybePoint(
        xAxis.mapValue(xAxis.getValue(sample, "rc")),
        yAxis.mapValue(yAxis.getValue(sample, "rc"))
      )
    )
    .filter(Boolean);

  const rawPoint = mapMaybePoint(
    xAxis.mapValue(xAxis.getRawValue(snapshot)),
    yAxis.mapValue(yAxis.getRawValue(snapshot))
  );

  const setpointPoint = mapMaybePoint(
    xAxis.mapValue(xAxis.getSetpointValue(snapshot) ?? xAxis.getValue(snapshot, "rc")),
    yAxis.mapValue(yAxis.getSetpointValue(snapshot) ?? yAxis.getValue(snapshot, "rc"))
  );

  const miniGraph =
    miniGraphEnabled && stickGraphWindow
      ? (
          <StickHistoryMini
            currentTimeUs={currentTimeUs}
            channels={[
              {
                key: xAxisKey,
                samples: stickGraphWindow.samples,
                valueSelector: (sample) => xAxis.getValue(sample, "rc"),
                minValue: xAxis.minValue,
                maxValue: xAxis.maxValue,
                className: xAxis.lineClassName,
                legendClassName: xAxis.legendClassName,
                legendLabel: xAxis.shortTitle,
              },
              {
                key: yAxisKey,
                samples: stickGraphWindow.samples,
                valueSelector: (sample) => yAxis.getValue(sample, "rc"),
                minValue: yAxis.minValue,
                maxValue: yAxis.maxValue,
                className: yAxis.lineClassName,
                legendClassName: yAxis.legendClassName,
                legendLabel: yAxis.shortTitle,
              },
            ]}
            legendLabels={{
              [xAxisKey]: xAxis.shortTitle,
              [yAxisKey]: yAxis.shortTitle,
            }}
          />
        )
      : null;

  return {
    title: titleMap[`${xAxisKey}-${yAxisKey}`],
    xValue: xAxis.mapValue(xAxis.getValue(snapshot, "rc")),
    yValue: yAxis.mapValue(yAxis.getValue(snapshot, "rc")),
    xLabel: buildAxisLabel(snapshot, xAxis),
    yLabel: buildAxisLabel(snapshot, yAxis),
    trail,
    rawPoint,
    setpointPoint,
    miniGraph,
    usage: buildStickUsage(stickKey, stickMode, usageSummary, t),
  };
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

function prepareFlight(flight, locale = "en") {
  if (!flight) {
    return null;
  }
  const window = getFlightWindow(flight, flight.minTimeUs, flight.maxTimeUs);
  const setupSummary = getFlightSetupSummary(flight);
  return {
    ...flight,
    setupSummary,
    window,
    events: detectAnalysisEvents(window, locale),
  };
}

function buildDiagnosticFocusFlight(flight, selectedEvent) {
  if (!flight || !selectedEvent) {
    return flight;
  }

  const startUs = Math.max(flight.minTimeUs, selectedEvent.startUs - DIAGNOSTIC_EVENT_PADDING_US);
  const endUs = Math.min(flight.maxTimeUs, selectedEvent.endUs + DIAGNOSTIC_EVENT_PADDING_US);
  const focusedWindow = getFlightWindow(flight, startUs, endUs);
  const overlappingEvents = (flight.events ?? []).filter(
    (event) => event.startUs <= selectedEvent.endUs && event.endUs >= selectedEvent.startUs
  );

  return {
    ...flight,
    window: focusedWindow,
    events: overlappingEvents.length ? overlappingEvents : [selectedEvent],
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
  legendLabels,
  usage = [],
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
          {legendLabels.rc}
        </span>
        <span
          className={`stick-card__legend-item ${
            rawActive ? "" : "stick-card__legend-item--inactive"
          }`}
        >
          <i className="stick-card__legend-dot stick-card__legend-dot--raw" />
          {legendLabels.raw}
        </span>
        <span
          className={`stick-card__legend-item ${
            setpointActive ? "" : "stick-card__legend-item--inactive"
          }`}
        >
          <i className="stick-card__legend-dot stick-card__legend-dot--setpoint" />
          {legendLabels.setpoint}
        </span>
      </div>
      <div className="stick-usage">
        {usage.map((item) => (
          <div key={item.key} className="stick-usage__row">
            <span className="stick-usage__axis">{item.label}</span>
            <div className="stick-usage__track">
              {item.centered ? <span className="stick-usage__center" /> : null}
              <span
                className={item.className}
                style={{
                  left: `${Math.min(item.startPercent, item.endPercent)}%`,
                  width: `${Math.max(2, Math.abs(item.endPercent - item.startPercent))}%`,
                }}
              />
            </div>
            <span className="stick-usage__values">{item.valuesLabel}</span>
          </div>
        ))}
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

function OverlayToggleButton({ active, label, onClick, onLabel, offLabel }) {
  return (
    <button
      className={`transport transport--toggle ${active ? "" : "transport--muted"}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      {label} {active ? onLabel : offLabel}
    </button>
  );
}

function normalizeHeadingDegrees(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function AttitudeIndicator({ attitude, labels }) {
  const roll = attitude?.roll ?? null;
  const pitch = attitude?.pitch ?? null;
  const yaw = normalizeHeadingDegrees(attitude?.yaw ?? null);
  const rollText = formatMaybeValue(roll, 0, "°");
  const pitchText = formatMaybeValue(pitch, 0, "°");
  const yawText = formatMaybeValue(yaw, 0, "°");
  const quadStyle = {
    transform: `rotate(${yaw ?? 0}deg) rotateX(${-(pitch ?? 0) * 0.55}deg) rotateY(${(roll ?? 0) * 0.45}deg)`,
    opacity: roll === null && pitch === null && yaw === null ? 0.38 : 1,
  };

  return (
    <div className="attitude-card">
      <div className="attitude-card__header">
        <span>{labels.title}</span>
        <strong>{yawText}</strong>
      </div>
      <div className="attitude-card__scene">
        <div className="attitude-card__ring" />
        <div className="attitude-card__crosshair" />
        <div className="attitude-card__compass attitude-card__compass--front">{labels.front}</div>
        <div className="attitude-card__compass attitude-card__compass--rear">{labels.rear}</div>
        <div className="attitude-card__craft" style={quadStyle}>
          <span className="attitude-card__arm attitude-card__arm--diag-a" />
          <span className="attitude-card__arm attitude-card__arm--diag-b" />
          <span className="attitude-card__motor attitude-card__motor--front-left" />
          <span className="attitude-card__motor attitude-card__motor--front-right" />
          <span className="attitude-card__motor attitude-card__motor--rear-left" />
          <span className="attitude-card__motor attitude-card__motor--rear-right" />
          <span className="attitude-card__body">
            <span className="attitude-card__body-core" />
            <span className="attitude-card__nose" />
          </span>
        </div>
      </div>
      <div className="attitude-card__values">
        <span>{labels.roll} {rollText}</span>
        <span>{labels.pitch} {pitchText}</span>
        <span>{labels.yaw} {yawText}</span>
      </div>
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

function getFlagSegments(samples, flagKey, minDurationUs = 100000) {
  const segments = [];
  let currentStartUs = null;
  let currentEndUs = null;

  for (const sample of samples) {
    const flags = getFlightStatusFlags(sample);
    const active = Boolean(flags[flagKey]);

    if (active) {
      currentStartUs ??= sample.timeUs;
      currentEndUs = sample.timeUs;
      continue;
    }

    if (currentStartUs !== null && currentEndUs !== null) {
      if (currentEndUs - currentStartUs >= minDurationUs) {
        segments.push({ startUs: currentStartUs, endUs: currentEndUs });
      }
      currentStartUs = null;
      currentEndUs = null;
    }
  }

  if (currentStartUs !== null && currentEndUs !== null && currentEndUs - currentStartUs >= minDurationUs) {
    segments.push({ startUs: currentStartUs, endUs: currentEndUs });
  }

  return segments;
}

function buildEventRailLanes(events, maxLanes = 3) {
  const lanes = Array.from({ length: maxLanes }, () => []);

  for (const event of events) {
    let placed = false;
    for (const lane of lanes) {
      const previous = lane[lane.length - 1];
      if (!previous || previous.endUs <= event.startUs) {
        lane.push(event);
        placed = true;
        break;
      }
    }

    if (!placed) {
      lanes[maxLanes - 1].push({
        ...event,
        overflowed: true,
      });
    }
  }

  return lanes.filter((lane) => lane.length);
}

function EventTimelineCard({
  events,
  currentTimeUs,
  selectedEventId,
  onSelect,
  locale,
  t,
}) {
  const width = 176;
  const laneHeight = 12;
  const laneGap = 4;
  const topPad = 2;
  const startUs = events[0]?.windowStartUs ?? currentTimeUs ?? 0;
  const endUs = events[0]?.windowEndUs ?? startUs;
  const rangeUs = Math.max(endUs - startUs, 1);
  const lanes = buildEventRailLanes(events, 3);
  const height =
    topPad * 2 +
    Math.max(lanes.length, 1) * laneHeight +
    Math.max(lanes.length - 1, 0) * laneGap;
  const cursorX = getTimeCursorX(currentTimeUs, startUs, endUs, width);

  return (
    <div className="event-timeline">
      <div className="event-timeline__header">
        <span>{t("overlay.events")}</span>
        <strong>{events.length ? `${events.length}` : "0"}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="event-timeline__chart">
        <rect x="0" y="0" width={width} height={height} className="event-timeline__bg" />
        {lanes.length ? (
          lanes.map((lane, laneIndex) => {
            const y = topPad + laneIndex * (laneHeight + laneGap);
            return (
              <g key={`event-lane-${laneIndex}`}>
                <rect
                  x="0"
                  y={y}
                  width={width}
                  height={laneHeight}
                  rx="5"
                  className="event-timeline__lane"
                />
                {lane.map((event) => {
                  const x = ((event.startUs - startUs) / rangeUs) * width;
                  const endX = ((event.endUs - startUs) / rangeUs) * width;
                  return (
                    <rect
                      key={event.id}
                      x={x}
                      y={y}
                      width={Math.max(endX - x, 6)}
                      height={laneHeight}
                      rx="5"
                      className={`event-timeline__segment event-timeline__segment--${event.type} ${
                        selectedEventId === event.id ? "event-timeline__segment--active" : ""
                      } ${event.overflowed ? "event-timeline__segment--overflow" : ""}`}
                      onClick={() => onSelect(event)}
                    />
                  );
                })}
              </g>
            );
          })
        ) : (
          <text
            x={width / 2}
            y={height / 2 + 4}
            textAnchor="middle"
            className="event-timeline__empty"
          >
            {t("events.none")}
          </text>
        )}
        <line x1={cursorX} x2={cursorX} y1="0" y2={height} className="event-timeline__cursor" />
      </svg>
      <div className="event-timeline__legend">
        {Object.values(EVENT_TYPES).map((type) => (
          <span key={type} className="event-timeline__legend-item">
            <i className={`event-timeline__legend-dot event-timeline__legend-dot--${type}`} />
            {getEventLabel(type, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ErrorTrendCard({ snapshot, samples, currentTimeUs, t, locale }) {
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
        <span>{t("overlay.error")}</span>
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
            {t("overlay.noData")}
          </text>
        )}
      </svg>
    </div>
  );
}

function StatusTimelineCard({ snapshot, samples, currentTimeUs, t, locale }) {
  const width = 176;
  const laneConfigs = [
    { key: "headroomLimited", label: t("overlay.headroom"), className: "headroom" },
    { key: "trackingOff", label: t("overlay.tracking"), className: "tracking" },
    { key: "highSpeedRun", label: t("overlay.highThrottle"), className: "high-throttle" },
    { key: "throttleOff", label: t("overlay.throttleOff"), className: "throttle-off" },
  ];
  const laneHeight = 12;
  const laneGap = 4;
  const topPad = 2;
  const height = topPad * 2 + laneConfigs.length * laneHeight + (laneConfigs.length - 1) * laneGap;
  const startUs = samples[0]?.timeUs ?? 0;
  const endUs = samples[samples.length - 1]?.timeUs ?? startUs;
  const rangeUs = Math.max(endUs - startUs, 1);
  const cursorX = getTimeCursorX(currentTimeUs, startUs, endUs, width);
  const activeFlags = snapshot ? getFlightStatusFlags(snapshot) : null;

  return (
    <div className="status-timeline">
      <div className="status-timeline__header">
        <span>{t("overlay.status")}</span>
        <strong>{snapshot ? getFlightStatusSummary(snapshot, locale).label : t("common.na")}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="status-timeline__chart">
        <rect x="0" y="0" width={width} height={height} className="status-timeline__bg" />
        {laneConfigs.map((lane, laneIndex) => {
          const y = topPad + laneIndex * (laneHeight + laneGap);
          const segments = getFlagSegments(samples, lane.key);

          return (
            <g key={lane.key}>
              <rect
                x="0"
                y={y}
                width={width}
                height={laneHeight}
                rx="5"
                className="status-timeline__lane"
              />
              {segments.map((segment, index) => {
                const x = ((segment.startUs - startUs) / rangeUs) * width;
                const endX = ((segment.endUs - startUs) / rangeUs) * width;
                return (
                  <rect
                    key={`${lane.key}-${index}`}
                    x={x}
                    y={y}
                    width={Math.max(endX - x, 5)}
                    height={laneHeight}
                    rx="5"
                    className={`status-timeline__segment status-timeline__segment--${lane.className}`}
                  />
                );
              })}
              {activeFlags?.[lane.key] ? (
                <circle
                  cx="6"
                  cy={y + laneHeight / 2}
                  r="2.5"
                  className={`status-timeline__marker status-timeline__marker--${lane.className}`}
                />
              ) : null}
            </g>
          );
        })}
        <line x1={cursorX} x2={cursorX} y1="0" y2={height} className="status-timeline__cursor" />
      </svg>
      <div className="status-timeline__legend">
        {laneConfigs.map((lane) => (
          <span key={lane.key} className="status-timeline__legend-item">
            <i className={`status-timeline__legend-dot status-timeline__legend-dot--${lane.className}`} />
            {lane.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MotorDetailCard({ motors, spread, saturation, t }) {
  const peak = motors.length ? Math.max(...motors) : null;

  return (
    <div className="motor-detail">
      <div className="motor-detail__header">
        <span>{t("overlay.motors")}</span>
        <div className="motor-detail__summary">
          <strong>{peak === null ? t("common.na") : percent(peak)}</strong>
          <em>{t("overlay.spread")} {percent(spread)}</em>
          <em>
            {t("overlay.headroom")}{" "}
            {peak === null ? t("common.na") : saturation ? t("overlay.headroomLow") : t("overlay.headroomOk")}
          </em>
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
                {value === null ? t("common.na") : `${Math.round(value)}%`}
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
  legendLabels,
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
          className="stick-history__cursor-glow"
        />
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
            {legendLabels?.[channel.key] ?? channel.legendLabel}
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryGraph({ flight, currentTimeUs, t }) {
  const width = 960;
  const laneHeight = 42;
  const lanes = [
    {
      key: "throttle",
      label: t("history.throttle"),
      className: "history__line history__line--throttle",
      valueSelector: (sample) => sample.rc.throttle,
    },
    {
      key: "roll",
      label: t("history.rollError"),
      className: "history__line history__line--roll",
      valueSelector: (sample) => sample.error.roll,
    },
    {
      key: "pitch",
      label: t("history.pitchError"),
      className: "history__line history__line--pitch",
      valueSelector: (sample) => sample.error.pitch,
    },
    {
      key: "rpm",
      label: t("history.rpmAvg"),
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
        <h3>{t("history.title")}</h3>
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

function EventList({ events, onSelect, selectedEventId, t }) {
  return (
    <div className="event-list">
      <h3>{t("events.title")}</h3>
      {events.length ? (
        events.slice(0, 12).map((event) => (
          <button
            key={event.id}
            className={`event-list__item ${
              selectedEventId === event.id ? "event-list__item--active" : ""
            }`}
            type="button"
            onClick={() => onSelect(event)}
          >
            <div className="event-list__content">
              <strong>{event.summary}</strong>
              <span>{event.detail}</span>
            </div>
            <span className="event-list__time">{formatMicroseconds(event.startUs)}</span>
          </button>
        ))
      ) : (
        <p className="muted">{t("events.none")}</p>
      )}
    </div>
  );
}

function ComparePanel({ flights, compareSession, onFlightChange, onEventTypeChange, locale, t }) {
  const preparedA = useMemo(
    () => prepareFlight(flights.find((flight) => flight.id === compareSession.flightAId), locale),
    [flights, compareSession.flightAId, locale]
  );
  const preparedB = useMemo(
    () => prepareFlight(flights.find((flight) => flight.id === compareSession.flightBId), locale),
    [flights, compareSession.flightBId, locale]
  );
  const summary = useMemo(
    () => getCompareSummary(preparedA, preparedB, compareSession.selectedEventType, locale),
    [preparedA, preparedB, compareSession.selectedEventType, locale]
  );

  return (
    <aside className="compare-panel">
      <div className="compare-panel__header">
        <h3>{t("compare.title")}</h3>
        <p>{t("compare.description")}</p>
      </div>
      <div className="compare-panel__controls">
        <label>
          {t("compare.flightA")}
          <select
            value={compareSession.flightAId ?? ""}
            onChange={(event) => onFlightChange("flightAId", event.target.value)}
          >
            <option value="">{t("common.select")}</option>
            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("compare.flightB")}
          <select
            value={compareSession.flightBId ?? ""}
            onChange={(event) => onFlightChange("flightBId", event.target.value)}
          >
            <option value="">{t("common.select")}</option>
            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("compare.eventFocus")}
          <select
            value={compareSession.selectedEventType ?? ""}
            onChange={(event) => onEventTypeChange(event.target.value || null)}
          >
            <option value="">{t("compare.wholeFlight")}</option>
            {Object.values(EVENT_TYPES).map((type) => (
              <option key={type} value={type}>
                {getEventLabel(type, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {summary ? (
        <div className="compare-panel__metrics">
          <div className="compare-metric compare-metric--context">
            <span>{t("compare.scope")}</span>
            <strong>{summary.scopeLabel}</strong>
            <p>
              A {summary.coverage.a.sampleCount} samples /{" "}
              {summary.coverage.a.durationSeconds.toFixed(2)}s
              {compareSession.selectedEventType
                ? ` / ${summary.coverage.a.eventCount} events`
                : ""}
            </p>
            <p>
              B {summary.coverage.b.sampleCount} samples /{" "}
              {summary.coverage.b.durationSeconds.toFixed(2)}s
              {compareSession.selectedEventType
                ? ` / ${summary.coverage.b.eventCount} events`
                : ""}
            </p>
          </div>
          {summary.metrics.map((metric) => (
            <div key={metric.label} className="compare-metric">
              <span>{metric.label}</span>
              <strong>
                A {formatCompareValue(metric, metric.a)} / B{" "}
                {formatCompareValue(metric, metric.b)}
              </strong>
              <em>
                {signed(metric.delta, 1)}
                {metric.unit}
                {" · "}
                {metric.smallerIsBetter ? t("compare.lowerBetter") : t("compare.higherBetter")}
              </em>
              <p>{metric.meaning}</p>
            </div>
          ))}
          {summary.notes.length ? (
            <div className="compare-metric compare-metric--notes">
              <span>{t("compare.limits")}</span>
              {summary.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">{t("compare.noSummary")}</p>
      )}
    </aside>
  );
}

function DiagnosticPanel({ insights, focusLabel, focusMeta, onClearFocus, isEventFocused, t }) {
  return (
    <aside className="compare-panel diagnostic-panel">
      <div className="compare-panel__header">
        <h3>{t("diagnostics.title")}</h3>
        <p>{t("diagnostics.description")}</p>
        <div className="diagnostic-panel__scope">
          <div className="diagnostic-panel__scope-copy">
            <span>{t("diagnostics.scope")}</span>
            <strong>{focusLabel}</strong>
            {focusMeta ? <em>{focusMeta}</em> : null}
          </div>
          {isEventFocused ? (
            <button className="transport transport--ghost" type="button" onClick={onClearFocus}>
              {t("diagnostics.showWholeFlight")}
            </button>
          ) : null}
        </div>
      </div>
      {insights.length ? (
        <div className="compare-panel__metrics">
          {insights.map((insight) => (
            <div key={insight.id} className="compare-metric diagnostic-card">
              <span>{t("diagnostics.likelyRelatedTo")}</span>
              <strong>{insight.label}</strong>
              <em>{t("diagnostics.confidence", { value: insight.confidence })}</em>
              <p>{insight.evidenceSummary}</p>
              <div className="diagnostic-card__section">
                <span>{t("diagnostics.checkNext")}</span>
                {insight.likelyChecks.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
              <div className="diagnostic-card__section">
                <span>{t("diagnostics.officialBasis")}</span>
                {insight.officialSources.map((source) => (
                  <p key={source}>
                    <a href={source} target="_blank" rel="noreferrer">
                      {source}
                    </a>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{t("diagnostics.empty")}</p>
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
  const locale = useAppStore((state) => state.locale);
  const stickMode = useAppStore((state) => state.stickMode);
  const selectedReviewEventId = useAppStore((state) => state.selectedReviewEventId);
  const selectedFlight = useSelectedFlight();
  const setLocale = useAppStore((state) => state.setLocale);
  const setStickMode = useAppStore((state) => state.setStickMode);
  const t = (key, params) => translate(locale, key, params);
  const preparedFlight = useMemo(() => prepareFlight(selectedFlight, locale), [selectedFlight, locale]);
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
  const setSelectedReviewEventId = useAppStore((state) => state.setSelectedReviewEventId);
  const setVideoOffset = useAppStore((state) => state.setVideoOffset);
  const setCompareFlight = useAppStore((state) => state.setCompareFlight);
  const setCompareEventType = useAppStore((state) => state.setCompareEventType);
  const setVideoSyncMeta = useAppStore((state) => state.setVideoSyncMeta);
  const setStickMiniGraphEnabled = useAppStore(
    (state) => state.setStickMiniGraphEnabled
  );
  const setOverlayVisibility = useAppStore((state) => state.setOverlayVisibility);
  const resetOverlayVisibility = useAppStore((state) => state.resetOverlayVisibility);

  const snapshot = useMemo(() => {
    if (!preparedFlight) {
      return null;
    }
    return getFlightSnapshot(preparedFlight, currentTimeUs);
  }, [preparedFlight, currentTimeUs]);

  const overlaySummary = snapshot ? getFlightStatusSummary(snapshot, locale) : null;
  const selectedReviewEvent = useMemo(
    () =>
      preparedFlight?.events?.find((event) => event.id === selectedReviewEventId) ?? null,
    [preparedFlight, selectedReviewEventId]
  );
  const diagnosticFlight = useMemo(
    () => buildDiagnosticFocusFlight(preparedFlight, selectedReviewEvent),
    [preparedFlight, selectedReviewEvent]
  );
  const diagnosticInsights = useMemo(
    () => (diagnosticFlight ? evaluateDiagnosticRules(diagnosticFlight, locale) : []),
    [diagnosticFlight, locale]
  );
  const stickUsage = useMemo(
    () => (preparedFlight?.window?.samples ? getStickAxisUsage(preparedFlight.window.samples) : null),
    [preparedFlight]
  );
  const setupSummary = preparedFlight?.setupSummary ?? null;

  const trailSamples = useMemo(() => {
    if (!preparedFlight || !snapshot) {
      return [];
    }
    const startUs = Math.max(currentTimeUs - 1000000, preparedFlight.minTimeUs);
    const trailWindow = getFlightWindow(preparedFlight, startUs, currentTimeUs, 120);
    return trailWindow.samples
      .filter((sample) => sample.timeUs < currentTimeUs)
      .slice(-32);
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
  const diagnosticScopeLabel = selectedReviewEvent
    ? selectedReviewEvent.summary
    : t("diagnostics.wholeFlight");
  const diagnosticScopeMeta = selectedReviewEvent
    ? `${formatMicroseconds(selectedReviewEvent.startUs)} - ${formatMicroseconds(
        selectedReviewEvent.endUs
      )}`
    : t("diagnostics.wholeFlightDescription");

  useEffect(() => {
    if (!preparedFlight?.events?.length) {
      if (selectedReviewEventId !== null) {
        setSelectedReviewEventId(null);
      }
      return;
    }
    if (
      selectedReviewEventId &&
      !preparedFlight.events.some((event) => event.id === selectedReviewEventId)
    ) {
      setSelectedReviewEventId(null);
    }
  }, [preparedFlight, selectedReviewEventId, setSelectedReviewEventId]);
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
  const summaryEvents = useMemo(() => {
    if (!preparedFlight || !metricsWindow) {
      return [];
    }

    return preparedFlight.events
      .filter(
        (event) =>
          event.startUs <= metricsWindow.endUs && event.endUs >= metricsWindow.startUs
      )
      .map((event) => ({
        ...event,
        windowStartUs: metricsWindow.startUs,
        windowEndUs: metricsWindow.endUs,
      }));
  }, [preparedFlight, metricsWindow]);

  const leftStickConfig = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return buildStickConfig(
      snapshot,
      trailSamples,
      "left",
      stickMode,
      t,
      stickGraphWindow,
      overlayState.stickMiniGraphEnabled,
      currentTimeUs,
      stickUsage
    );
  }, [
    snapshot,
    trailSamples,
    stickMode,
    stickGraphWindow,
    overlayState.stickMiniGraphEnabled,
    currentTimeUs,
    stickUsage,
    t,
  ]);

  const rightStickConfig = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return buildStickConfig(
      snapshot,
      trailSamples,
      "right",
      stickMode,
      t,
      stickGraphWindow,
      overlayState.stickMiniGraphEnabled,
      currentTimeUs,
      stickUsage
    );
  }, [
    snapshot,
    trailSamples,
    stickMode,
    stickGraphWindow,
    overlayState.stickMiniGraphEnabled,
    currentTimeUs,
    stickUsage,
    t,
  ]);

  async function runAutoSyncArmed(session = preparedFlight) {
    if (!session?.video || firstArmedTimeUs === null) {
      return;
    }

    autoSyncAbortRef.current?.abort();
    const abortController = new AbortController();
    autoSyncAbortRef.current = abortController;

    setVideoSyncMeta(session.id, {
      detectionStatus: "running",
      detectionMessage: t("syncNotice.scanningMessage"),
    });

    try {
      const detected = await detectArmedOverlayTime(session.video.url, {
        maxScanSeconds: 10,
        signal: abortController.signal,
      });

      if (!detected) {
        setVideoSyncMeta(session.id, {
          detectionStatus: "failed",
          detectionMessage: t("syncNotice.notDetected"),
        });
        return;
      }

      if (detected.accepted === false) {
        setVideoSyncMeta(session.id, {
          detectionStatus: "failed",
          confidence: detected.confidence,
          armedVideoTimeSeconds: detected.timeSeconds,
          detectionMessage: t("syncNotice.rejectedCandidate", {
            time: detected.timeSeconds.toFixed(2),
            confidence: detected.confidence.toFixed(0),
          }),
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
        detectionMessage: t("syncNotice.detectedAt", {
          time: detected.timeSeconds.toFixed(2),
          confidence: detected.confidence.toFixed(0),
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setVideoSyncMeta(session.id, {
          detectionStatus: "cancelled",
          detectionMessage: t("timeline.autoSyncCancelled"),
        });
        return;
      }
      setVideoSyncMeta(session.id, {
        detectionStatus: "failed",
        detectionMessage:
          error instanceof Error ? error.message : t("timeline.autoSyncFailed"),
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
            throw new Error(t("errors.noReadableSection"));
          }

          for (const flight of result.sessions) {
            addFlight(flight);
          }

          if (result.unreadableSections.length) {
            setLoadErrors((current) => [
              ...current,
              t("errors.skippedUnreadable", {
                file: file.name,
                count: result.unreadableSections.length,
              }),
            ]);
          }
        } catch (error) {
          setLoadErrors((current) => [
            ...current,
            t("errors.fileError", {
              file: file.name,
              message: error instanceof Error ? error.message : String(error),
            }),
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
      detectionMessage: t("syncNotice.loadedPreparing"),
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
          <p className="eyebrow">{t("app.emptyEyebrow")}</p>
          <h1>{t("app.emptyTitle")}</h1>
          <p>{t("app.emptyBody")}</p>
          <div className="toolbar">
            <label className="file-button">
              {t("app.openLogs")}
              <input
                type="file"
                accept=".bbl,.txt,.cfl,.bfl,.log"
                multiple
                onChange={(event) => handleLogFiles(event.target.files)}
              />
            </label>
          </div>
          {busy ? <p className="muted">{t("common.loading")}</p> : null}
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
  const overlayControls = [
    { key: "topBarVisible", label: t("app.top") },
    { key: "summaryVisible", label: t("app.summary") },
    { key: "attitudeVisible", label: t("app.attitude") },
    { key: "stickOverlayVisible", label: t("app.sticks") },
    { key: "bottomMetricsVisible", label: t("app.bottom") },
    { key: "historyOpen", label: t("app.history") },
    { key: "compareOpen", label: t("app.compare") },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{t("app.eyebrow")}</p>
          <h1>{t("app.title")}</h1>
        </div>
        <div className="toolbar">
          <label className="file-button">
            {t("app.addLogs")}
            <input
              type="file"
              accept=".bbl,.txt,.cfl,.bfl,.log"
              multiple
              onChange={(event) => handleLogFiles(event.target.files)}
            />
          </label>
          <label className="file-button file-button--ghost">
            {t("app.attachDvr")}
            <input
              type="file"
              accept=".mp4,.mov,.avi,.mpeg,.webm"
              onChange={(event) => handleVideoFiles(event.target.files)}
            />
          </label>
          <button className="transport" type="button" onClick={() => setPlayback(!playback.isPlaying)}>
            {playback.isPlaying ? t("app.pause") : t("app.play")}
          </button>
          <button
            className="transport"
            type="button"
            onClick={() => void runAutoSyncArmed(preparedFlight)}
            disabled={!preparedFlight.video || firstArmedTimeUs === null}
          >
            {t("app.autoSyncArmed")}
          </button>
          <label className="rate-select-wrap">
            <span className="rate-slider__label">{t("locale.label")}</span>
            <select
              className="rate-select"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              {SUPPORTED_LOCALES.map((option) => (
                <option key={option} value={option}>
                  {t(`locale.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="rate-slider">
            <span className="rate-slider__label">{t("app.playback")}</span>
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
            {t("app.stickGraphs")} {overlayState.stickMiniGraphEnabled ? t("common.on") : t("common.off")}
          </button>
          <label className="rate-select-wrap">
            <span className="rate-slider__label">{t("app.stickMode")}</span>
            <select
              className="rate-select"
              value={stickMode}
              onChange={(event) => setStickMode(event.target.value)}
            >
              <option value="mode1">{t("app.mode1")}</option>
              <option value="mode2">{t("app.mode2")}</option>
            </select>
          </label>
        </div>
        {loadErrors.map((error) => (
          <p key={error} className="muted">
            {error}
          </p>
        ))}
        <div className="toolbar toolbar--secondary">
          <span className="toolbar__label">{t("common.view")}</span>
          {overlayControls.map((control) => (
            <OverlayToggleButton
              key={control.key}
              label={control.label}
              active={overlayState[control.key]}
              onLabel={t("common.on")}
              offLabel={t("common.off")}
              onClick={() =>
                setOverlayVisibility(control.key, !overlayState[control.key])
              }
            />
          ))}
          <button className="transport transport--ghost" type="button" onClick={resetOverlayVisibility}>
            {t("common.resetView")}
          </button>
        </div>
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
                <p>{t("app.noDvr")}</p>
                <span>{t("app.noDvrHelp")}</span>
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
                  <span className="sync-notice__eyebrow">{t("syncNotice.eyebrow")}</span>
                  <strong className="sync-notice__title">
                    {sync.detectionStatus === "running"
                      ? t("syncNotice.scanningTitle")
                      : sync.detectionStatus === "done"
                        ? t("syncNotice.successTitle")
                        : sync.detectionStatus === "cancelled"
                          ? t("syncNotice.cancelledTitle")
                        : t("syncNotice.failedTitle")}
                  </strong>
                  <p className="sync-notice__message">
                    {sync.detectionStatus === "running"
                      ? t("syncNotice.scanningMessage")
                      : sync.detectionMessage ?? t("syncNotice.fallback")}
                  </p>
                </div>
              </div>
            ) : null}
            {snapshot ? (
              <>
                {overlayState.topBarVisible ? (
                  <div className="overlay overlay--top">
                    <StatusPill
                      label={t("overlay.arm")}
                      value={snapshot.mode.armed ? t("overlay.armed") : t("overlay.disarmed")}
                      accent={snapshot.mode.armed ? "good" : "warning"}
                      compact
                    />
                    <StatusPill
                      label={t("overlay.mode")}
                      value={snapshot.mode.names.slice(0, 3).join(", ") || "Acro"}
                      compact
                    />
                    <StatusPill label={t("overlay.throttle")} value={overlaySummary.throttleBand} compact />
                    <StatusPill label={t("overlay.offset")} value={`${(sync.offsetSeconds ?? 0).toFixed(2)}s`} compact />
                  </div>
                ) : null}
                {overlayState.summaryVisible ? (
                  <div className="overlay overlay--summary">
                    <StatusTimelineCard
                      snapshot={snapshot}
                      samples={metricsWindow?.samples ?? []}
                      currentTimeUs={currentTimeUs}
                      t={t}
                      locale={locale}
                    />
                    <EventTimelineCard
                      events={summaryEvents}
                      currentTimeUs={currentTimeUs}
                      selectedEventId={selectedReviewEventId}
                      onSelect={(event) => {
                        setCurrentTimeUs(event.startUs);
                        setSelectedReviewEventId(
                          selectedReviewEventId === event.id ? null : event.id
                        );
                      }}
                      locale={locale}
                      t={t}
                    />
                    <ErrorTrendCard
                      snapshot={snapshot}
                      samples={metricsWindow?.samples ?? []}
                      currentTimeUs={currentTimeUs}
                      t={t}
                      locale={locale}
                    />
                  </div>
                ) : null}
                {overlayState.attitudeVisible ? (
                  <div className="overlay overlay--attitude">
                    <AttitudeIndicator
                      attitude={snapshot.attitude}
                      labels={{
                        title: t("overlay.attitude"),
                        front: t("overlay.front"),
                        rear: t("overlay.rear"),
                        roll: "R",
                        pitch: "P",
                        yaw: "Y",
                      }}
                    />
                  </div>
                ) : null}
                {overlayState.bottomMetricsVisible ? (
                  <div className="overlay overlay--right-metrics">
                    <MotorDetailCard
                      motors={snapshot.motors}
                      spread={motorStats?.spread}
                      saturation={overlaySummary.saturation}
                      t={t}
                    />
                  </div>
                ) : null}
                {overlayState.stickOverlayVisible ? (
                  <>
                    <div className="overlay overlay--sticks overlay--sticks-left">
                      {leftStickConfig ? (
                        <StickOverlay
                          {...leftStickConfig}
                          legendLabels={{
                            rc: t("overlay.rc"),
                            raw: t("overlay.raw"),
                            setpoint: t("overlay.setpoint"),
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="overlay overlay--sticks overlay--sticks-right">
                      {rightStickConfig ? (
                        <StickOverlay
                          {...rightStickConfig}
                          legendLabels={{
                            rc: t("overlay.rc"),
                            raw: t("overlay.raw"),
                            setpoint: t("overlay.setpoint"),
                          }}
                        />
                      ) : null}
                    </div>
                  </>
                ) : null}
                {overlayState.bottomMetricsVisible ? (
                  <div className="overlay overlay--bottom">
                    {snapshot.aux.slice(0, 3).map((aux) => (
                      <StatusPill
                        key={aux.label}
                        label={aux.label}
                        value={
                          aux.active === null
                            ? t("common.na")
                            : aux.active
                              ? t("common.high")
                              : t("common.low")
                        }
                      />
                    ))}
                  </div>
                ) : null}
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
                {t("timeline.videoOffset")}
                <input
                  type="number"
                  step="0.05"
                  value={sync.offsetSeconds ?? 0}
                  onChange={(event) => setVideoOffset(preparedFlight.id, Number(event.target.value))}
                />
              </label>
              <label>
                {t("timeline.autoSync")}
                <div className="timeline__sync-status">
                  {sync.detectionStatus === "running"
                    ? t("timeline.scanningViewer")
                    : sync.detectionStatus === "done"
                      ? t("timeline.syncOk", {
                          message: sync.detectionMessage ?? t("timeline.autoSyncFinished"),
                        })
                      : sync.detectionStatus === "cancelled"
                        ? t("timeline.syncCancelled", {
                            message: sync.detectionMessage ?? t("timeline.autoSyncCancelled"),
                          })
                        : sync.detectionStatus === "failed"
                        ? t("timeline.syncFailed", {
                            message: sync.detectionMessage ?? t("timeline.autoSyncFailed"),
                          })
                        : sync.detectionMessage ?? t("timeline.notRun")}
                </div>
              </label>
            </div>
          </div>
          <SetupSummaryPanel summary={setupSummary} t={t} />
          {overlayState.historyOpen ? (
            <HistoryGraph flight={preparedFlight} currentTimeUs={currentTimeUs} t={t} />
          ) : null}
        </section>

        <section className="sidecar">
          <DiagnosticPanel
            insights={diagnosticInsights}
            focusLabel={diagnosticScopeLabel}
            focusMeta={diagnosticScopeMeta}
            isEventFocused={Boolean(selectedReviewEvent)}
            onClearFocus={() => setSelectedReviewEventId(null)}
            t={t}
          />
          <EventList
            events={preparedFlight.events}
            selectedEventId={selectedReviewEventId}
            onSelect={(event) => {
              setCurrentTimeUs(event.startUs);
              setSelectedReviewEventId(
                selectedReviewEventId === event.id ? null : event.id
              );
            }}
            t={t}
          />
          {overlayState.compareOpen ? (
            <ComparePanel
              flights={flights}
              compareSession={compareSession}
              onFlightChange={setCompareFlight}
              onEventTypeChange={setCompareEventType}
              locale={locale}
              t={t}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
