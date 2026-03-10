import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "./store/useAppStore.js";
import {
  createVideoAsset,
  loadFlightSessionFromFile,
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
  return `${value.toFixed(digits)}%`;
}

function signed(value, digits = 1) {
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
          style={{ left: `${xValue}%`, top: `${yValue}%` }}
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

function StatusPill({ label, value, accent = "neutral" }) {
  return (
    <div className={`status-pill status-pill--${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TinyMetric({ label, value }) {
  return (
    <div className="tiny-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function polylinePoints(samples, valueSelector, width, height) {
  if (!samples.length) {
    return "";
  }
  const values = samples.map(valueSelector);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return samples
    .map((sample, index) => {
      const x = (index / Math.max(samples.length - 1, 1)) * width;
      const y = height - ((valueSelector(sample) - min) / range) * height;
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
  if (!samples.length) {
    return "";
  }

  const range = maxValue - minValue || 1;
  return samples
    .map((sample, index) => {
      const x = (index / Math.max(samples.length - 1, 1)) * width;
      const value = Math.max(minValue, Math.min(maxValue, valueSelector(sample)));
      const y = height - ((value - minValue) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function StickHistoryMini({ channels, width = 250, height = 54 }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="stick-history">
      <rect x="0" y="0" width={width} height={height} className="stick-history__bg" />
      <line
        x1={width / 2}
        x2={width / 2}
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
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
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
      left: trailSamples.map((sample) =>
        ({
          x: mapStickAxis(sample.rc.yaw),
          y: mapThrottleAxis(sample.rc.throttle),
        })
      ),
      right: trailSamples.map((sample) =>
        ({
          x: mapStickAxis(sample.rc.roll),
          y: mapStickAxis(-sample.rc.pitch),
        })
      ),
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
      180
    );
  }, [preparedFlight, currentTimeUs, overlayState.stickMiniGraphWindowUs]);

  const firstArmedTimeUs = useMemo(
    () => (preparedFlight ? getFirstArmedTimeUs(preparedFlight) : null),
    [preparedFlight]
  );

  async function runAutoSyncArmed(session = preparedFlight) {
    if (!session?.video || firstArmedTimeUs === null) {
      return;
    }

    setVideoSyncMeta(session.id, {
      detectionStatus: "running",
      detectionMessage: "Scanning DVR for ARMED...",
    });

    try {
      const detected = await detectArmedOverlayTime(session.video.url, {
        maxScanSeconds: 10,
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
      setVideoSyncMeta(session.id, {
        detectionStatus: "failed",
        detectionMessage:
          error instanceof Error ? error.message : "Auto sync failed.",
      });
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
  }, [playback.isPlaying, setPlayback]);

  async function handleLogFiles(fileList) {
    setBusy(true);
    setLoadError("");
    try {
      for (const file of Array.from(fileList)) {
        try {
          const flight = await loadFlightSessionFromFile(file);
          addFlight(flight);
        } catch (error) {
          setLoadError(
            `${file.name}: ${error instanceof Error ? error.message : String(error)}`
          );
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
          {loadError ? <p className="muted">{loadError}</p> : null}
        </div>
      </div>
    );
  }

  const sync = videoSync[preparedFlight.id] ?? { offsetSeconds: 0 };
  const motorStats = snapshot ? getMotorStats(snapshot.motors) : null;
  const rpmStats = snapshot ? getRpmStats(snapshot.rpm) : null;

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
          <select
            className="rate-select"
            value={playback.rate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
          >
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
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
        {loadError ? <p className="muted">{loadError}</p> : null}
      </header>

      <section className="flight-strip">
        {flights.map((flight) => (
          <button
            key={flight.id}
            type="button"
            className={`flight-tab ${flight.id === preparedFlight.id ? "flight-tab--active" : ""}`}
            onClick={() => selectFlight(flight.id)}
          >
            <strong>{flight.name}</strong>
            <span>{formatMicroseconds(flight.durationUs)}</span>
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
            {snapshot ? (
              <>
                <div className="overlay overlay--top">
                  <StatusPill
                    label="ARM"
                    value={snapshot.mode.armed ? "Armed" : "Disarmed"}
                    accent={snapshot.mode.armed ? "good" : "warning"}
                  />
                  <StatusPill
                    label="Mode"
                    value={snapshot.mode.names.slice(0, 3).join(", ") || "Acro"}
                  />
                  <StatusPill label="Throttle band" value={overlaySummary.throttleBand} />
                  <StatusPill label="Offset" value={`${(sync.offsetSeconds ?? 0).toFixed(2)}s`} />
                </div>
                <div className="overlay overlay--summary">
                  <TinyMetric label="Status" value={overlaySummary.label} />
                  <TinyMetric label="Roll err" value={snapshot.error.roll.toFixed(1)} />
                  <TinyMetric label="Pitch err" value={snapshot.error.pitch.toFixed(1)} />
                  <TinyMetric label="Yaw err" value={snapshot.error.yaw.toFixed(1)} />
                  <TinyMetric
                    label="Headroom"
                    value={overlaySummary.saturation ? "Limited" : "OK"}
                  />
                </div>
                <div className="overlay overlay--sticks overlay--sticks-left">
                  <StickOverlay
                    title="Throttle / Yaw"
                    xValue={mapStickAxis(snapshot.rc.yaw)}
                    yValue={mapThrottleAxis(snapshot.rc.throttle)}
                    xLabel={`Yaw rc ${snapshot.rc.yaw.toFixed(0)} / sp ${snapshot.setpoint.yaw.toFixed(0)}`}
                    yLabel={`Thr rc ${snapshot.rc.throttle.toFixed(0)} / raw ${formatMaybeValue(snapshot.rcRaw.throttle, 0, "%")}`}
                    trail={stickTrail.left}
                    rawPoint={
                      snapshot.rcRaw.yaw !== null && snapshot.rcRaw.throttle !== null
                        ? {
                            x: mapStickAxis(snapshot.rcRaw.yaw),
                            y: mapThrottleAxis(snapshot.rcRaw.throttle),
                          }
                        : null
                    }
                    setpointPoint={{
                      x: mapStickAxis(snapshot.setpoint.yaw),
                      y: mapThrottleAxis(snapshot.rc.throttle),
                    }}
                    miniGraph={
                      overlayState.stickMiniGraphEnabled && stickGraphWindow ? (
                        <StickHistoryMini
                          channels={[
                            {
                              key: "throttle",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.throttle,
                              minValue: 0,
                              maxValue: 100,
                              className:
                                "stick-history__line stick-history__line--throttle",
                            },
                            {
                              key: "yaw",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.yaw,
                              minValue: -500,
                              maxValue: 500,
                              className: "stick-history__line stick-history__line--yaw",
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
                    yValue={mapStickAxis(-snapshot.rc.pitch)}
                    xLabel={`Roll rc ${snapshot.rc.roll.toFixed(0)} / sp ${snapshot.setpoint.roll.toFixed(0)}`}
                    yLabel={`Pitch rc ${snapshot.rc.pitch.toFixed(0)} / sp ${snapshot.setpoint.pitch.toFixed(0)}`}
                    trail={stickTrail.right}
                    rawPoint={
                      snapshot.rcRaw.roll !== null && snapshot.rcRaw.pitch !== null
                        ? {
                            x: mapStickAxis(snapshot.rcRaw.roll),
                            y: mapStickAxis(-snapshot.rcRaw.pitch),
                          }
                        : null
                    }
                    setpointPoint={{
                      x: mapStickAxis(snapshot.setpoint.roll),
                      y: mapStickAxis(-snapshot.setpoint.pitch),
                    }}
                    miniGraph={
                      overlayState.stickMiniGraphEnabled && stickGraphWindow ? (
                        <StickHistoryMini
                          channels={[
                            {
                              key: "roll",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.roll,
                              minValue: -500,
                              maxValue: 500,
                              className:
                                "stick-history__line stick-history__line--roll",
                            },
                            {
                              key: "pitch",
                              samples: stickGraphWindow.samples,
                              valueSelector: (sample) => sample.rc.pitch,
                              minValue: -500,
                              maxValue: 500,
                              className:
                                "stick-history__line stick-history__line--pitch",
                            },
                          ]}
                        />
                      ) : null
                    }
                  />
                </div>
                <div className="overlay overlay--bottom">
                  <StatusPill
                    label="Motor max"
                    value={percent(motorStats?.max ?? 0)}
                    accent={overlaySummary.saturation ? "warning" : "neutral"}
                  />
                  <StatusPill label="Motor spread" value={percent(motorStats?.spread ?? 0)} />
                  <StatusPill label="RPM avg" value={`${Math.round(rpmStats?.avg ?? 0)}`} />
                  {snapshot.aux.slice(0, 3).map((aux) => (
                    <StatusPill key={aux.label} label={aux.label} value={aux.active ? "High" : "Low"} />
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
                    ? "Scanning..."
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
