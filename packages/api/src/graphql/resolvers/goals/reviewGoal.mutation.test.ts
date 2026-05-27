import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockRefreshGoalFolder,
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  tables,
} = vi.hoisted(() => {
  const column = (label: string) => ({ __column__: label });
  const tables = {
    goals: {
      id: column("goals.id"),
      tenant_id: column("goals.tenant_id"),
      space_id: column("goals.space_id"),
      thread_id: column("goals.thread_id"),
      template_key: column("goals.template_key"),
      outcome: column("goals.outcome"),
      owner_type: column("goals.owner_type"),
      owner_id: column("goals.owner_id"),
      mode: column("goals.mode"),
      status: column("goals.status"),
      progress_model: column("goals.progress_model"),
      completion_rule: column("goals.completion_rule"),
      review_policy: column("goals.review_policy"),
      reviewer_type: column("goals.reviewer_type"),
      reviewer_id: column("goals.reviewer_id"),
      started_at: column("goals.started_at"),
      reviewed_at: column("goals.reviewed_at"),
      completed_at: column("goals.completed_at"),
      cancelled_at: column("goals.cancelled_at"),
      metadata: column("goals.metadata"),
      created_at: column("goals.created_at"),
      updated_at: column("goals.updated_at"),
      __table__: "goals",
    },
    threads: {
      id: column("threads.id"),
      tenant_id: column("threads.tenant_id"),
      agent_id: column("threads.agent_id"),
      user_id: column("threads.user_id"),
      status: column("threads.status"),
      started_at: column("threads.started_at"),
      __table__: "threads",
    },
    spaceMembers: {
      tenant_id: column("space_members.tenant_id"),
      space_id: column("space_members.space_id"),
      user_id: column("space_members.user_id"),
      role: column("space_members.role"),
      __table__: "spaceMembers",
    },
  };
  const captures = {
    goalRows: [] as Record<string, any>[],
    spaceMemberRows: [] as Record<string, any>[],
    goalUpdates: [] as Record<string, any>[],
    threadUpdates: [] as Record<string, any>[],
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        if (table === tables.goals) {
          return {
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(async () => captures.goalRows),
              })),
            })),
          };
        }
        if (table === tables.spaceMembers) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => captures.spaceMemberRows),
            })),
          };
        }
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        };
      }),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (table === tables.goals) {
              captures.goalUpdates.push(values);
              return [{ ...captures.goalRows[0], ...values }];
            }
            captures.threadUpdates.push(values);
            return [
              {
                id: captures.goalRows[0]?.thread_id ?? "thread-1",
                tenant_id: captures.goalRows[0]?.tenant_id ?? "tenant-1",
                title: "Thread",
                channel: "manual",
                ...values,
              },
            ];
          }),
        })),
      })),
    })),
  };
  return {
    captures,
    mockDb: db,
    mockRefreshGoalFolder: vi.fn(async () => null),
    mockRequireTenantAdmin: vi.fn(async () => "admin"),
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-1" as string | null),
    tables,
  };
});

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  goals: tables.goals,
  spaceMembers: tables.spaceMembers,
  threads: tables.threads,
  threadToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] =
        value instanceof Date ? value.toISOString() : value;
    }
    if (typeof result.status === "string") {
      result.status = result.status.toUpperCase();
    }
    return result;
  },
  snakeToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (value instanceof Date) result[camel] = value.toISOString();
      else if (value && typeof value === "object")
        result[camel] = JSON.stringify(value);
      else result[camel] = value;
    }
    return result;
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/spaces/customer-onboarding-goal-md.js", () => ({
  refreshCustomerOnboardingGoalFolderSafely: mockRefreshGoalFolder,
}));

import { reviewGoal } from "./reviewGoal.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  captures.goalRows.length = 0;
  captures.spaceMemberRows.length = 0;
  captures.goalUpdates.length = 0;
  captures.threadUpdates.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockRefreshGoalFolder.mockReset();
  mockRefreshGoalFolder.mockResolvedValue(null);
  mockRequireTenantAdmin.mockReset();
  mockRequireTenantAdmin.mockResolvedValue("admin");
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
});

