import fs from "node:fs";
import fsPromises from "node:fs/promises";
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
  const bytes = await fsPromises.readFile(FIXTURE_PATH);
  return new File([bytes], path.basename(FIXTURE_PATH), {
    type: "application/octet-stream",
  });
}

describe.runIf(fs.existsSync(FIXTURE_PATH))("flightSelectors baseline fixture", () => {
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
    expect(snapshot.battery).toHaveProperty("voltage");
    expect(snapshot.battery.voltage).toBeGreaterThan(0);
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
    const sampleIntervalUs = 25000;
    const window = getFlightWindow(session, startUs, endUs, 7, {
      sampleStrategy: "fixed-interval",
      sampleIntervalUs,
      anchorUs: session.minTimeUs,
    });

    expect(window.startUs).toBe(startUs);
    expect(window.endUs).toBe(endUs);
    expect(window.samples.length).toBeGreaterThan(2);
    expect(window.samples[0].timeUs).toBe(startUs);
    expect(window.samples[window.samples.length - 1].timeUs).toBe(endUs);

    for (let index = 1; index < window.samples.length; index += 1) {
      expect(window.samples[index].timeUs).toBeGreaterThan(
        window.samples[index - 1].timeUs
      );
    }

    const interiorSamples = window.samples.slice(1, -1);
    expect(
      interiorSamples.every(
        (sample) => (sample.timeUs - session.minTimeUs) % sampleIntervalUs === 0
      )
    ).toBe(true);
  });

  it("keeps anchored fixed-interval samples stable across overlapping windows", () => {
    const sampleIntervalUs = 25000;
    const firstWindow = getFlightWindow(
      session,
      session.minTimeUs + 1000000,
      session.minTimeUs + 3000000,
      120,
      {
        sampleStrategy: "fixed-interval",
        sampleIntervalUs,
        anchorUs: session.minTimeUs,
      }
    );
    const secondWindow = getFlightWindow(
      session,
      session.minTimeUs + 1100000,
      session.minTimeUs + 3100000,
      120,
      {
        sampleStrategy: "fixed-interval",
        sampleIntervalUs,
        anchorUs: session.minTimeUs,
      }
    );

    const firstInteriorTimes = new Set(firstWindow.samples.slice(1, -1).map((sample) => sample.timeUs));
    const overlappingTimes = secondWindow.samples
      .slice(1, -1)
      .map((sample) => sample.timeUs)
      .filter((timeUs) => timeUs > firstWindow.startUs && timeUs < firstWindow.endUs);

    expect(overlappingTimes.length).toBeGreaterThan(0);
    expect(overlappingTimes.every((timeUs) => firstInteriorTimes.has(timeUs))).toBe(true);
  });
});
