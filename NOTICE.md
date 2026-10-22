## Third-Party Notice

This project includes vendored log parsing/runtime code derived from the Betaflight Blackbox log viewer project.

- Upstream project: `betaflight/blackbox-log-viewer`
- Current parser/runtime source: `betaflight/betaflight-configurator`, tag `2026.6.2`, commit `091127c1a5b15268321b0e5b71b8cec89f1de56b`.
- Includes `src/blackbox-viewer` core modules and `src/js/utils/debugModes.js` / `array.js`; local import adaptation is documented in `docs/blackbox-compatibility.md`.
- Original license: GPL-3.0

The vendored code is isolated under `src/vendor/log-core` and used through the adapter layer in `src/domain/blackbox/adapter`.

See `LICENSE` for the applicable license text.
