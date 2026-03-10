# Contributing

## Design boundary

This project draws a clear line between reused infrastructure and product-specific work.

- Reused infrastructure belongs in `src/vendor/log-core`.
  - This includes low-level log parsing, indexing, and runtime decoding needed to read Blackbox data.
- Product-specific logic belongs outside the vendor directory.
  - This includes the React UI, state management, selectors, derived metrics, DVR sync workflows, event detection, comparison UX, and future tuning insight features.

## Rules for changes

- Do not spread vendored logic across the app.
- Keep any direct dependency on vendored code behind `src/domain/blackbox/adapter`.
- Prefer adding new behavior in `src/domain` or `src/app` instead of patching vendored files.
- If a vendored file must be changed, keep the change minimal and document why.
- Do not present vendored code as original work. Keep attribution in `NOTICE.md` and preserve licensing obligations in `LICENSE`.

## What makes this project distinct

The goal of this app is not graph parity with legacy viewers. Its differentiators are:

- video-first review
- OSD-style understanding of flight behavior
- event-based analysis
- comparison workflows that help pilots understand what changed
