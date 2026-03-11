import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFlightSessionsFromFile } from "../adapter/flightLogAdapter.js";
import { getFlightSnapshot, getFlightWindow } from "./flightSelectors.js";

const MULTI_SECTION_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "data/dataset-scan/20240921_btfl_all.bbl"
);
const MISSING_RPM_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "data/dataset-scan/20200413_PFM1_btfl_001.bbl"
);

async function createFixtureFile(fixturePath) {
  const bytes = await fsPromises.readFile(fixturePath);
  return new File([bytes], path.basename(fixturePath), {
    type: "application/octet-stream",
  });
}

describe.runIf(fs.existsSync(MULTI_SECTION_FIXTURE_PATH))(
  "multi-section fixture",
  () => {
    let sessions;

    beforeAll(async () => {
      const result = await loadFlightSessionsFromFile(
        await createFixtureFile(MULTI_SECTION_FIXTURE_PATH)
      );
      sessions = result.sessions;
    });

    it("surfaces every readable section as a separate flight session", () => {
      expect(sessions).toHaveLength(2);
      expect(sessions[0].totalLogSections).toBe(2);
      expect(sessions[0].logSectionLabel).toBe("Section 1");
      expect(sessions[1].logSectionLabel).toBe("Section 2");
      expect(sessions[0].durationUs).toBeGreaterThan(0);
      expect(sessions[1].durationUs).toBeGreaterThan(0);
    });
  }
);

describe.runIf(fs.existsSync(MISSING_RPM_FIXTURE_PATH))(
  "missing-rpm fixture",
  () => {
    let sessions;

    beforeAll(async () => {
      const result = await loadFlightSessionsFromFile(
        await createFixtureFile(MISSING_RPM_FIXTURE_PATH)
      );
      sessions = result.sessions;
    });

    it("keeps missing RPM data explicit instead of synthesizing values", () => {
      expect(sessions.length).toBeGreaterThan(0);
      const session = sessions[0];
      const snapshot = getFlightSnapshot(session, session.minTimeUs);

      expect(session.fieldNames.some((field) => /^(eRPM|rpm)\[\d+\]$/.test(field))).toBe(false);
      expect(snapshot.rpm).toEqual([]);
      expect(snapshot.motors.length).toBeGreaterThan(0);
    });

    it("builds time windows for missing-field logs without crashing", () => {
      const session = sessions[0];
      const window = getFlightWindow(
        session,
        session.minTimeUs,
        Math.min(session.minTimeUs + 3_000_000, session.maxTimeUs),
        24
      );

      expect(window.samples.length).toBeGreaterThan(0);
      expect(window.samples.every((sample) => Array.isArray(sample.rpm) && sample.rpm.length === 0)).toBe(
        true
      );
    });
  }
);
