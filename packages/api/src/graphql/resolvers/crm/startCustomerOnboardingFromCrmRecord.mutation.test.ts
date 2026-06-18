import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantMember,
  mockResolveCallerFromAuth,
  mockHasSpaceMemberAccess,
  mockStartCustomerOnboardingWorkflow,
  selectRows,
  updateRows,
  insertRows,
  mockUpdateSet,
  mockInsertValues,
} = vi.hoisted(() => ({
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerFromAuth: vi.fn(),
  mockHasSpaceMemberAccess: vi.fn(),
  mockStartCustomerOnboardingWorkflow: vi.fn(),
  selectRows: [] as unknown[][],
  updateRows: [] as unknown[][],
  insertRows: [] as unknown[][],
  mockUpdateSet: vi.fn(),
  mockInsertValues: vi.fn(),
}));

function queuedThenable(queue: unknown[][]) {
  const next = () => Promise.resolve(queue.shift() ?? []);
  return {
    limit: next,
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => next().then(resolve, reject),
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => queuedThenable(selectRows),
      }),
    }),
    update: () => ({
      set: (value: unknown) => {
        mockUpdateSet(value);
        return {
          where: () => ({
            returning: async () => updateRows.shift() ?? [],
          }),
        };
      },
    }),
    insert: () => ({
      values: (value: unknown) => {
        mockInsertValues(value);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => insertRows.shift() ?? [],
          }),
        };
      },
    }),
  },
  threadToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    title: row.title,
  }),
  snakeToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camel] = value;
    }
    return result;
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mockResolveCallerFromAuth,
}));

vi.mock("../spaces/shared.js", () => ({
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

const { startTwentyCustomerOnboarding } =
  await import("./startCustomerOnboardingFromCrmRecord.mutation.js");

const ctx = { auth: { authType: "cognito" } } as any;

const baseInput = {
  tenantId: "tenant-1",
  spaceId: "space-1",
  opportunityId: "opp-1",
  opportunityUrl: "https://twenty.example/opportunities/opp-1",
  companyName: "Acme Corp",
};

beforeEach(() => {
  selectRows.length = 0;
  updateRows.length = 0;
  insertRows.length = 0;
  mockRequireTenantMember.mockReset();
  mockResolveCallerFromAuth.mockReset();
  mockResolveCallerFromAuth.mockResolvedValue({ userId: "user-1" });
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockStartCustomerOnboardingWorkflow.mockReset();
  mockStartCustomerOnboardingWorkflow.mockResolvedValue({
    thread: {
      id: "thread-1",
      tenantId: "tenant-1",
      spaceId: "space-1",
      title: "Acme onboarding",
      identifier: "TICK-1",
      metadata: null,
    },
    idempotent: false,
    linkedTasks: [],
    missingFields: ["contractLink"],
  });
  mockUpdateSet.mockReset();
  mockInsertValues.mockReset();
});

describe("startTwentyCustomerOnboarding", () => {
  it("resumes an active CRM work link before requiring fresh Twenty activation", async () => {
    const existingLink = crmLink({
      id: "link-1",
      thread_id: "thread-1",
      goal_id: "goal-1",
      last_writeback_state: "blocked",
    });
    selectRows.push(
      [existingLink],
      [{ id: "install-1" }],
      [{ id: "component-1" }],
      [{ id: "mcp-1" }],
      [],
      [
        {
          id: "thread-1",
          tenant_id: "tenant-1",
          space_id: "space-1",
          title: "Acme",
        },
      ],
    );
    updateRows.push([existingLink]);

    const result = await startTwentyCustomerOnboarding(
      null,
      { input: baseInput },
      ctx,
    );

    expect(mockStartCustomerOnboardingWorkflow).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: "RESUMED",
      threadId: "thread-1",
      goalId: "goal-1",
      pluginActivationRequired: true,
      statusWritebackState: "BLOCKED",
    });
  });

  it("creates onboarding work and a CRM work link for an activated Twenty user", async () => {
    const createdLink = crmLink({ id: "link-2", thread_id: "thread-1" });
    selectRows.push(
      [],
      [{ id: "install-1" }],
      [{ id: "component-1" }],
      [{ id: "mcp-1" }],
      [{ id: "activation-1" }],
      [{ id: "goal-1" }],
      [
        {
          id: "thread-1",
          tenant_id: "tenant-1",
          space_id: "space-1",
          title: "Acme",
        },
      ],
    );
    insertRows.push([createdLink]);

    const result = await startTwentyCustomerOnboarding(
      null,
      { input: baseInput },
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
      opportunity: expect.objectContaining({
        opportunityId: "opp-1",
        customerName: "Acme Corp",
      }),
      startedBy: { type: "user", id: "user-1" },
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twenty",
        object_type: "opportunity",
        object_id: "opp-1",
        workflow_key: "customer_onboarding",
        plugin_install_id: "install-1",
        mcp_server_id: "mcp-1",
        last_writeback_state: "blocked",
      }),
    );
    expect(result).toMatchObject({
      action: "CREATED",
      threadId: "thread-1",
      goalId: "goal-1",
      pluginActivationRequired: false,
      statusWritebackState: "BLOCKED",
    });
  });

  it("requires explicit confirmation for separate outcome keys", async () => {
    await expect(
      startTwentyCustomerOnboarding(
        null,
        { input: { ...baseInput, outcomeKey: "second-onboarding" } },
        ctx,
      ),
    ).rejects.toThrow("Separate onboarding outcome requires confirmation");
    expect(mockStartCustomerOnboardingWorkflow).not.toHaveBeenCalled();
  });

  it("requires current-user Twenty activation before creating new work", async () => {
    selectRows.push(
      [],
      [{ id: "install-1" }],
      [{ id: "component-1" }],
      [{ id: "mcp-1" }],
      [],
    );

    await expect(
      startTwentyCustomerOnboarding(null, { input: baseInput }, ctx),
    ).rejects.toThrow("Twenty plugin activation is required");
    expect(mockStartCustomerOnboardingWorkflow).not.toHaveBeenCalled();
  });
});

function crmLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    tenant_id: "tenant-1",
    provider: "twenty",
    object_type: "opportunity",
    object_id: "opp-1",
    object_url: "https://twenty.example/opportunities/opp-1",
    workflow_key: "customer_onboarding",
    outcome_key: "default",
    space_id: "space-1",
    thread_id: "thread-1",
    goal_id: null,
    requester_user_id: "user-1",
    plugin_install_id: "install-1",
    mcp_server_id: "mcp-1",
    state: "active",
    status_handle_state: "writeback_blocked",
    status_handle_url: "/threads/thread-1",
    status_handle_action: "Open ThinkWork onboarding",
    last_writeback_state: "blocked",
    metadata: {},
    started_at: new Date("2026-06-18T00:00:00Z"),
    created_at: new Date("2026-06-18T00:00:00Z"),
    updated_at: new Date("2026-06-18T00:00:00Z"),
    ...overrides,
  };
}
