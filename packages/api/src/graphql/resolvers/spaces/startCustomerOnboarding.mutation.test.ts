import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantMember,
  mockHasSpaceMemberAccess,
  mockResolveCallerFromAuth,
  mockStartCustomerOnboardingWorkflow,
  mockSelect,
} = vi.hoisted(() => ({
  mockRequireTenantMember: vi.fn(),
  mockHasSpaceMemberAccess: vi.fn(),
  mockResolveCallerFromAuth: vi.fn(),
  mockStartCustomerOnboardingWorkflow: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    template_key: "spaces.template_key",
    status: "spaces.status",
  },
  threads: { id: "threads.id" },
  threadToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    title: row.title,
    identifier: row.identifier,
    status: String(row.status).toUpperCase(),
    channel: String(row.channel).toUpperCase(),
  }),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mockResolveCallerFromAuth,
}));

vi.mock("./shared.js", () => ({
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
}));

vi.mock("../../../lib/spaces/customer-onboarding-workflow.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/spaces/customer-onboarding-workflow.js")
  >("../../../lib/spaces/customer-onboarding-workflow.js");
  return {
    ...actual,
    startCustomerOnboardingWorkflow: mockStartCustomerOnboardingWorkflow,
  };
});

const { startCustomerOnboarding } = await import(
  "./startCustomerOnboarding.mutation.js"
);

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  mockRequireTenantMember.mockReset();
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockResolveCallerFromAuth.mockReset();
  mockResolveCallerFromAuth.mockResolvedValue({ userId: "user-1" });
  mockStartCustomerOnboardingWorkflow.mockReset();
  mockStartCustomerOnboardingWorkflow.mockResolvedValue({
    thread: {
      id: "thread-1",
      tenantId: "tenant-1",
      spaceId: "space-1",
      title: "Acme onboarding",
      identifier: "TICK-42",
      metadata: null,
    },
    idempotent: false,
    linkedTasks: [{ checklistItemId: "item-1", externalTaskId: "LM-1" }],
    missingFields: ["documents"],
  });
  mockSelect.mockReset();
  mockSelect.mockReturnValue({
    from: () => ({
      where: () =>
        Promise.resolve([
          {
            id: "thread-1",
            tenant_id: "tenant-1",
            space_id: "space-1",
            title: "Acme onboarding",
            identifier: "TICK-42",
            status: "backlog",
            channel: "manual",
          },
        ]),
    }),
  });
});

describe("startCustomerOnboarding mutation", () => {
  it("requires tenant and Space access before starting the shared workflow", async () => {
    const result = await startCustomerOnboarding(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          opportunity: JSON.stringify({
            opportunityId: "opp-1",
            customerName: "Acme",
          }),
        },
      },
      ctx,
    );

    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-1",
    );
    expect(mockStartCustomerOnboardingWorkflow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      spaceId: "space-1",
      source: "manual",
      opportunity: { opportunityId: "opp-1", customerName: "Acme" },
      startedBy: { type: "user", id: "user-1" },
    });
    expect(result).toMatchObject({
      threadId: "thread-1",
      idempotent: false,
      missingFields: ["documents"],
      thread: {
        id: "thread-1",
        channel: "MANUAL",
      },
    });
  });

  it("fails closed when the caller is not a Space member", async () => {
    mockHasSpaceMemberAccess.mockResolvedValueOnce(false);

    await expect(
      startCustomerOnboarding(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            opportunity: { opportunityId: "opp-1", customerName: "Acme" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Space membership required");
    expect(mockStartCustomerOnboardingWorkflow).not.toHaveBeenCalled();
  });

  it("checks membership on the default Customer Onboarding Space when spaceId is omitted", async () => {
    mockSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "space-default" }]),
        }),
      }),
    });

    await startCustomerOnboarding(
      null,
      {
        input: {
          tenantId: "tenant-1",
          opportunity: { opportunityId: "opp-1", customerName: "Acme" },
        },
      },
      ctx,
    );

    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-default",
    );
    expect(mockStartCustomerOnboardingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-default" }),
    );
  });

  it("fails closed when the caller is not a member of the default Customer Onboarding Space", async () => {
    mockHasSpaceMemberAccess.mockResolvedValueOnce(false);
    mockSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "space-default" }]),
        }),
      }),
    });

    await expect(
      startCustomerOnboarding(
        null,
        {
          input: {
            tenantId: "tenant-1",
            opportunity: { opportunityId: "opp-1", customerName: "Acme" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Space membership required");
    expect(mockStartCustomerOnboardingWorkflow).not.toHaveBeenCalled();
  });
});
