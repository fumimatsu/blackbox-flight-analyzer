import { describe, expect, it } from "vitest";
import { estimateBatteryCellCount } from "./batteryReview.js";

describe("estimateBatteryCellCount", () => {
  it("ignores unrealistic vendor cell count estimates and falls back to observed voltage", () => {
    const samples = [
      { battery: { voltage: 25.2 } },
      { battery: { voltage: 24.7 } },
    ];
    const batteryConfig = {
      warningCellVoltage: 3.5,
      criticalCellVoltage: 3.3,
      maxCellVoltage: 4.2,
      cellCountEstimate: 57,
    };

    expect(estimateBatteryCellCount(samples, batteryConfig)).toBe(6);
  });
});
