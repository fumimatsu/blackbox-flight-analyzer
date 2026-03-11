# Event Detection

Event detection is intentionally review-oriented.

The goal is not to tag every threshold crossing. The goal is to mark segments that are
worth reopening during DVR review.

## Current event types

- `High-throttle straight`
  - When throttle is high and stick input stays low
  - Review purpose: check smoothness, tracking, and top-end behavior without heavy pilot input
- `Throttle chop + turn`
  - When throttle falls sharply into a turn
  - Review purpose: check low-throttle stability and transition behavior
- `Loaded roll arc`
  - When roll demand stays high with throttle still on
  - Review purpose: check tracking during committed loaded turns
- `Tracking-off burst`
  - When tracking error spikes without obvious motor saturation
  - Review purpose: inspect controller or filtering behavior rather than headroom
- `Headroom-limited burst`
  - When motor saturation appears under meaningful throttle load
  - Review purpose: inspect max-out and headroom limits

## Rules

- Short gaps inside one meaningful maneuver are merged instead of becoming separate events
- Overlapping events are pruned so the higher-value explanation wins
- Condition-specific events should explain why a segment is worth opening
- Event output should stay sparse enough to guide review rather than decorate the graph
