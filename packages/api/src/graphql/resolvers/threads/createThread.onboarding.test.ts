import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantMember,
  mockResolveCallerFromAuth,
  mockCanPostToSpace,
  mockStartCustomerOnboardingWorkflow,
  mockSelect,
} = vi.hoisted(() => ({
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerFromAuth: vi.fn(),
  mockCanPostToSpace: vi.fn(),
  mockStartCustomerOnboardingWorkflow: vi.fn(),
  mockSelect: vi.fn(),
}));

class MockCustomerOnboardingWorkflowError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  sql: vi.fn(),
  agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
  tenants: { id: "tenants.id", issue_counter: "tenants.issue_counter" },
  threads: {
    id: "threads.id",
    tenant_id: "threads.tenant_id",
    space_id: "threads.space_id",
    status: "threads.status",
    title: "threads.title",
  },
  messages: { id: "messages.id" },
  messageMentions: {},
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    name: "spaces.name",
    status: "spaces.status",
    kind: "spaces.kind",
    template_key: "spaces.template_key",
    config: "spaces.config",
  },
  threadParticipants: {},
  threadToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    title: row.title,
    status: String(row.status).toUpperCase(),
  }),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mockResolveCallerFromAuth,
}));

vi.mock("../../../lib/spaces/default-space.js", () => ({
  ensureDefaultThreadSpace: vi.fn(),
}));

vi.mock("../../../lib/mentions/dispatch-agent-mentions.js", () => ({
  dispatchAgentMentions: vi.fn(),
}));

vi.mock("../../../lib/mentions/default-agent-routing.js", () => ({
  dispatchDefaultAgentChatTurn: vi.fn(),
}));

vi.mock("../../../lib/mentions/parse-message-mentions.js", () => ({
  parseMessageMentions: vi.fn(() => []),
}));

vi.mock("../../../lib/mentions/thread-participant-mentions.js", () => ({
  insertMentionParticipants: vi.fn(),
  toThreadParticipantInsert: vi.fn((row) => row),
}));

vi.mock("../../../lib/mentions/thread-mention-targets.js", () => ({
  loadThreadMentionTargets: vi.fn(async () => []),
}));

vi.mock("../spaces/shared.js", () => ({
  canPostToSpace: mockCanPostToSpace,
}));

vi.mock("../../../lib/agents/tenant-platform-agent.js", () => ({
  PlatformAgentNotFoundError: class PlatformAgentNotFoundError extends Error {},
  resolveTenantPlatformAgent: vi.fn(),
}));

vi.mock("../../../lib/spaces/customer-onboarding-workflow.js", () => ({
  CUSTOMER_ONBOARDING_TEMPLATE_KEY: "customer_onboarding",
  CustomerOnboardingWorkflowError: MockCustomerOnboardingWorkflowError,
  startCustomerOnboardingWorkflow: mockStartCustomerOnboardingWorkflow,
}));

const { createThread } = await import("./createThread.mutation.js");

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  mockRequireTenantMember.mockReset();
  mockResolveCallerFromAuth.mockReset();
  mockResolveCallerFromAuth.mockResolvedValue({ userId: "user-1" });
  mockCanPostToSpace.mockReset();
  mockCanPostToSpace.mockResolvedValue(true);
  mockStartCustomerOnboardingWorkflow.mockReset();
  mockStartCustomerOnboardingWorkflow.mockResolvedValue({
    thread: { id: "thread-1" },
    idempotent: false,
    linkedTasks: [],
    missingFields: ["taxExempt", "creditTermsRequested"],
  });
  mockSelect.mockReset();
  mockSelect
    .mockReturnValueOnce({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "space-1",
              tenant_id: "tenant-1",
              name: "Customer Onboarding",
              status: "active",
              kind: "customer_onboarding",
              template_key: "customer_onboarding",
              config: { workflow: "customer_onboarding" },
            },
          ]),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "thread-1",
              tenant_id: "tenant-1",
              space_id: "space-1",
              title: "Aldape auto center onboarding",
              status: "backlog",
            },
          ]),
      }),
    });
});

describe("createThread Customer Onboarding trigger", () => {
  it("routes new Customer Onboarding space threads through the native workflow", async () => {
    const result = await createThread(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          title: "Aldape auto center onboarding",
          channel: "CHAT",
          firstMessage:
            "Start onboarding Aldape auto center. Need to know tax exempt and credit terms.",
        },
      },
      ctx,
    );

    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockCanPostToSpace).toHaveBeenCalledWith(ctx, "tenant-1", "space-1");
    expect(mockStartCustomerOnboardingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        source: "manual",
        startedBy: { type: "user", id: "user-1" },
        opportunity: expect.objectContaining({
          event: "thread_created",
          customerName: "Aldape auto center",
          companyName: "Aldape auto center",
          notes:
            "Start onboarding Aldape auto center. Need to know tax exempt and credit terms.",
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "thread-1",
      spaceId: "space-1",
      status: "BACKLOG",
    });
  });

  it("passes structured customer onboarding metadata through when supplied", async () => {
    await createThread(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          title: "Manual onboarding",
          metadata: JSON.stringify({
            customerOnboarding: {
              opportunityId: "opp-42",
              customerName: "Border Tire",
              taxExempt: true,
              creditTermsRequested: false,
            },
          }),
        },
      },
      ctx,
    );

    expect(mockStartCustomerOnboardingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunity: expect.objectContaining({
          opportunityId: "opp-42",
          customerName: "Border Tire",
          companyName: "Border Tire",
          taxExempt: true,
          creditTermsRequested: false,
        }),
      }),
    );
  });
});
