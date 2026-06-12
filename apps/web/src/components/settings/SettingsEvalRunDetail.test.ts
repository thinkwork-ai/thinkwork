import { describe, expect, it } from "vitest";

import { calculateCategoryPassRates } from "./SettingsEvalRunDetail";

describe("SettingsEvalRunDetail category pass rates", () => {
  it("scores categories from completed eval results only", () => {
    const rates = calculateCategoryPassRates([
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "running" },
      { category: "red-team-prompt-injection", status: "pending" },
      { category: "red-team-prompt-injection", status: "waiting" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(1);
  });

  it("keeps terminal failures in the denominator but excludes errors (clean executions only)", () => {
    const rates = calculateCategoryPassRates([
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "fail" },
      // Errors never score (Trust Core U2): infra noise stays out of
      // the per-category denominator, matching the run-level pass rate.
      { category: "red-team-prompt-injection", status: "error" },
      { category: "red-team-prompt-injection", status: "running" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(1 / 2);
  });
});

describe("SettingsEvalRunDetail override-aware pass rates (U9)", () => {
  it("counts the effective verdict when an operator override is present", () => {
    const rates = calculateCategoryPassRates([
      // fail overridden to pass — effective verdict wins.
      {
        category: "red-team-prompt-injection",
        status: "fail",
        effectiveStatus: "pass",
      },
      { category: "red-team-prompt-injection", status: "fail" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(0.5);
  });
});
