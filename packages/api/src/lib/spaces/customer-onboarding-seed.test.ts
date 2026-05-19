import { describe, expect, it } from "vitest";

import {
  CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
  CUSTOMER_ONBOARDING_SPACE_PROMPT,
  buildCustomerOnboardingSpaceConfig,
  buildLastMileIntegrationConfig,
  parseRoleAssigneesJson,
} from "./customer-onboarding-seed";

describe("customer onboarding seed defaults", () => {
  it("defines the required v1 onboarding checklist", () => {
    expect(CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.map((item) => item.key)).toEqual(
      [
        "docusign",
        "sales_tax_exemption",
        "erp_customer_setup",
        "credit_report",
        "internal_kickoff",
      ],
    );
    expect(
      CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.filter((item) => item.required).map(
        (item) => item.roleKey,
      ),
    ).toEqual(["sales", "accounting", "operations", "finance"]);
    expect(CUSTOMER_ONBOARDING_SPACE_PROMPT).toContain(
      "LastMile Tasks is the task system of record",
    );
  });

  it("builds Space and LastMile integration config with role assignees", () => {
    const roleAssignees = {
      accounting: { externalId: "lm-user-accounting", displayName: "AP Team" },
      finance: { externalId: "lm-user-finance" },
    };

    expect(buildCustomerOnboardingSpaceConfig({ roleAssignees })).toEqual({
      workflow: "customer_onboarding",
      version: 1,
      roleAssignees: {
        accounting: {
          externalId: "lm-user-accounting",
          displayName: "AP Team",
        },
        finance: { externalId: "lm-user-finance" },
      },
    });
    expect(
      buildLastMileIntegrationConfig({
        roleAssignees,
        externalProjectId: "lm-project-1",
      }),
    ).toMatchObject({
      workflow: "customer_onboarding",
      externalProjectId: "lm-project-1",
      roleAssignees: expect.objectContaining({
        accounting: expect.objectContaining({ displayName: "AP Team" }),
      }),
    });
  });

  it("parses role assignee JSON for the seed script", () => {
    expect(
      parseRoleAssigneesJson(
        JSON.stringify({
          sales: { id: "lm-sales", name: "Sales Queue" },
        }),
      ),
    ).toEqual({
      sales: {
        externalId: "lm-sales",
        displayName: "Sales Queue",
      },
    });
    expect(() => parseRoleAssigneesJson("[]")).toThrow(/must be a JSON object/);
  });
});
