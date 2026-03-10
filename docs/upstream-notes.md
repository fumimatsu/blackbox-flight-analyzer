# Upstream Reuse Notes

## Keep
- `FlightLog` as the parser-facing API for frame lookup, merged field access, smoothing, and time-range extraction.
- Field conversion helpers on `FlightLog` for gyro, throttle, motor output, and mode decoding.
- The existing time/video offset semantics from `main.js` and `flightlog_video_renderer.js`.

## Wrap
- File loading should move into a dedicated adapter instead of remaining embedded in the page controller.
- Field access should be normalized through selectors so UI code never touches raw field names directly.
- Event detection should be built on top of selector output, not inside parser or rendering modules.

## Discard for the new MVP UI
- The legacy `index.html` layout and its graph-first interaction model.
- jQuery-bound page state, toolbar wiring, modal interactions, and canvas overlays used by the old viewer.
- Any UI assumptions that the graph canvas is the primary view.

## Migration strategy used in this repo
- The repo remains a fork so parser/timeline/video behavior stays locally inspectable.
- The runtime entry point now targets a React application.
- New code consumes upstream logic through:
  - `src/domain/blackbox/adapter`
  - `src/domain/blackbox/selectors`
  - `src/domain/blackbox/derived`
  - `src/domain/blackbox/events`
- This keeps a later split-to-independent-repo viable because the upstream dependency surface is small and isolated.
