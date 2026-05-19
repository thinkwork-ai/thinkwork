import { describe, expect, it, vi } from "vitest";

import {
  CustomerOnboardingWorkflowError,
  type CustomerOnboardingWorkflowRepository,
  type CustomerOnboardingWorkflowSpace,
  startCustomerOnboardingWorkflow,
} from "./customer-onboarding-workflow.js";

const baseSpace: CustomerOnboardingWorkflowSpace = {
  id: "space-1",
  tenantId: "tenant-1",
  name: "Customer Onboarding",
  prompt: "Keep onboarding moving.",
  config: null,
  checklistItems: [
    {
      id: "item-tax",
      key: "sales-tax",
      title: "Collect sales tax exemption",
      description: "Ask customer for the exemption form.",
      roleKey: "accounting",
      required: true,
      externalTaskTemplate: null,
    },
    {
      id: "item-credit",
      key: "credit-report",
      title: "Run credit report",
      description: null,
      roleKey: "finance",
      required: true,
      externalTaskTemplate: null,
    },
  ],
  agentAssignments: [
    {
      agentId: "agent-coordinator",
      localRole: "coordinator",
      autoSubscribe: true,
    },
  ],
  integration: {
    id: "integration-1",
    writebackPolicy: "status_only",
    config: {
      roleAssignees: {
        accounting: {
          externalId: "lm-user-accounting",
          displayName: "Accounting Owner",
        },
      },
    },
  },
};

const richPayload = {
  event: "opportunity.won",
  opportunityId: "opp-123",
  opportunityUrl: "https://crm.example/opportunities/opp-123",
  customerId: "cust-123",
  companyName: "Acme Corp",
  salesRep: { name: "Sam Sales", email: "sam@example.com" },
  contacts: [{ name: "Casey Customer", email: "casey@example.com" }],
  dealValue: 125000,
  productPlan: "Enterprise",
  closeDate: "2026-05-19",
  notes: "Customer needs ERP entry before kickoff.",
  documents: [
    { title: "Signed order form", url: "https://docs.example/order" },
  ],
};

const noopCoordinator = {
  enqueueWakeup: async () => ({
    ok: true as const,
    enqueued: false as const,
    reason: "coordinator_assignment_not_found" as const,
  }),
};

