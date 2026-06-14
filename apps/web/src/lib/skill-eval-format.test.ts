import { describe, expect, it } from "vitest";
import { formatGateThreshold, formatPassRatePct } from "./skill-eval-format";

describe("formatPassRatePct", () => {
  it("renders a fraction as an integer percent", () => {
    expect(formatPassRatePct(0.8)).toBe("80%");
    expect(formatPassRatePct(1)).toBe("100%");
    expect(formatPassRatePct(0)).toBe("0%");
  });

  it("rounds to the nearest percent", () => {
    expect(formatPassRatePct(0.666)).toBe("67%");
  });

  it("passes through null/undefined/NaN as null (no score)", () => {
    expect(formatPassRatePct(null)).toBeNull();
    expect(formatPassRatePct(undefined)).toBeNull();
    expect(formatPassRatePct(Number.NaN)).toBeNull();
  });
});

describe("formatGateThreshold", () => {
  it("renders a set threshold as a percent", () => {
    expect(formatGateThreshold(0.75)).toBe("75%");
  });

  it("renders an absent threshold as 'off'", () => {
    expect(formatGateThreshold(null)).toBe("off");
    expect(formatGateThreshold(undefined)).toBe("off");
  });
});
