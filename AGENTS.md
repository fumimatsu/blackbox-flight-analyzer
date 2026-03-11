# Blackbox Flight Analyzer Handoff

## Project state
- This is the standalone repo for the React-first Blackbox Flight Analyzer.
- It was extracted from an earlier investigation repo and is now the primary product repo.
- The active app entry is `index.html -> /src/react-main.jsx`.
- The product UI and state live under:
  - `src/app`
  - `src/domain`
  - `src/styles`
- Vendored parser/log modules live under:
  - `src/vendor/log-core`

## What is implemented
- React shell and Zustand store.
- BBL loading through vendored Betaflight `FlightLog`.
- Video attach and shared timeline sync.
- OSD-style overlays:
  - left stick: throttle/yaw
  - right stick: roll/pitch
  - top status pills
  - summary metrics
  - bottom motor/RPM/AUX pills
- Compact history graph.
- Event detection:
  - high-throttle straight
  - chop turn
  - loaded roll arc
  - high error burst
  - saturation burst
- Single-video compare foundation.
- `ARMED`-based DVR auto sync.

## Important integration details
- Vendored upstream modules still assume:
  - `globalThis.$`
  - `globalThis.jQuery`
  - `globalThis.semver`
- `src/react-main.jsx` initializes those prerequisites.
- `FlightLog` must be opened with `log.openLog(index)` before selectors use time-window APIs.
- The adapter already picks the first readable log section and opens it.

## Current structure intent
- `src/app`: React shell
- `src/domain`: app-facing domain logic only
- `src/vendor/log-core`: isolated vendored parser/log code
- `src/domain/blackbox/adapter`: the boundary between app code and vendored Betaflight code

## Run locally
- `npm install`
- `npm run start`
- `npm run build`

## Verified in this repo
- `npm install` succeeded
- `npm run build` succeeded
- Git repo initialized locally

## Known behavior
- Unknown header warnings such as `Ignoring unsupported header ...` are expected with newer logs.
- Event heuristics are still simple and need more real-flight tuning.
- Compare mode is still a foundation, not a finished workflow.
- Real-world validation across multiple DVR formats is still incomplete.

## Recommended next tasks
1. Run this standalone repo against the current real `.bbl` and `.mp4` set.
2. Add an error boundary so parser failures do not blank the whole app.
3. Harden field resolution for AUX/RPM and mixed log variants.
4. Add fixture-backed tests for selectors, sync, and event detection.
5. Decide whether vendored Betaflight files should stay copied or become a git subtree/submodule style import later.

## Files worth reading first
- `docs/architecture.md`
- `docs/upstream-notes.md`
- `src/app/App.jsx`
- `src/domain/blackbox/adapter/flightLogAdapter.js`
- `src/domain/blackbox/selectors/flightSelectors.js`
- `src/domain/sync/autoVideoSync.js`

## Product intent
- Video is the primary surface.
- The UI should explain flight behavior in context, not foreground raw waveforms.
- The long-term differentiator is event-based comparison on top of DVR review.

## Verification rule
- UI の状態分岐、hook、表示条件、ファイル読み込み導線を触った変更は、ユーザーに渡す前に最低でも `npm run build` を通す。
- テスト対象を触った変更は `npm test` まで通す。
- 実データが repo 内にある場合、最低 1 セットは実際に投入して smoke check を行う。
- 未確認のものを確認済みとして渡さない。未確認ならそう明記する。
