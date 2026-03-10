# Blackbox Flight Analyzer Architecture Notes

## Current upstream responsibilities
- `src/main.js` is the orchestration hub. It owns file loading, current seek time, playback state, video offset, graph creation, seek bar wiring, and most user interactions.
- `src/flightlog.js` is the reusable data core. It wraps `FlightLogParser`, builds indexes, exposes frame lookup by time, exposes smoothed time windows, and injects derived fields such as `rcCommands[]` and `axisError[]`.
- `src/seekbar.js` renders and manages the seek bar interaction. Upstream feeds it activity summaries and current time from `main.js`.
- `src/grapher.js` renders the main graph canvas and several legacy overlays, including sticks/analyser/craft. It is graph-first and tightly coupled to the upstream page structure.
- `src/flightlog_video_renderer.js` is export-oriented, but it confirms the video timing model: `blackboxTime = (video.currentTime - videoOffset) * 1e6 + logMinTime`.

## BBL loading path
1. `main.js -> loadFiles()` classifies uploaded files by extension.
2. `loadLogFile(file)` reads the file as `ArrayBuffer` via `FileReader`.
3. A `Uint8Array` is passed to `new FlightLog(...)`.
4. `FlightLog` builds indexes and exposes frame lookup by time and smoothed time-window access.
5. The loaded log is then connected to graph config, seek bar activity, and the graph renderer.

## Decoded field access
- `FlightLog` injects computed fields into the merged frame stream, notably `rcCommands[0..3]` and `axisError[0..2]`.
- `getMainFieldIndexByName(name)` and `getMainFieldIndexes()` are the cleanest access points for a new selector layer.
- Conversion helpers already exist on `FlightLog`, including `gyroRawToDegreesPerSecond`, `rcCommandRawToThrottle`, `rcMotorRawToPctPhysical`, and `getFlightMode`.

## Seek/timeline ownership
- Upstream stores the active timeline in `currentBlackboxTime` inside `main.js`.
- The seek bar and graph both write into this value.
- When video is active, `currentBlackboxTime` is often derived from `video.currentTime` plus `videoOffset`.
- These timing semantics are reusable, but ownership must move into a dedicated app store for the new UI.

## Video sync ownership
- Upstream keeps video sync state in `videoOffset`.
- The main conversion is `blackboxTime = (video.currentTime - videoOffset) * 1e6 + minTime`.
- `setCurrentBlackboxTime()` pushes timeline changes back into `video.currentTime` when a video is loaded.
- This bidirectional coupling is the core behavior preserved in the React rewrite.

## Graph rendering ownership
- `FlightLogGrapher` owns graph canvas rendering, event markers, legacy stick overlay, analyser overlay, and graph zoom windowing.
- It is useful as a behavioral reference, but not a good extension point for a video-first product.
- The compact history graph for this MVP is intentionally independent from `FlightLogGrapher`.

## Recommended extraction boundary
- Reuse directly:
  - `FlightLog`
  - `FlightLogParser`
  - log field definitions and converters
  - time/video offset semantics
- Wrap behind app contracts:
  - frame lookup
  - time-window extraction
  - derived metrics
  - event detection
- Replace:
  - legacy HTML layout
  - jQuery-driven interaction flow
  - graph-first canvas UI
  - direct DOM coupling between graph state and file loading
