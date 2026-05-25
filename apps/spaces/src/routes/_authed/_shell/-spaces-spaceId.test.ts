import { describe, expect, it } from "vitest";
import { shouldShowCustomerOnboardingStart } from "./spaces.$spaceId";

describe("Space workroom route", () => {
  it("uses the onboarding starter only for Customer Onboarding Spaces", () => {
    expect(
      shouldShowCustomerOnboardingStart({
        kind: "customer_onboarding",
        templateKey: null,
      }),
    ).toBe(true);
    expect(
      shouldShowCustomerOnboardingStart({
        kind: "WORKROOM",
        templateKey: "customer-onboarding",
      }),
    ).toBe(true);
    expect(
      shouldShowCustomerOnboardingStart({
        kind: "WORKROOM",
        templateKey: "general",
      }),
    ).toBe(false);
  });
});
