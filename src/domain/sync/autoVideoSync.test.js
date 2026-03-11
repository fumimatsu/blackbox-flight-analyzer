import { describe, expect, it } from "vitest";
import { calculateAutoVideoOffset } from "./autoVideoSync.js";

describe("calculateAutoVideoOffset", () => {
  it("converts log arm time into a DVR offset relative to log start", () => {
    expect(calculateAutoVideoOffset(6500000, 8.25, 1000000)).toBeCloseTo(2.75, 5);
  });

  it("does not allow negative elapsed log time", () => {
    expect(calculateAutoVideoOffset(500000, 1.5, 1000000)).toBeCloseTo(1.5, 5);
  });
});