describe("startCustomerOnboardingWorkflow", () => {
  it("creates one case thread, kickoff, participants, and linked LastMile tasks", async () => {
    const repository = makeRepository();
    const taskAdapter = {
      createTask: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            externalTaskId: "LM-100",
            externalTaskUrl: "https://tasks.example/LM-100",
            title: "Collect sales tax exemption - Acme Corp",
            status: "todo",
            blocked: false,
            syncStatus: "synced",
            assignee: {
              externalId: "lm-user-accounting",
              displayName: "Accounting Owner",
            },
            dueAt: null,
            idempotent: false,
            needsTriage: false,
            raw: {},
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            externalTaskId: "LM-101",
            externalTaskUrl: null,
            title: "Run credit report - Acme Corp",
            status: "todo",
            blocked: false,
            syncStatus: "synced",
            assignee: null,
            dueAt: null,
            idempotent: false,
            needsTriage: true,
            raw: {},
          },
        }),
    };
    const coordinator = {
      enqueueWakeup: vi.fn(async () => ({
        ok: true as const,
        enqueued: true as const,
        wakeupRequestId: "wakeup-1",
        agentId: "agent-coordinator",
        assignmentId: "assignment-1",
      })),
    };

    const result = await startCustomerOnboardingWorkflow(
      {
        tenantId: "tenant-1",
        source: "webhook",
        opportunity: richPayload,
        startedBy: { type: "system" },
      },
      { repository, taskAdapter, coordinator },
    );

    expect(result).toMatchObject({
      idempotent: false,
      thread: {
        id: "thread-1",
        title: "Acme Corp onboarding",
        identifier: "HOOK-42",
      },
      linkedTasks: [
        { externalTaskId: "LM-100", syncStatus: "synced" },
        { externalTaskId: "LM-101", syncStatus: "synced" },
      ],
      missingFields: [],
    });
    expect(repository.createdCases[0]).toMatchObject({
      channel: "webhook",
      title: "Acme Corp onboarding",
      createdByType: "system",
    });
    expect(repository.createdCases[0]?.kickoffMessage).toContain(
      "Opportunity: opp-123",
    );
    expect(repository.createdCases[0]?.metadata).toMatchObject({
      customerOnboarding: {
        opportunityId: "opp-123",
        customerId: "cust-123",
        spaceId: "space-1",
      },
    });
    expect(taskAdapter.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "customer-onboarding:tenant-1:opp-123:sales-tax",
        assignee: {
          roleKey: "accounting",
          externalId: "lm-user-accounting",
          displayName: "Accounting Owner",
        },
      }),
    );
    expect(repository.linkedTasks).toHaveLength(2);
    expect(coordinator.enqueueWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        reason: "kickoff_triage",
      }),
    );
  });

  it("returns the existing Thread for duplicate close-won events without creating tasks", async () => {
    const repository = makeRepository({
      existingThread: {
        id: "thread-existing",
        tenantId: "tenant-1",
        spaceId: "space-1",
        title: "Acme Corp onboarding",
        identifier: "HOOK-7",
        metadata: null,
      },
    });
    const taskAdapter = { createTask: vi.fn() };

    const result = await startCustomerOnboardingWorkflow(
      {
        tenantId: "tenant-1",
        source: "webhook",
        opportunity: richPayload,
      },
      { repository, taskAdapter, coordinator: noopCoordinator },
    );

    expect(result).toMatchObject({
      idempotent: true,
      thread: { id: "thread-existing" },
      linkedTasks: [],
    });
    expect(repository.createdCases).toEqual([]);
    expect(taskAdapter.createTask).not.toHaveBeenCalled();
  });

  it("keeps missing optional CRM facts in the kickoff instead of failing", async () => {
    const repository = makeRepository({
      space: { ...baseSpace, checklistItems: [baseSpace.checklistItems[0]!] },
    });
    const taskAdapter = successfulTaskAdapter("LM-200");

    const result = await startCustomerOnboardingWorkflow(
      {
        tenantId: "tenant-1",
        source: "manual",
        opportunity: {
          opportunityId: "opp-min",
          customerName: "Minimal Customer",
        },
        startedBy: { type: "user", id: "user-1" },
      },
      { repository, taskAdapter, coordinator: noopCoordinator },
    );

    expect(result.missingFields).toEqual([
      "opportunityUrl",
      "salesRep",
      "contacts",
      "dealValue",
      "productPlan",
      "closeDate",
      "documents",
    ]);
    expect(repository.createdCases[0]).toMatchObject({
      channel: "manual",
      createdByType: "user",
      createdById: "user-1",
    });
    expect(repository.createdCases[0]?.kickoffMessage).toContain(
      "Missing CRM fields: opportunityUrl",
    );
  });

  it("mirrors provider failures as linked task sync errors", async () => {
    const repository = makeRepository({
      space: { ...baseSpace, checklistItems: [baseSpace.checklistItems[0]!] },
    });
    const taskAdapter = {
      createTask: vi.fn(async () => ({
        ok: false as const,
        providerError: {
          code: "MCP_CALL_FAILED",
          message: "LastMile unavailable",
          retryable: true,
          status: 503,
        },
      })),
    };

    const result = await startCustomerOnboardingWorkflow(
      {
        tenantId: "tenant-1",
        source: "webhook",
        opportunity: richPayload,
      },
      { repository, taskAdapter, coordinator: noopCoordinator },
    );

    expect(result.linkedTasks[0]).toMatchObject({
      externalTaskId: "pending:thread-1:item-tax",
      syncStatus: "error",
      providerError: { code: "MCP_CALL_FAILED" },
    });
    expect(repository.linkedTasks[0]?.task.providerError).toMatchObject({
      message: "LastMile unavailable",
    });
  });

  it("rejects malformed onboarding starts before creating a Thread", async () => {
    const repository = makeRepository();

    await expect(
      startCustomerOnboardingWorkflow(
        {
          tenantId: "tenant-1",
          source: "webhook",
          opportunity: { opportunityId: "opp-no-customer" },
        },
        {
          repository,
          taskAdapter: successfulTaskAdapter("LM-1"),
          coordinator: noopCoordinator,
        },
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "CUSTOMER_REQUIRED",
    } satisfies Partial<CustomerOnboardingWorkflowError>);
    expect(repository.createdCases).toEqual([]);
  });
});

function successfulTaskAdapter(externalTaskId: string) {
  return {
    createTask: vi.fn(async (input) => ({
      ok: true as const,
      value: {
        externalTaskId,
        externalTaskUrl: `https://tasks.example/${externalTaskId}`,
        title: input.title,
        status: "todo" as const,
        blocked: false,
        syncStatus: "synced" as const,
        assignee: null,
        dueAt: null,
        idempotent: false,
        needsTriage: false,
        raw: {},
      },
    })),
  };
}

function makeRepository(
  options: {
    space?: CustomerOnboardingWorkflowSpace;
    existingThread?: Awaited<
      ReturnType<CustomerOnboardingWorkflowRepository["findExistingThread"]>
    >;
  } = {},
) {
  const repository = {
    createdCases: [] as Parameters<
      CustomerOnboardingWorkflowRepository["createCase"]
    >[0][],
    linkedTasks: [] as Parameters<
      CustomerOnboardingWorkflowRepository["createLinkedTask"]
    >[0][],
    async findSpace() {
      return options.space ?? baseSpace;
    },
    async findExistingThread() {
      return options.existingThread ?? null;
    },
    async createCase(input) {
      repository.createdCases.push(input);
      return {
        id: "thread-1",
        tenantId: input.tenantId,
        spaceId: input.space.id,
        title: input.title,
        identifier: input.channel === "webhook" ? "HOOK-42" : "TICK-42",
        metadata: input.metadata,
      };
    },
    async createLinkedTask(input) {
      repository.linkedTasks.push(input);
    },
  } satisfies CustomerOnboardingWorkflowRepository & {
    createdCases: Parameters<
      CustomerOnboardingWorkflowRepository["createCase"]
    >[0][];
    linkedTasks: Parameters<
      CustomerOnboardingWorkflowRepository["createLinkedTask"]
    >[0][];
  };
  return repository;
}
