import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractCustomerOnboardingChatUpdate,
  shouldDispatchAgentForCustomerOnboardingMessage,
} from "./customer-onboarding-chat-updates.js";

describe("extractCustomerOnboardingChatUpdate", () => {
  it("extracts intake answers and same-thread checklist completions", () => {
    const result = extractCustomerOnboardingChatUpdate(
      [
        "Here is the missing onboarding data: opportunity link https://crm.example.com/opportunities/e2e-trigger-co",
        "sales owner Ruben Valdez",
        "primary customer contact Jordan Lee, jordan@example.com",
        "estimated value $42,000",
        "product plan All PVL products",
        "target onboarding date 2026-06-15",
        "contract link https://docusign.example.com/envelopes/e2e-trigger-co",
        "accounts payable contact Pat Morgan, ap@example.com",
        "billing address 100 Main St, Austin, TX 78701",
        "shipping address same as billing",
        "agricultural/sales-tax exempt yes",
        "credit terms requested yes",
        "DocuSign recipient Jordan Lee, jordan@example.com",
        "Also mark Dun & Bradstreet checked complete and tax exemption forms collected complete.",
      ].join("; "),
    );

    expect(result.facts).toMatchObject({
      opportunityUrl: "https://crm.example.com/opportunities/e2e-trigger-co",
      salesRep: "Ruben Valdez",
      dealValue: "$42,000",
      productPlan: "All PVL products",
      closeDate: "2026-06-15",
      contractLink: "https://docusign.example.com/envelopes/e2e-trigger-co",
      billingAddress: "100 Main St, Austin, TX 78701",
      billingSameAsShipping: true,
      taxExempt: true,
      creditTermsRequested: true,
      taxExemptionFormReceived: true,
    });
    expect(result.facts.primaryContact).toEqual({
      name: "Jordan Lee",
      email: "jordan@example.com",
    });
    expect(result.facts.accountsPayableContact).toEqual({
      name: "Pat Morgan",
      email: "ap@example.com",
    });
    expect(result.facts.docusignRecipient).toEqual({
      name: "Jordan Lee",
      email: "jordan@example.com",
    });
    expect(result.completedTaskKeys).toEqual([
      "dun_and_bradstreet_check",
      "tax_exemption_forms",
    ]);
    expect(result.statusRequest).toBe(false);
  });

  it("keeps negative credit terms negative", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "Credit terms requested no; tax exempt no.",
    );

    expect(result.facts).toMatchObject({
      creditTermsRequested: false,
      taxExempt: false,
    });
  });

  it("recognizes status requests as Customer Onboarding progress requests", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "what is the onboarding status?",
    );

    expect(result.statusRequest).toBe(true);
    expect(result.facts).toEqual({});
    expect(result.taskStatusUpdates).toEqual([]);
  });

  it("lets email delivery status requests continue to the agent", () => {
    expect(
      shouldDispatchAgentForCustomerOnboardingMessage(
        "can you email me the status of things",
      ),
    ).toBe(true);
    expect(
      shouldDispatchAgentForCustomerOnboardingMessage(
        "what is the onboarding status?",
      ),
    ).toBe(false);
    expect(
      shouldDispatchAgentForCustomerOnboardingMessage(
        "email me when the customer signs the contract",
      ),
    ).toBe(false);
  });

  it("maps task-prefixed chat replies to native checklist statuses", () => {
    const result = extractCustomerOnboardingChatUpdate(
      [
        "Send and receive DocuSign package: sent but waiting on customer",
        "Run credit check: blocked by finance approval",
        "Enter customer information into P21: done",
        "Collect tax exemption forms: not applicable",
      ].join("; "),
    );

    expect(result.taskStatusUpdates).toEqual([
      {
        key: "docusign_package",
        status: "blocked",
        note: "Send and receive DocuSign package: sent but waiting on customer",
      },
      {
        key: "credit_check",
        status: "blocked",
        note: "Run credit check: blocked by finance approval",
      },
      {
        key: "p21_customer_setup",
        status: "completed",
        note: "Enter customer information into P21: done",
      },
      {
        key: "tax_exemption_forms",
        status: "not_applicable",
        note: "Collect tax exemption forms: not applicable",
      },
    ]);
  });

  it("treats natural credit approval replies as credit-check completion evidence", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "Credit check and limit set at $10k",
    );

    expect(result.facts).toMatchObject({
      creditTermsRequested: true,
      requestedTerms: "Credit limit $10k",
      creditApprovalNotes: "Credit check and limit set at $10k",
    });
    expect(result.taskStatusUpdates).toEqual([
      {
        key: "credit_check",
        status: "completed",
        note: "Credit check and limit set at $10k",
      },
    ]);
    expect(result.completedTaskKeys).toEqual(["credit_check"]);
  });

  it("maps same-message member assignment and natural task completions", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "@Rebecca Odom is going to handle the data entry. We've already check D&B. We ran their credit, and they are approved for $10k.",
    );

    expect(result.facts).toMatchObject({
      creditTermsRequested: true,
      requestedTerms: "Credit limit $10k",
    });
    expect(result.taskStatusUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "dun_and_bradstreet_check",
          status: "completed",
        }),
        expect.objectContaining({
          key: "credit_check",
          status: "completed",
        }),
      ]),
    );
    expect(result.taskAssignments).toEqual([
      {
        key: "p21_customer_setup",
        assigneeDisplay: "Rebecca Odom",
        note: "@Rebecca Odom is going to handle the data entry.",
      },
    ]);
  });

  it("maps plain-English Dun and Bradstreet completion variants", () => {
    for (const content of [
      "Dun and Bradstreet is complete",
      "D and B is done",
      "D&B checked",
    ]) {
      const result = extractCustomerOnboardingChatUpdate(content);

      expect(result.taskStatusUpdates).toEqual([
        {
          key: "dun_and_bradstreet_check",
          status: "completed",
          note: content,
        },
      ]);
      expect(result.completedTaskKeys).toEqual(["dun_and_bradstreet_check"]);
      expect(shouldDispatchAgentForCustomerOnboardingMessage(content)).toBe(
        false,
      );
    }
  });

  it("extracts checklist task additions from message commands", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "Add a new task to the thread:\n\nConfirm Tank Certification",
    );

    expect(result.taskAdditions).toEqual([
      {
        title: "Confirm Tank Certification",
        note: "Add a new task to the thread: Confirm Tank Certification",
        assigneeDisplay: null,
      },
    ]);
    expect(result.taskRemovals).toEqual([]);
  });

  it("extracts short new-task commands and separates assignee language", () => {
    const shorthand = extractCustomerOnboardingChatUpdate(
      "New task: Get Tank Certifications",
    );
    const assigned = extractCustomerOnboardingChatUpdate(
      "add a new task: Get Tank Certifications, @Rebecca Odom will handle that task",
    );
    const assignedToAgent = extractCustomerOnboardingChatUpdate(
      "add a new task: Get Tank Certifications, assign it to the agent",
    );

    expect(shorthand.taskAdditions).toEqual([
      {
        title: "Get Tank Certifications",
        note: "New task: Get Tank Certifications",
        assigneeDisplay: null,
      },
    ]);
    expect(assigned.taskAdditions).toEqual([
      {
        title: "Get Tank Certifications",
        note: "add a new task: Get Tank Certifications, @Rebecca Odom will handle that task",
        assigneeDisplay: "Rebecca Odom",
      },
    ]);
    expect(assignedToAgent.taskAdditions).toEqual([
      {
        title: "Get Tank Certifications",
        note: "add a new task: Get Tank Certifications, assign it to the agent",
        assigneeDisplay: "Agent",
      },
    ]);
  });

  it("extracts checklist task removals by custom title and known task alias", () => {
    const custom = extractCustomerOnboardingChatUpdate(
      "Remove Confirm Tank Certification from the checklist",
    );
    const known = extractCustomerOnboardingChatUpdate(
      "Remove the tax exemption forms task",
    );

    expect(custom.taskRemovals).toEqual([
      {
        title: "Confirm Tank Certification",
        key: null,
        note: "Remove Confirm Tank Certification from the checklist",
      },
    ]);
    expect(known.taskRemovals).toEqual([
      {
        title: "tax exemption forms",
        key: "tax_exemption_forms",
        note: "Remove the tax exemption forms task",
      },
    ]);
  });

  it("maps clicked-task prefill commands to removals and statuses", () => {
    const removed = extractCustomerOnboardingChatUpdate(
      "Get the Agriculture Exemption Form: Remove",
    );
    const deleted = extractCustomerOnboardingChatUpdate(
      "Get Tank Certifications: Delete task",
    );
    const completed = extractCustomerOnboardingChatUpdate(
      "Get Tank Certifications: completed",
    );
    const blocked = extractCustomerOnboardingChatUpdate(
      "Get Tank Certifications: blocked",
    );
    const knownTask = extractCustomerOnboardingChatUpdate(
      "Collect tax exemption forms: Delete",
    );
    const assigned = extractCustomerOnboardingChatUpdate(
      "Get Tank Certifications: assign to @Scott Hertel",
    );
    const assignedToAgent = extractCustomerOnboardingChatUpdate(
      "Get Tank Certifications: assign to agent",
    );

    expect(removed.taskRemovals).toEqual([
      {
        title: "Get the Agriculture Exemption Form",
        key: null,
        note: "Get the Agriculture Exemption Form: Remove",
      },
    ]);
    expect(deleted.taskRemovals).toEqual([
      {
        title: "Get Tank Certifications",
        key: null,
        note: "Get Tank Certifications: Delete task",
      },
    ]);
    expect(completed.taskStatusUpdates).toEqual([
      {
        key: "custom_get_tank_certifications",
        status: "completed",
        note: "Get Tank Certifications: completed",
      },
    ]);
    expect(blocked.taskStatusUpdates).toEqual([
      {
        key: "custom_get_tank_certifications",
        status: "blocked",
        note: "Get Tank Certifications: blocked",
      },
    ]);
    expect(knownTask.taskRemovals).toEqual([
      {
        title: "Collect tax exemption forms",
        key: "tax_exemption_forms",
        note: "Collect tax exemption forms: Delete",
      },
    ]);
    expect(assigned.taskAssignments).toEqual([
      {
        key: "custom_get_tank_certifications",
        assigneeDisplay: "Scott Hertel",
        note: "Get Tank Certifications: assign to @Scott Hertel",
      },
    ]);
    expect(assignedToAgent.taskAssignments).toEqual([
      {
        key: "custom_get_tank_certifications",
        assigneeDisplay: "Agent",
        note: "Get Tank Certifications: assign to agent",
      },
    ]);
  });

  it("maps clicked native task prefills with customer suffixes and ISO timestamps", () => {
    const completed = extractCustomerOnboardingChatUpdate(
      "Send and receive DocuSign package - AgentCore workspace shape 2026-06-01T08:05:31.708Z: done",
    );
    const blocked = extractCustomerOnboardingChatUpdate(
      "Check Dun & Bradstreet information - AgentCore workspace shape 2026-06-01T08:05:31.708Z: blocked",
    );

    expect(completed.taskStatusUpdates).toEqual([
      {
        key: "docusign_package",
        status: "completed",
        note: "Send and receive DocuSign package - AgentCore workspace shape 2026-06-01T08:05:31.708Z: done",
      },
    ]);
    expect(completed.completedTaskKeys).toEqual(["docusign_package"]);
    expect(blocked.taskStatusUpdates).toEqual([
      {
        key: "dun_and_bradstreet_check",
        status: "blocked",
        note: "Check Dun & Bradstreet information - AgentCore workspace shape 2026-06-01T08:05:31.708Z: blocked",
      },
    ]);
  });

  it("maps missing onboarding information prefill commands to the native checklist row", () => {
    const completed = extractCustomerOnboardingChatUpdate(
      "Resolve missing onboarding information: done",
    );
    const natural = extractCustomerOnboardingChatUpdate(
      "The missing onboarding information is completed",
    );

    expect(completed.taskStatusUpdates).toEqual([
      {
        key: "missing_onboarding_information",
        status: "completed",
        note: "Resolve missing onboarding information: done",
      },
    ]);
    expect(completed.completedTaskKeys).toEqual([
      "missing_onboarding_information",
    ]);
    expect(natural.taskStatusUpdates).toEqual([
      {
        key: "missing_onboarding_information",
        status: "completed",
        note: "The missing onboarding information is completed",
      },
    ]);
  });

  it("maps mentioned DocuSign ownership updates to the DocuSign task", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "@Rebecca Odom is handling the DocuSign package too",
    );

    expect(result.taskAssignments).toEqual([
      {
        key: "docusign_package",
        assigneeDisplay: "Rebecca Odom",
        note: "@Rebecca Odom is handling the DocuSign package too",
      },
    ]);
  });

  it("recognizes task assignment questions as onboarding workflow requests", () => {
    const result = extractCustomerOnboardingChatUpdate(
      "whose assigned to the docusign task?",
    );

    expect(result.assignmentRequest).toBe(true);
    expect(result.assignmentTaskKey).toBe("docusign_package");
    expect(result.facts).toEqual({});
    expect(result.taskAssignments).toEqual([]);
  });
});

