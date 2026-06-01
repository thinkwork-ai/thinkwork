import { describe, expect, it } from "vitest";

import {
  customerOnboardingGoalReadiness,
  refreshCustomerOnboardingGoalFolder,
  renderCustomerOnboardingGoalFolder,
} from "./customer-onboarding-goal-md.js";
import {
  type CustomerOnboardingProgressState,
  type CustomerOnboardingProgressTask,
} from "./customer-onboarding-progress-md.js";
import { normalizeCustomerOnboardingSource } from "./customer-onboarding-workflow.js";

const updatedAt = new Date("2026-05-27T12:00:00.000Z");

describe("customer onboarding Goal folder", () => {
  it("renders the required portable Goal files from task and narrative state", () => {
    const folder = renderCustomerOnboardingGoalFolder({
      ...state(),
      updatedAt,
    });

    expect(folder.files.map((file) => file.file)).toEqual([
      "THREAD.md",
      "GOAL.md",
      "PROGRESS.md",
      "TASKS.md",
      "DECISIONS.md",
      "ARTIFACTS.md",
      "HANDOFFS.md",
    ]);
    expect(
      folder.files.find((file) => file.file === "THREAD.md")?.content,
    ).toContain("Use task/status tools to change checklist state");
    expect(
      folder.files.find((file) => file.file === "GOAL.md")?.content,
    ).toContain("Review policy: human final review is required");
    expect(
      folder.files.find((file) => file.file === "PROGRESS.md")?.content,
    ).toContain("- Required complete: 1/2");
    expect(
      folder.files.find((file) => file.file === "TASKS.md")?.content,
    ).toContain("| Run credit check | Todo | Finance | Yes | No |  |");
    expect(
      folder.files.find((file) => file.file === "DECISIONS.md")?.content,
    ).toContain("- Credit approval notes: Approved up to 25k.");
    expect(
      folder.files.find((file) => file.file === "ARTIFACTS.md")?.content,
    ).toContain("- Signed order form: https://docs.example/order");
    expect(
      folder.files.find((file) => file.file === "HANDOFFS.md")?.content,
    ).toContain("- Finance: Run credit check (Todo)");
  });

  it("moves to review when required applicable tasks are complete", async () => {
    const writes: Array<{ file: string; content: string }> = [];
    const statusUpdates: Array<{ status: string }> = [];
    const completeTasks = [
      task({ title: "Send DocuSign", status: "completed" }),
      task({
        title: "Collect tax exemption forms",
        status: "not_applicable",
      }),
    ];

    const result = await refreshCustomerOnboardingGoalFolder(
      { tenantId: "tenant-1", threadId: "thread-1" },
      {
        now: () => updatedAt,
        repository: {
          load: async () => state({ tasks: completeTasks }),
        },
        statusUpdater: {
          update: async (input) => {
            statusUpdates.push({ status: input.status });
          },
        },
        writer: {
          write: async (input) => {
            writes.push({ file: input.file, content: input.content });
            return {
              key: `tenants/${input.tenantSlug}/threads/${input.threadId}/${input.file}`,
              bytes: input.content.length,
            };
          },
        },
      },
    );

    expect(statusUpdates).toEqual([{ status: "in_review" }]);
    expect(writes).toHaveLength(7);
    expect(
      writes.find((write) => write.file === "THREAD.md")?.content,
    ).toContain("Ready for review: yes");
    expect(writes.find((write) => write.file === "GOAL.md")?.content).toContain(
      "Ready for human final review.",
    );
    expect(result?.map((write) => write.key)).toContain(
      "tenants/acme/threads/thread-1/PROGRESS.md",
    );
  });

  it("preserves existing narrative files while refreshing DB-rendered status files", async () => {
    const writes: Array<{ file: string; content: string }> = [];
    const existingNarratives = new Set(["DECISIONS.md", "ARTIFACTS.md"]);

    await refreshCustomerOnboardingGoalFolder(
      { tenantId: "tenant-1", threadId: "thread-1" },
      {
        now: () => updatedAt,
        repository: {
          load: async () => state(),
        },
        statusUpdater: {
          update: async () => {},
        },
        writer: {
          read: async (input) =>
            existingNarratives.has(input.file) ? "agent-authored\n" : null,
          write: async (input) => {
            writes.push({ file: input.file, content: input.content });
            return {
              key: `tenants/${input.tenantSlug}/threads/${
                input.threadFolderName ?? input.threadId
              }/${input.file}`,
              bytes: input.content.length,
            };
          },
        },
      },
    );

    expect(writes.map((write) => write.file)).toEqual([
      "THREAD.md",
      "GOAL.md",
      "PROGRESS.md",
      "TASKS.md",
      "HANDOFFS.md",
    ]);
  });

  it("excludes not-applicable tasks from required completion math", () => {
    const readiness = customerOnboardingGoalReadiness([
      task({ status: "completed" }),
      task({ status: "not_applicable" }),
      task({ status: "todo", required: false }),
    ]);

    expect(readiness).toEqual({
      status: "in_review",
      completedRequired: 1,
      totalRequired: 1,
      readyForReview: true,
    });
  });

  it("keeps all-not-applicable task sets active for human correction", () => {
    const readiness = customerOnboardingGoalReadiness([
      task({ status: "not_applicable" }),
      task({ status: "not_applicable" }),
    ]);

    expect(readiness).toEqual({
      status: "active",
      completedRequired: 0,
      totalRequired: 0,
      readyForReview: false,
    });
  });
});

function state(
  overrides: Partial<CustomerOnboardingProgressState> = {},
): CustomerOnboardingProgressState {
  return {
    tenantSlug: "acme",
    threadId: "thread-1",
    threadFolderName: "customer-kickoff",
    spaceId: "space-1",
    threadTitle: "Acme onboarding",
    normalized: normalizeCustomerOnboardingSource({
      opportunityId: "opp-1",
      customerId: "cust-1",
      companyName: "Acme",
      opportunityUrl: "https://crm.example/opp-1",
      salesRep: "Ruben Valdez",
      contacts: [{ name: "Robin Buyer", email: "robin@example.com" }],
      dealValue: "25000",
      productPlan: "Enterprise",
      closeDate: "2026-06-01",
      documents: [
        { title: "Signed order form", url: "https://docs.example/order" },
      ],
      primaryContact: { name: "Robin Buyer", email: "robin@example.com" },
      accountsPayableContact: { name: "Pat AP", email: "ap@example.com" },
      billingAddress: "1 Main St",
      shippingAddress: "2 Dock St",
      taxExempt: false,
      creditTermsRequested: true,
      requestedTerms: "Net 30",
      creditApprovalNotes: "Approved up to 25k",
      docusignRecipient: { name: "Robin Buyer", email: "robin@example.com" },
      contractLink: "https://docs.example/contract",
      dunAndBradstreetId: "DUNS-123",
      p21CustomerId: "P21-123",
    }),
    tasks: [
      task({ title: "Send DocuSign", status: "completed", owner: "Sales" }),
      task({ title: "Run credit check", status: "todo", owner: "Finance" }),
      task({
        title: "Collect tax exemption forms",
        status: "not_applicable",
        owner: "Accounting",
      }),
    ],
    ...overrides,
  };
}

function task(
  overrides: Partial<CustomerOnboardingProgressTask> = {},
): CustomerOnboardingProgressTask {
  return {
    title: "Task",
    status: "todo",
    required: true,
    blocked: false,
    owner: null,
    roleKey: null,
    checklistItemKey: null,
    notes: null,
    updatedAt,
    ...overrides,
  };
}
