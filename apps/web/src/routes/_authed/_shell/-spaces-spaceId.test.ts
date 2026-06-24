import { describe, expect, it } from "vitest";
import {
  shouldShowCustomerOnboardingStart,
  summarizeSpaceWorkItems,
} from "./spaces.$spaceId";

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

describe("summarizeSpaceWorkItems", () => {
  it("counts open required, blocked, and due-soon Work Items", () => {
    expect(
      summarizeSpaceWorkItems([
        {
          id: "required-open",
          spaceId: "space-1",
          title: "Required open",
          priority: "NORMAL",
          required: true,
          applicable: true,
          blocked: false,
          dueAt: new Date().toISOString(),
        },
        {
          id: "blocked-open",
          spaceId: "space-1",
          title: "Blocked open",
          priority: "HIGH",
          required: true,
          applicable: true,
          blocked: true,
        },
        {
          id: "done",
          spaceId: "space-1",
          title: "Done",
          priority: "NORMAL",
          required: true,
          applicable: true,
          blocked: false,
          completedAt: new Date().toISOString(),
          status: {
            id: "done",
            name: "Done",
            category: "DONE",
          },
        },
      ]),
    ).toEqual({
      openRequired: 2,
      blocked: 1,
      dueSoon: 1,
    });
  });
});
