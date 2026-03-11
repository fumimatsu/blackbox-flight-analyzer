# Blackbox Flight Analyzer

Video-first Blackbox review app for pilots who want to understand what happened in the air, not just stare at waveforms.

![Blackbox Flight Analyzer UI](./public/images/blackbox-flight-analyzer-ui.gif)

## Why this exists

Traditional Blackbox tools are strong at raw graphs, but they make it easy to lose the flight context.

This app puts the DVR first and overlays the flight data directly on top of the video so you can review:

- what stick input was given
- how setpoint, gyro, and error behaved
- when motor headroom tightened up
- which moments are worth re-opening as events
- how one flight or setup differs from another

## What you can do

- Load one or more `.BBL` logs and review them as selectable flight tabs
- Attach a DVR clip and scrub the log and video together
- See RC, setpoint, error, motor, RPM, and AUX information as an OSD-style overlay
- Jump to detected event windows such as loaded roll arcs and saturation bursts
- Compare flights in a single-video review workflow
- Auto-detect `ARMED` in the DVR and apply a video offset suggestion

That last point is especially useful in practice: instead of manually lining up a DVR and log from scratch, the app can scan the early part of the clip, detect the `ARMED` OSD text, and use that to propose a sync offset. It is not magic and it can still miss, but when it works it removes one of the most annoying parts of Blackbox review.

## Typical flow

1. Open a `.BBL`
2. Attach the DVR
3. Let auto sync try to detect `ARMED`
4. Fine-tune offset if needed
5. Scrub, replay, and jump through event windows
6. Compare flights or setup changes once the review target is clear

## Product stance

This project does not aim to repackage an existing Blackbox viewer UI. The reusable part is limited to log decoding/runtime infrastructure isolated behind the adapter layer. The product value is built in the React app, DVR-first UX, overlay design, event detection, sync workflow, and comparison experience.

## Commands

- `npm install`
- `npm run start`
- `npm run build`

## Structure

- `src/app`: React app shell and Zustand store
- `src/domain`: selectors, derived metrics, events, compare, and sync logic
- `src/vendor/log-core`: isolated log parsing/runtime modules used behind the adapter layer
- `docs`: migration and architecture notes

## Notes

- This repo is the standalone continuation of the React-first MVP.
- Third-party derived log/runtime code is intentionally isolated behind `src/domain/blackbox/adapter`.
- Licensing and attribution details are documented in `NOTICE.md` and `LICENSE`.
- A single `.BBL` may surface as multiple selectable flight tabs when it contains multiple readable log sections.
