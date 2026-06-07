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

  it("keeps terminal failures and errors in the scored denominator", () => {
    const rates = calculateCategoryPassRates([
      { category: "red-team-prompt-injection", status: "pass" },
      { category: "red-team-prompt-injection", status: "fail" },
      { category: "red-team-prompt-injection", status: "error" },
      { category: "red-team-prompt-injection", status: "running" },
    ]);

    expect(rates["red-team-prompt-injection"]).toBe(1 / 3);
  });
});
