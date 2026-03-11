import { beforeEach, describe, expect, it, vi } from "vitest";

let scenario;

vi.mock("../../../vendor/log-core/flightlog.js", () => {
  class MockFlightLog {
    constructor() {
      this.instanceId = scenario.instances.length;
      scenario.instances.push(this);
      this.currentSection = null;
    }

    getLogCount() {
      return scenario.logCount;
    }

    getLogError(index) {
      return scenario.logErrors[index] ?? false;
    }

    openLog(index) {
      const section = scenario.sections[index];
      if (!section?.openable) {
        return false;
      }
      this.currentSection = section;
      return true;
    }

    getMainFieldNames() {
      return this.currentSection?.fieldNames ?? [];
    }

    getMainFieldIndexes() {
      return this.currentSection?.fieldIndex ?? {};
    }

    getMinTime() {
      return this.currentSection?.minTimeUs ?? 0;
    }

    getMaxTime() {
      return this.currentSection?.maxTimeUs ?? 0;
    }

    getNumMotors() {
      return this.currentSection?.numMotors ?? 4;
    }
  }

  return { FlightLog: MockFlightLog };
});

async function createFixtureFile() {
  return new File([new Uint8Array([1, 2, 3])], "demo-log.BBL", {
    type: "application/octet-stream",
  });
}

describe("loadFlightSessionsFromFile", () => {
  beforeEach(() => {
    scenario = {
      logCount: 4,
      logErrors: {
        1: "broken header",
      },
      sections: {
        0: {
          openable: true,
          minTimeUs: 1000,
          maxTimeUs: 2500,
          numMotors: 4,
          fieldNames: ["time", "gyroADC[0]"],
          fieldIndex: { time: 1, "gyroADC[0]": 4 },
        },
        2: {
          openable: true,
          minTimeUs: 3000,
          maxTimeUs: 9000,
          numMotors: 4,
          fieldNames: ["time", "setpoint[0]"],
          fieldIndex: { time: 1, "setpoint[0]": 7 },
        },
        3: {
          openable: false,
        },
      },
      instances: [],
    };
  });

  it("returns every readable section and records unreadable ones", async () => {
    const { loadFlightSessionsFromFile } = await import("./flightLogAdapter.js");
    const result = await loadFlightSessionsFromFile(await createFixtureFile());

    expect(result.totalLogSections).toBe(4);
    expect(result.sessions).toHaveLength(2);
    expect(result.unreadableSections).toEqual([
      { logIndex: 1, reason: "broken header" },
      { logIndex: 3, reason: "Failed to open log section #4." },
    ]);

    expect(result.sessions[0]).toMatchObject({
      fileName: "demo-log.BBL",
      logIndex: 0,
      logSectionLabel: "Section 1",
      totalLogSections: 4,
      name: "demo-log · Section 1",
      shortName: "Section 1",
      durationUs: 1500,
    });

    expect(result.sessions[1]).toMatchObject({
      logIndex: 2,
      logSectionLabel: "Section 3",
      durationUs: 6000,
    });
  });

  it("keeps legacy single-session loading behavior by returning the first readable section", async () => {
    const { loadFlightSessionFromFile } = await import("./flightLogAdapter.js");
    const session = await loadFlightSessionFromFile(await createFixtureFile());

    expect(session.logIndex).toBe(0);
    expect(session.logSectionLabel).toBe("Section 1");
  });
});
