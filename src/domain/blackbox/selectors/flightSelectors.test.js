import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFlightSessionFromFile } from "../adapter/flightLogAdapter.js";
import {
  getFirstArmedTimeUs,
  getFlightSnapshot,
  getFlightWindow,
} from "./flightSelectors.js";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "data/BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL"
);

async function createFixtureFile() {
  const bytes = await fs.readFile(FIXTURE_PATH);
  return new File([bytes], path.basename(FIXTURE_PATH), {
    type: "application/octet-stream",
  });
}

describe("flightSelectors baseline fixture", () => {
  let session;

  beforeAll(async () => {
    session = await loadFlightSessionFromFile(await createFixtureFile());
  });

  it("loads the baseline fixture and preserves expected duration", () => {
    expect(session.fileName).toBe("BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL");
    expect(session.durationUs).toBe(74944243);
    expect(session.maxTimeUs).toBeGreaterThan(session.minTimeUs);
    expect(session.fieldNames.length).toBeGreaterThan(0);
  });

  it("returns a snapshot with a readable frame at the start of the log", () => {
    const snapshot = getFlightSnapshot(session, session.minTimeUs);

    expect(snapshot.frame).toBeTruthy();
    expect(snapshot.timeUs).toBe(session.minTimeUs);
    expect(Array.isArray(snapshot.mode.names)).toBe(true);
    expect(snapshot.mode.armed).toBe(false);
    expect(snapshot.rc).toHaveProperty("throttle");
    expect(snapshot.error).toHaveProperty("roll");
  });

  it("finds the first armed time inside the log range", () => {
    const armedTimeUs = getFirstArmedTimeUs(session);

    expect(armedTimeUs).not.toBeNull();
    expect(armedTimeUs).toBeGreaterThan(session.minTimeUs);
    expect(armedTimeUs).toBeLessThanOrEqual(session.maxTimeUs);
  });

  it("builds a clamped analysis window without exceeding the requested sample cap", () => {
    const window = getFlightWindow(
      session,
      session.minTimeUs - 1000000,
      session.minTimeUs + 5000000,
      60
    );

    expect(window.startUs).toBe(session.minTimeUs);
    expect(window.endUs).toBe(session.minTimeUs + 5000000);
    expect(window.samples.length).toBeLessThanOrEqual(60);
    expect(window.samples.length).toBeGreaterThan(0);
  });

  it("builds a fixed-interval window with stable sample positions", () => {
    const startUs = session.minTimeUs + 1000000;
    const endUs = startUs + 2000000;
    const window = getFlightWindow(session, startUs, endUs, 7, {
      sampleStrategy: "fixed-interval",
    });

    expect(window.startUs).toBe(startUs);
    expect(window.endUs).toBe(endUs);
    expect(window.samples).toHaveLength(7);
    expect(window.samples[0].timeUs).toBe(startUs);
    expect(window.samples[window.samples.length - 1].timeUs).toBe(endUs);

    for (let index = 1; index < window.samples.length; index += 1) {
      expect(window.samples[index].timeUs).toBeGreaterThan(
        window.samples[index - 1].timeUs
      );
    }
  });
});
