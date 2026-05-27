import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockCallerVisibleThreadPredicate,
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
      folder_s3_prefix: column("goals.folder_s3_prefix"),
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
      __table__: "threads",
    },
  };
  const captures = {
    rows: [] as Record<string, unknown>[],
    whereConditions: [] as unknown[],
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            captures.whereConditions.push(condition);
            return {
              limit: vi.fn(async () => captures.rows),
            };
          }),
        })),
      })),
    })),
  };
  return {
    captures,
    mockDb: db,
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-1" as string | null),
    mockCallerVisibleThreadPredicate: vi.fn(() => ({ visible: true })),
    tables,
  };
});

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  goals: tables.goals,
  threads: tables.threads,
  snakeToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (value instanceof Date) result[camelKey] = value.toISOString();
      else if (typeof value === "object" && value !== null)
        result[camelKey] = JSON.stringify(value);
      else result[camelKey] = value;
    }
    return result;
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: mockCallerVisibleThreadPredicate,
}));

import { threadGoal } from "./threadGoal.query.js";

const cognitoCtx = {
  auth: {
    authType: "cognito",
  },
} as any;

beforeEach(() => {
  captures.rows.length = 0;
  captures.whereConditions.length = 0;
  mockDb.select.mockClear();
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockCallerVisibleThreadPredicate.mockClear();
});

describe("threadGoal", () => {
  it("returns the visible Thread's Goal with joined agent and requester identity", async () => {
    captures.rows.push({
      id: "goal-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      thread_id: "thread-1",
      agent_id: "agent-1",
      user_id: "user-1",
      template_key: "customer-onboarding",
      outcome: "Onboard Acme",
      owner_type: "user",
      owner_id: "user-1",
      mode: "delegate",
      status: "in_review",
      progress_model: "linked_tasks",
      completion_rule: { requiredTasks: "all" },
      review_policy: { required: true },
      folder_s3_prefix: "tenants/acme/threads/thread-1/",
      reviewer_type: "user",
      reviewer_id: "reviewer-1",
      started_at: new Date("2026-05-27T12:00:00.000Z"),
      reviewed_at: null,
      completed_at: null,
      cancelled_at: null,
      metadata: { source: "test" },
      created_at: new Date("2026-05-27T12:00:00.000Z"),
      updated_at: new Date("2026-05-27T12:01:00.000Z"),
    });

    await expect(
      threadGoal(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        cognitoCtx,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "goal-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        agentId: "agent-1",
        userId: "user-1",
        outcome: "Onboard Acme",
        mode: "DELEGATE",
        status: "IN_REVIEW",
        completionRule: JSON.stringify({ requiredTasks: "all" }),
        reviewPolicy: JSON.stringify({ required: true }),
      }),
    );
    expect(mockCallerVisibleThreadPredicate).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
    );
  });

  it("returns null for ordinary visible Threads without a Goal row", async () => {
    await expect(
      threadGoal(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        cognitoCtx,
      ),
    ).resolves.toBeNull();
  });

  it("returns null when the Cognito caller resolves to another tenant", async () => {
    mockResolveCallerTenantId.mockResolvedValue("tenant-2");

    await expect(
      threadGoal(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        cognitoCtx,
      ),
    ).resolves.toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns null for service callers because threadGoal is a user-visible API", async () => {
    await expect(
      threadGoal(null, { tenantId: "tenant-1", threadId: "thread-1" }, {
        auth: { authType: "service", tenantId: "tenant-1" },
      } as any),
    ).resolves.toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns null for apikey callers because threadGoal is a user-visible API", async () => {
    await expect(
      threadGoal(null, { tenantId: "tenant-1", threadId: "thread-1" }, {
        auth: { authType: "apikey", tenantId: "tenant-1" },
      } as any),
    ).resolves.toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does not fall back to Space membership when Thread visibility filters out the row", async () => {
    mockCallerVisibleThreadPredicate.mockReturnValue({ visible: false });

    await expect(
      threadGoal(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        cognitoCtx,
      ),
    ).resolves.toBeNull();
    expect(captures.whereConditions).toHaveLength(1);
  });
});
