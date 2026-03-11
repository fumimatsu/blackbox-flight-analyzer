# Diagnostic Rules Draft

This document is the first draft of a rule-based analysis layer for Blackbox Flight Analyzer.

The intent is not to make hard tuning claims from one signal. The intent is to translate review observations into:

- what was observed
- where it happened
- what that usually suggests checking next
- which Betaflight official note supports that direction

## Scope

- These rules are guidance, not automatic tuning instructions.
- The first reference point should be Betaflight official docs.
- A rule should prefer "likely related" over "caused by" unless the evidence is unusually strong.
- Event context matters. The same metric can mean different things in a throttle chop, high-throttle straight, or loaded turn.

## Evidence model

Each future diagnostic rule should be expressed as:

- `symptom`: the review observation shown to the user
- `event context`: where in the flight this matters
- `evidence`: the measurable signals in the log
- `likely checks`: the settings or setup areas worth inspecting next
- `confidence limits`: why the rule might be wrong
- `official basis`: the Betaflight source that justifies the direction

## Initial rules

### Rule 1: Low-throttle instability or propwash during chops / turns

- Symptom
  - The quad gets messy after throttle reduction, especially in chop turns or low-throttle direction changes.
- Event context
  - `throttle chop + turn`
  - low-throttle replay segments
- Evidence
  - repeated `high error burst` events near low throttle
  - visible oscillation or rough tracking after throttle reduction
  - saturation is not the dominant signal
- Likely checks
  - D-term authority and filter delay balance
  - dynamic D filtering behavior
  - gyro filtering that may be adding too much latency
  - RPM filtering / dynamic notch setup if noise control is still poor
- Confidence limits
  - can also be influenced by bad airflow, mechanical vibration, weak motors, or low-throttle motor behavior
- Official basis
  - Betaflight freestyle tuning guidance says D is central to smoothness and minimizing propwash.
  - Official filtering notes say excess filter delay hurts propwash response, and reducing gyro / D-term delay can help when noise allows it.

### Rule 2: Motor max-out / headroom limitation

- Symptom
  - The craft feels inconsistent or stops responding the same way during aggressive moves.
- Event context
  - `loaded roll arc`
  - high-throttle accelerations
  - high authority demand on one axis
- Evidence
  - repeated `saturation burst` events
  - very high `motor max`
  - wide motor spread during demanding maneuvers
  - tracking quality changes during the same move
- Likely checks
  - headroom and authority before tuning changes
  - whether the move is power-limited rather than filter-limited
  - setup factors such as motor / prop / weight / throttle cap before blaming PID
- Confidence limits
  - this can look like a tuning problem even when it is mainly an authority problem
- Official basis
  - Betaflight freestyle tuning guidance explicitly warns that when motors max out, responsiveness changes and consistency suffers.

### Rule 3: Twitchy response from stick-side command shaping

- Symptom
  - The quad reacts sharply to tiny stick changes and the video feels twitchy rather than smooth.
- Event context
  - straight lines
  - smooth arcs
  - off-center sustained turns
- Evidence
  - setpoint changes look more nervous than the intended maneuver
  - error is not necessarily large, but the visible motion is jerkier than expected
  - axis response appears exaggerated for small stick movement
- Likely checks
  - feedforward amount
  - feedforward jitter reduction
  - RC smoothing settings
- Confidence limits
  - pilot input, radio link quality, or gimbal noise may be the real source
- Official basis
  - Betaflight 4.3 tuning notes explain that feedforward improves responsiveness but can exaggerate tiny RC inputs and produce twitchy HD footage.
  - Betaflight 4.2 notes say higher RC smoothing can reduce RC glitches, but adds delay.

### Rule 4: Weak low-throttle attitude hold or zero-throttle wobble

- Symptom
  - The quad feels less stable or less controlled when throttle is very low.
- Event context
  - low-throttle descents
  - throttle chops
  - hang-time moments
- Evidence
  - low-throttle segments show degraded tracking or roughness
  - instability appears after RPM falls rather than at high-throttle load
- Likely checks
  - dynamic idle
  - thrust linear
  - ESC PWM frequency if low-throttle behavior changed after ESC setup changes
- Confidence limits
  - can overlap with propwash, motor desync risk, or poor filtering decisions
- Official basis
  - Freestyle tuning guidance says lower idle improves hang time but weakens attitude hold at zero throttle, and dynamic idle / thrust linear help offset the side effects.
  - Official ESC notes warn that higher PWM frequency can introduce low-throttle wobbles.

### Rule 5: Inconsistent feel across the pack from voltage sag

- Symptom
  - The same maneuver feels strong early in the pack and dull later, even when line choice and stick intent stay similar.
- Event context
  - repeated comparable segments at different battery voltage levels
- Evidence
  - later-in-pack segments show weaker response or different throttle feel
  - no single event burst explains the change by itself
- Likely checks
  - battery sag compensation
  - whether battery condition is the underlying factor instead of PID alone
- Confidence limits
  - this requires comparing similar maneuvers at meaningfully different pack voltage
- Official basis
  - Betaflight 4.2 notes describe battery sag compensation as a way to keep throttle and PID feel more consistent through the flight.

## What the app should say

The UI should avoid pretending these are certainties. Preferred wording:

- `Likely related to`
- `Check next`
- `Consistent with`
- `Less likely if`

Avoid wording like:

- `This was caused by`
- `Set X to Y`
- `This tune is wrong`

## Mapping to current app concepts

- `high error burst`
  - useful for surfacing possible tracking problems
- `saturation burst`
  - useful for surfacing headroom / authority limits
- `throttle chop + turn`
  - useful for low-throttle instability / propwash review
- `loaded roll arc`
  - useful for authority, tracking, and consistency checks under load
- compare summaries
  - useful for showing whether the same symptom got better or worse after a change

## Next implementation step

The app-facing rule shape is now implemented around:

```text
id
label
eventTypes[]
predicate(flightEvidence)
evidenceSummary()
likelyChecks[]
confidence
officialSources[]
```

This keeps insight cards traceable to both observed evidence and official Betaflight references.

## Official sources used for this draft

- Betaflight Tuning Notes:
  - https://www.betaflight.com/docs/category/tuning-notes
- Freestyle Tuning Principles:
  - https://www.betaflight.com/docs/wiki/guides/current/Freestyle-Tuning-Principles
- Betaflight 4.3 Tuning Notes:
  - https://www.betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes
- Betaflight 4.2 Tuning Notes:
  - https://www.betaflight.com/docs/wiki/tuning/4-2-Tuning-Notes
