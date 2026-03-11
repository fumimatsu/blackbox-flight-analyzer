# Compare Metrics

The compare panel is intentionally conservative.

Its job is not to declare a winner from arbitrary averages. Its job is to surface a
small set of metrics that remain interpretable when two review scopes are reasonably
aligned.

## Rules

- Prefer event-focused comparison over whole-flight comparison
- Hide condition-specific metrics when one side does not have enough matching samples
- Treat event-count mismatches as a limitation, not as a silent success
- Prefer fewer honest metrics over more misleading metrics

## Current metrics

- `Roll tracking RMSE`
  - Lower is better
  - Interpreted as how closely roll motion followed the requested motion over the
    selected scope
- `Pitch tracking RMSE`
  - Lower is better
  - Interpreted as how closely pitch motion followed the requested motion over the
    selected scope
- `Saturation share`
  - Lower is better
  - Interpreted as time spent in headroom-limited motor output over the selected scope
- `High-throttle tracking`
  - Lower is better
  - Only shown when both flights contain enough high-throttle samples
- `Loaded-turn tracking`
  - Lower is better
  - Only shown when both flights contain enough loaded-turn samples

## Limits

- Whole-flight comparison is broad and can still mix unlike situations
- Event-focused comparison currently pools all matching samples, not pairwise matched
  events
- Missing or sparse condition samples should hide metrics rather than pretending to
  compare them
