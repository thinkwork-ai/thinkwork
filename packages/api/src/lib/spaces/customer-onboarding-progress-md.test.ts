import { describe, expect, it } from "vitest";

import {
  refreshCustomerOnboardingProgressMarkdown,
  renderCustomerOnboardingProgressMarkdown,
  type CustomerOnboardingProgressState,
} from "./customer-onboarding-progress-md.js";
import { normalizeCustomerOnboardingSource } from "./customer-onboarding-workflow.js";

const updatedAt = new Date("2026-05-25T17:00:00.000Z");

function state(
  overrides: Partial<CustomerOnboardingProgressState> = {},
): CustomerOnboardingProgressState {
  return {
    tenantSlug: "acme",
    threadId: "thread-1",
    threadTitle: "Onboard Acme Equipment",
    normalized: normalizeCustomerOnboardingSource({
      opportunityId: "opp-1",
      customerName: "Acme Equipment",
      customerId: "cust-1",
      taxExempt: true,
      creditTermsRequested: true,
      primaryContact: { name: "Robin Buyer", email: "robin@example.com" },
    }),
    tasks: [
      {
        title: "Send and receive DocuSign package",
        status: "todo",
        required: true,
        blocked: false,
        owner: "Sales",
        roleKey: "sales",
        checklistItemKey: "docusign_package",
        notes: null,
        updatedAt,
      },
      {
        title: "Check Dun & Bradstreet information",
        status: "completed",
        required: true,
        blocked: false,
        owner: "Finance",
        roleKey: "finance",
        checklistItemKey: "dun_and_bradstreet_check",
        notes: "Checked in portal.",
        updatedAt,
      },
      {
        title: "Run credit check",
        status: "blocked",
        required: true,
        blocked: true,
        owner: null,
        roleKey: "finance",
        checklistItemKey: "credit_check",
        notes: "Waiting on customer references.",
        updatedAt,
      },
      {
        title: "Collect tax exemption forms",
        status: "not_applicable",
        required: true,
        blocked: false,
        owner: "Accounting",
        roleKey: "accounting",
        checklistItemKey: "tax_exemption_forms",
        notes: null,
        updatedAt,
      },
    ],
    ...overrides,
  };
}

describe("customer onboarding PROGRESS.md", () => {
  it("renders current progress, assignments, blockers, and next steps", () => {
    const markdown = renderCustomerOnboardingProgressMarkdown({
      ...state(),
      updatedAt,
    });

    expect(markdown).toContain("# PROGRESS");
    expect(markdown).toContain(
      "Goal: Complete customer onboarding for Acme Equipment.",
    );
    expect(markdown).toContain("- Required complete: 1/3");
    expect(markdown).toContain(
      "| Send and receive DocuSign package | Todo | Sales | Yes |  |",
    );
    expect(markdown).toContain(
      "- Finance: Run credit check - Waiting on customer references.",
    );
    expect(markdown).toContain(
      "1. Capture missing intake: opportunityUrl, salesRep",
    );
  });

  it("advances next steps to the first active task once intake is complete", () => {
    const normalized = normalizeCustomerOnboardingSource({
      opportunityId: "opp-1",
      opportunityUrl: "https://example.com/opp-1",
      customerName: "Acme Equipment",
      salesRep: "Ruben Valdez",
      dealValue: "10000",
      productPlan: "PVL",
      closeDate: "2026-06-01",
      contacts: [{ name: "Robin Buyer", email: "robin@example.com" }],
      documents: [{ title: "Contract", url: "https://example.com/contract" }],
      primaryContact: { name: "Robin Buyer", email: "robin@example.com" },
      accountsPayableContact: { name: "Pat AP", email: "ap@example.com" },
      billingAddress: "1 Main",
      shippingAddress: "2 Dock",
      taxExempt: false,
      creditTermsRequested: false,
      docusignRecipient: { name: "Robin Buyer", email: "robin@example.com" },
    });

    const markdown = renderCustomerOnboardingProgressMarkdown({
      ...state({
        normalized,
        tasks: state().tasks.filter((task) => !task.blocked),
      }),
      updatedAt,
    });

    expect(markdown).toContain("## Missing Information\n- None.");
    expect(markdown).toContain(
      "1. Advance Send and receive DocuSign package with Sales.",
    );
  });

  it("writes rendered markdown through the supplied writer", async () => {
    const writes: Array<{
      tenantSlug: string;
      threadId: string;
      content: string;
    }> = [];

    const result = await refreshCustomerOnboardingProgressMarkdown(
      { tenantId: "tenant-1", threadId: "thread-1" },
      {
        now: () => updatedAt,
        repository: {
          load: async () => state(),
        },
        writer: {
          write: async (input) => {
            writes.push(input);
            return {
              key: "tenants/acme/threads/thread-1/PROGRESS.md",
              bytes: 123,
            };
          },
        },
      },
    );

    expect(result).toEqual({
      key: "tenants/acme/threads/thread-1/PROGRESS.md",
      bytes: 123,
    });
    expect(writes[0]).toMatchObject({
      tenantSlug: "acme",
      threadId: "thread-1",
    });
    expect(writes[0].content).toContain("Updated: 2026-05-25T17:00:00.000Z");
  });
});