describe("reviewGoal", () => {
  it("confirms an in-review Goal and marks the Thread done", async () => {
    captures.goalRows.push(goalRow({ owner_id: "user-1" }));

    const result = await reviewGoal(
      null,
      {
        input: {
          tenantId: "tenant-1",
          goalId: "goal-1",
          action: "CONFIRM_COMPLETION",
          notes: "Looks complete.",
        },
      },
      ctx,
    );

    expect(captures.goalUpdates[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        reviewer_type: "user",
        reviewer_id: "user-1",
        completed_at: expect.any(Date),
      }),
    );
    expect(captures.goalUpdates[0]?.metadata).toMatchObject({
      review: {
        action: "CONFIRM_COMPLETION",
        notes: "Looks complete.",
        reviewedByUserId: "user-1",
      },
    });
    expect(captures.threadUpdates[0]).toEqual(
      expect.objectContaining({
        status: "done",
        completed_at: expect.any(Date),
        cancelled_at: null,
        closed_at: expect.any(Date),
      }),
    );
    expect(mockRefreshGoalFolder).toHaveBeenCalledWith(
      { tenantId: "tenant-1", threadId: "thread-1" },
      { goalStatus: "completed" },
    );
    expect(result.goal).toMatchObject({ id: "goal-1", status: "COMPLETED" });
    expect(result.thread).toMatchObject({ id: "thread-1", status: "DONE" });
  });

  it("requests changes and keeps the Thread in progress", async () => {
    captures.goalRows.push(
      goalRow({
        owner_id: "someone-else",
        reviewer_id: "user-1",
        metadata: { existing: true },
      }),
    );

    const result = await reviewGoal(
      null,
      {
        input: {
          tenantId: "tenant-1",
          goalId: "goal-1",
          action: "REQUEST_CHANGES",
          notes: "Need AP email.",
        },
      },
      ctx,
    );

    expect(captures.goalUpdates[0]).toEqual(
      expect.objectContaining({
        status: "active",
        completed_at: null,
        cancelled_at: null,
      }),
    );
    expect(captures.goalUpdates[0]?.metadata).toMatchObject({
      existing: true,
      review: {
        action: "REQUEST_CHANGES",
        notes: "Need AP email.",
      },
    });
    expect(captures.threadUpdates[0]).toEqual(
      expect.objectContaining({
        status: "in_progress",
        completed_at: null,
        cancelled_at: null,
        closed_at: null,
      }),
    );
    expect(mockRefreshGoalFolder).toHaveBeenCalledWith(
      { tenantId: "tenant-1", threadId: "thread-1" },
      { goalStatus: "active" },
    );
    expect(result.goal).toMatchObject({ status: "ACTIVE" });
  });

  it("lets Space owners or admins review even when they are not named reviewer", async () => {
    captures.goalRows.push(goalRow({ owner_id: "someone-else" }));
    captures.spaceMemberRows.push({ role: "admin" });
    mockRequireTenantAdmin.mockRejectedValue(new Error("not tenant admin"));

    await reviewGoal(
      null,
      {
        input: {
          tenantId: "tenant-1",
          goalId: "goal-1",
          action: "CONFIRM_COMPLETION",
        },
      },
      ctx,
    );

    expect(captures.goalUpdates[0]?.status).toBe("completed");
  });

  it("rejects unauthorized reviewers without mutating state", async () => {
    captures.goalRows.push(goalRow({ owner_id: "someone-else" }));
    mockRequireTenantAdmin.mockRejectedValue(new Error("not tenant admin"));

    await expect(
      reviewGoal(
        null,
        {
          input: {
            tenantId: "tenant-1",
            goalId: "goal-1",
            action: "CONFIRM_COMPLETION",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Not authorized");

    expect(captures.goalUpdates).toEqual([]);
    expect(captures.threadUpdates).toEqual([]);
    expect(mockRefreshGoalFolder).not.toHaveBeenCalled();
  });
});

function goalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal-1",
    tenant_id: "tenant-1",
    space_id: "space-1",
    thread_id: "thread-1",
    agent_id: "agent-1",
    user_id: "user-1",
    template_key: "customer_onboarding",
    outcome: "Complete onboarding.",
    owner_type: "user",
    owner_id: "user-1",
    mode: "collaborate",
    status: "in_review",
    progress_model: "linked_tasks",
    completion_rule: { type: "all_required" },
    review_policy: { required: true },
    reviewer_type: null,
    reviewer_id: null,
    started_at: new Date("2026-05-27T12:00:00.000Z"),
    reviewed_at: null,
    completed_at: null,
    cancelled_at: null,
    metadata: {},
    created_at: new Date("2026-05-27T12:00:00.000Z"),
    updated_at: new Date("2026-05-27T12:00:00.000Z"),
    thread_status: "in_review",
    thread_started_at: new Date("2026-05-27T12:00:00.000Z"),
    ...overrides,
  };
}
