export const enMessages = {
  common: {
    na: "n/a",
    on: "On",
    off: "Off",
    high: "High",
    low: "Low",
    select: "Select",
    loading: "Loading logs...",
    resetView: "Reset view",
    view: "View",
  },
  locale: {
    label: "Language",
    en: "English",
    ja: "日本語",
  },
  app: {
    eyebrow: "Blackbox Flight Analyzer MVP",
    title: "Flight Analyzer",
    emptyEyebrow: "Blackbox Flight Analyzer",
    emptyTitle: "Video-first Blackbox analysis for DVR review.",
    emptyBody:
      "Load one or more `.bbl` logs first. Then attach a DVR clip to the selected flight and start reviewing sticks, tracking error, motor headroom, events, and A/B comparisons.",
    openLogs: "Open logs",
    addLogs: "Add logs",
    attachDvr: "Attach DVR",
    noDvr: "No DVR attached to this flight.",
    noDvrHelp: "Attach a video to overlay sticks and flight-state OSD on top.",
    playback: "Playback",
    play: "Play",
    pause: "Pause",
    autoSyncArmed: "Auto sync ARMED",
    stickGraphs: "Stick graphs",
    stickMode: "Stick mode",
    mode1: "Mode 1",
    mode2: "Mode 2",
    top: "Top",
    summary: "Summary",
    attitude: "Attitude",
    sticks: "Sticks",
    bottom: "Bottom",
    history: "History",
    compare: "Compare",
  },
  overlay: {
    arm: "ARM",
    mode: "Mode",
    throttle: "Throttle",
    offset: "Offset",
    armed: "Armed",
    disarmed: "Disarmed",
    attitude: "Quad attitude",
    front: "Front",
    rear: "Rear",
    motors: "Motors",
    spread: "Spread",
    headroomLow: "Headroom Low",
    headroomOk: "Headroom OK",
    throttleYaw: "Throttle / Yaw",
    pitchYaw: "Pitch / Yaw",
    rollPitch: "Roll / Pitch",
    rollThrottle: "Roll / Throttle",
    error: "Error",
    status: "Status",
    rc: "RC",
    raw: "Raw",
    setpoint: "Setpoint",
    noData: "no data",
    highThrottle: "High throttle",
    headroom: "Headroom",
    tracking: "Tracking",
    throttleOff: "Throttle off",
    roll: "Roll",
    pitch: "Pitch",
    yaw: "Yaw",
    throttleShort: "Thr",
  },
  timeline: {
    videoOffset: "Video offset",
    autoSync: "Auto sync",
    notRun: "Not run",
    scanningViewer: "Scanning in viewer... Press Esc to cancel.",
    syncOk: "OK: {message}",
    syncCancelled: "Cancelled: {message}",
    syncFailed: "NG: {message}",
    autoSyncFinished: "Auto sync finished.",
    autoSyncCancelled: "Auto sync cancelled.",
    autoSyncFailed: "Auto sync failed.",
  },
  syncNotice: {
    eyebrow: "Auto sync",
    scanningTitle: "Scanning DVR...",
    successTitle: "Sync OK",
    cancelledTitle: "Sync cancelled",
    failedTitle: "Sync failed",
    scanningMessage: "Looking for ARMED in the DVR. Press Esc to cancel.",
    fallback: "Auto sync finished.",
    loadedPreparing: "DVR loaded. Preparing ARMED auto sync...",
    notDetected: "ARMED text was not detected in the first 10 seconds.",
    rejectedCandidate:
      "Rejected low-confidence ARMED candidate at {time}s (OCR {confidence}%). Adjust offset manually.",
    detectedAt: "ARMED detected at {time}s (OCR {confidence}%)",
  },
  history: {
    title: "Compact History",
    throttle: "Throttle",
    rollError: "Roll error",
    pitchError: "Pitch error",
    rpmAvg: "RPM avg",
  },
  events: {
    title: "Analysis Events",
    none: "No event matched the current heuristics.",
    highThrottleStraight: "High-throttle straight",
    highThrottleStraightReason:
      "Useful for checking tracking and smoothness when pilot input is low.",
    highThrottleStraightDetail:
      "High throttle with low stick input. Peak throttle {peakThrottle}%",
    chopTurn: "Throttle chop + turn",
    chopTurnReason:
      "Useful for spotting instability when throttle drops into a turn.",
    chopTurnDetail:
      "Throttle dropped into a turn. Peak turn input {peakTurnInput}",
    loadedRollArc: "Loaded roll arc",
    loadedRollArcReason:
      "Useful for checking loaded-turn tracking under sustained roll demand.",
    loadedRollArcDetail:
      "Sustained roll demand with throttle on. Peak throttle {peakThrottle}%",
    highErrorBurst: "Tracking-off burst",
    highErrorBurstReason:
      "Useful when tracking error spikes without obvious motor saturation.",
    highErrorBurstDetail:
      "Tracking error peaked at {peakError}°/s without saturation",
    saturationBurst: "Headroom-limited burst",
    saturationBurstReason:
      "Useful for locating moments where motors appear to max out.",
    saturationBurstDetail:
      "Motor headroom looked limited. Peak motor {peakMotor}%",
  },
  compare: {
    title: "Compare",
    description: "Single-video compare foundation with same-event metrics.",
    flightA: "Flight A",
    flightB: "Flight B",
    eventFocus: "Event focus",
    wholeFlight: "Whole flight",
    noSummary: "Load two logs to enable A/B summaries.",
    scope: "Scope",
    lowerBetter: "Lower is better",
    higherBetter: "Higher is better",
    limits: "Limits",
    wholeFlightScope: "Whole-flight window",
    eventScope: "{label} events",
    wholeFlightCaveat:
      "Whole-flight compare is broad. Use Event focus when you want tighter scene matching.",
    eventCountMismatch:
      "Event counts differ ({a} vs {b}), so metrics compare pooled matching samples rather than pairwise events.",
    hiddenNeedSamples:
      "{label} hidden: needs >= {minRequired} aligned samples in both flights (A {aCount}, B {bCount}).",
    hiddenInvalid:
      "{label} hidden: aligned samples did not produce a valid value.",
    rollTrackingRmse: "Roll tracking RMSE",
    rollTrackingMeaning:
      "Lower means roll tracking stayed closer to the requested motion.",
    pitchTrackingRmse: "Pitch tracking RMSE",
    pitchTrackingMeaning:
      "Lower means pitch tracking stayed closer to the requested motion.",
    saturationShare: "Saturation share",
    saturationShareMeaning:
      "Lower means less time spent with headroom-limited motor output.",
    highThrottleTracking: "High-throttle tracking",
    highThrottleTrackingMeaning:
      "Lower means better tracking while throttle was already high.",
    loadedTurnTracking: "Loaded-turn tracking",
    loadedTurnTrackingMeaning:
      "Lower means less tracking error during committed roll-loaded turns.",
  },
  diagnostics: {
    title: "Review Insights",
    description:
      "Rule-based, cautious guidance grounded in Betaflight official tuning notes.",
    empty:
      "No diagnostic rule matched strongly enough yet. That is expected on calmer or inconclusive sections.",
    likelyRelatedTo: "Likely related to",
    confidence: "Confidence: {value}",
    checkNext: "Check next",
    officialBasis: "Official basis",
    confidenceMedium: "medium",
    confidenceLow: "low",
    headroomLabel: "Headroom limitation likely",
    headroomEvidence:
      "Consistent with repeated headroom-limited output. Saturation share {share}%, peak motor {peak}%.",
    headroomCheck1:
      "Check whether the move is power-limited before assuming a PID/filter issue.",
    headroomCheck2:
      "Check prop / motor / weight / throttle cap headroom on the affected build.",
    headroomCheck3:
      "If this shows up only in specific loaded turns, compare the same event after setup changes.",
    lowThrottleLabel: "Low-throttle instability worth checking",
    lowThrottleEvidence:
      "Consistent with instability after throttle reduction. Mean low-throttle error {value}°/s with little saturation.",
    lowThrottleCheck1:
      "Check D-term authority versus filter delay if chops and low-throttle turns look messy.",
    lowThrottleCheck2:
      "Check RPM / dynamic notch setup if noise control still forces high filter delay.",
    lowThrottleCheck3:
      "Check low-throttle motor behavior and dynamic idle before making large PID changes.",
  },
  status: {
    settled: "Settled",
    dataIncomplete: "Data incomplete",
    headroomLimited: "Headroom limited",
    trackingOff: "Tracking off",
    highSpeedRun: "High-speed run",
    throttleOff: "Throttle off",
    band: {
      unknown: "unknown",
      high: "high",
      midHigh: "mid-high",
      mid: "mid",
      low: "low",
      idle: "idle",
    },
  },
  errors: {
    skippedUnreadable: "{file}: skipped {count} unreadable section(s).",
    fileError: "{file}: {message}",
    noReadableSection: "No readable log section was found in this file.",
  },
};
