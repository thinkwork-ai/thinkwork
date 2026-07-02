import { describe, expect, it } from "vitest";

import { clampTrials, shortModelLabel } from "./SettingsEvalProfiles";

describe("clampTrials", () => {
  it("clamps to the server's 1..9 bound and rounds fractional input", () => {
    expect(clampTrials(3)).toBe(3);
    expect(clampTrials(0)).toBe(1);
    expect(clampTrials(-2)).toBe(1);
    expect(clampTrials(12)).toBe(9);
    expect(clampTrials(2.6)).toBe(3);
    expect(clampTrials(Number.NaN)).toBe(1);
  });
});

describe("shortModelLabel", () => {
  it("strips vendor prefixes and version suffixes for display", () => {
    expect(shortModelLabel("moonshotai.kimi-k2.5")).toBe("kimi-k2.5");
    // Both the -vN:M suffix and the trailing date stamp strip.
    expect(shortModelLabel("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(
      "claude-haiku-4-5",
    );
    expect(shortModelLabel(null)).toBe("—");
  });
});
