import { describe, expect, it } from "vitest";

import {
  CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
  CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS,
  CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES,
  CUSTOMER_ONBOARDING_SPACE_PROMPT,
  buildCustomerOnboardingChecklistConfig,
  buildCustomerOnboardingSpaceConfig,
  buildLastMileIntegrationConfig,
  parseRoleAssigneesJson,
} from "./customer-onboarding-seed";

describe("customer onboarding seed defaults", () => {
  const sourceFilePaths = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.map(
    (file) => file.path,
  );

  it("defines the required v1 onboarding checklist", () => {
    expect(CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.map((item) => item.key)).toEqual(
      [
        "docusign_package",
        "dun_and_bradstreet_check",
        "credit_check",
        "tax_exemption_forms",
        "p21_customer_setup",
        "missing_onboarding_information",
        "final_onboarding_review",
      ],
    );
    expect(
      CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.filter((item) => item.required).map(
        (item) => item.roleKey,
      ),
    ).toEqual([
      "sales",
      "finance",
      "finance",
      "accounting",
      "operations",
      "sales",
      "operations",
    ]);
    expect(CUSTOMER_ONBOARDING_SPACE_PROMPT).toContain(
      "Use ThinkWork as the system of record",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_PROMPT).not.toContain(
      "LastMile Tasks is the task system of record",
    );
    expect(CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS).toContain(
      "required ThinkWork checklist items",
    );
  });

  it("builds native Space and checklist config with role assignees", () => {
    const roleAssignees = {
      accounting: { externalId: "lm-user-accounting", displayName: "AP Team" },
      finance: { externalId: "lm-user-finance" },
    };

    expect(buildCustomerOnboardingSpaceConfig({ roleAssignees })).toEqual({
      workflow: "customer_onboarding",
      version: 1,
      checklistSystemOfRecord: "thinkwork",
      sourceFiles: sourceFilePaths,
      roleAssignees: {
        accounting: {
          externalId: "lm-user-accounting",
          displayName: "AP Team",
        },
        finance: { externalId: "lm-user-finance" },
      },
    });
    expect(buildCustomerOnboardingChecklistConfig()).toEqual({
      workflow: "customer_onboarding",
      version: 1,
      source: "thinkwork_seed",
      systemOfRecord: "thinkwork",
      applicabilityFields: ["creditTermsRequested", "taxExempt"],
    });
  });

  it("keeps LastMile integration config available for the phase-two path", () => {
    const roleAssignees = {
      accounting: { externalId: "lm-user-accounting", displayName: "AP Team" },
      finance: { externalId: "lm-user-finance" },
    };

    expect(
      buildLastMileIntegrationConfig({
        roleAssignees,
        externalProjectId: "lm-project-1",
      }),
    ).toMatchObject({
      workflow: "customer_onboarding",
      phase: "external_task_integration",
      externalProjectId: "lm-project-1",
      roleAssignees: expect.objectContaining({
        accounting: expect.objectContaining({ displayName: "AP Team" }),
      }),
    });
  });

  it("seeds ICM-style Space source files for editable intake guidance", () => {
    expect(sourceFilePaths).toEqual([
      "CONTEXT.md",
      "docs/customer-onboarding-intake.md",
      "goals/customer-onboarding/GOAL.md",
      "goals/customer-onboarding/PROGRESS.md",
      "goals/customer-onboarding/DECISIONS.md",
      "goals/customer-onboarding/ARTIFACTS.md",
      "goals/customer-onboarding/HANDOFFS.md",
      "goals/customer-onboarding/stages/kickoff/CONTEXT.md",
      "goals/customer-onboarding/stages/final-review/OUTPUT.md",
    ]);
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).toContain(
      "docs/customer-onboarding-intake.md",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).not.toContain(
      "skills/",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      "creditTermsRequested = true",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      "taxExempt = true",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).toContain(
      "Skills & Human Input",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).toContain(
      "Info Panel Goal panel",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).toContain(
      "goals/customer-onboarding/GOAL.md",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[0]?.content).toContain(
      "what is the status",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      "Human Question Skill Pattern",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      "Progress Status Rules",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      "Owners",
    );
    expect(CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES[1]?.content).toContain(
      '"_type": "question_card"',
    );

    const goalTemplate = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.find(
      (file) => file.path === "goals/customer-onboarding/GOAL.md",
    )?.content;
    expect(goalTemplate).toContain("Minimum Goal Contract");
    expect(goalTemplate).toContain("Mode: Collaborate");
    expect(goalTemplate).toContain("Review policy");
    expect(goalTemplate).toContain("Local / Portable Fallback");

    const decisionsTemplate = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.find(
      (file) => file.path === "goals/customer-onboarding/DECISIONS.md",
    )?.content;
    expect(decisionsTemplate).toContain("Decision Log");

    const artifactsTemplate = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.find(
      (file) => file.path === "goals/customer-onboarding/ARTIFACTS.md",
    )?.content;
    expect(artifactsTemplate).toContain("Artifact Index");

    const handoffsTemplate = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.find(
      (file) => file.path === "goals/customer-onboarding/HANDOFFS.md",
    )?.content;
    expect(handoffsTemplate).toContain("Handoff History");
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