describe("sendMessage customer onboarding hook", () => {
  it("applies onboarding chat updates before default agent dispatch", () => {
    const source = readFileSync(
      new URL(
        "../../graphql/resolvers/messages/sendMessage.mutation.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("applyCustomerOnboardingChatUpdate");
    expect(source).toContain("customerOnboardingHandled");
    expect(source).toContain("agentDispatchRequired");
    expect(
      source.indexOf("await applyCustomerOnboardingChatUpdate"),
    ).toBeLessThan(source.indexOf("await dispatchDefaultAgentTurn"));
    expect(source).toContain("shouldApplyCustomerOnboardingChatUpdate");
    expect(source).toContain("shouldDispatchDefaultAgentTurn");
  });

  it("does not return generic-agent fallback before checking onboarding workflow metadata", () => {
    const source = readFileSync(
      new URL("./customer-onboarding-chat-updates.ts", import.meta.url),
      "utf8",
    );

    expect(source.indexOf("const [thread] = await db")).toBeLessThan(
      source.indexOf(
        "if (onboarding.workflow !== CUSTOMER_ONBOARDING_TEMPLATE_KEY)",
      ),
    );
    expect(source).toContain("buildCustomerOnboardingOnlySummary");
    expect(source).toContain("assignmentRequest");
  });

  it("does not mark non-actionable onboarding chat as handled", () => {
    const source = readFileSync(
      new URL("./customer-onboarding-chat-updates.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const shouldHandle");
    expect(source).toContain("handled: false");
    expect(source.indexOf("if (!shouldHandle)")).toBeLessThan(
      source.indexOf("const assistantContent"),
    );
  });
});
