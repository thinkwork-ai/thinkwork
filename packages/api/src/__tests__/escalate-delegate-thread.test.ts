/**
 * Contract tests for U2 of the thread-detail cleanup plan: escalateThread
 * and delegateThread mutations. Covers three things:
 *
 *  1. Legacy thread_comments writer was removed — the mutations no longer
 *     touch thread_comments at all. Any insert against thread_comments
 *     during these calls is a regression.
 *  2. thread_turns writer replaces it, with kind='system_event' and a
 *     structured payload capturing actor, reason, and assignee transition.
 *  3. requireTenantAdmin is now the security gate. Callers without
 *     owner/admin role on the thread's tenant fail closed before any side
 *     effect. Cross-tenant access (caller admin in tenant A, thread in
 *     tenant B) surfaces as FORBIDDEN because the role lookup finds no
 *     membership row.
 *
 * These are the plan's explicit test scenarios for U2.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockThreadRows,
  mockAgentRows,
  mockAssigneeAgentRows,
  mockMemberRows,
  mockResolveCallerUserId,
  mockUpdateReturning,
  capturedInserts,
} = vi.hoisted(() => ({
  mockThreadRows: vi.fn(),
  mockAgentRows: vi.fn(),
  mockAssigneeAgentRows: vi.fn(),
  mockMemberRows: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockUpdateReturning: vi.fn(),
  // threadComments was retired by U2 (escalate/delegate refactored to
  // thread_turns kind=system_event) and the table itself was dropped by
  // U5 (drizzle/0031_thread_cleanup_drops.sql). No regression-guard
  // assertion needed since the table no longer exists.
  capturedInserts: {
    threadTurns: [] as any[],
    agentWakeupRequests: [] as any[],
  },
}));

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  // selectCallCount tracks which select call we are responding to, so delegate
  // can distinguish its two agent lookups (not needed today — we mock agents
  // only for the escalate supervisor lookup and for delegate's assignee check).
  const selectFor = (table: unknown) => {
    if (table === actual.threads) return mockThreadRows();
    if (table === actual.agents) {
      // Order matters: escalateThread queries agents once (supervisor),
      // delegateThread queries agents once (assignee). Use a single mock and
      // override per-test via mockAgentRows / mockAssigneeAgentRows as
      // appropriate. Default: fall through.
      const next = mockAgentRows();
      return next !== undefined ? next : mockAssigneeAgentRows();
    }
    if (table === actual.tenantMembers) return mockMemberRows();
    return [];
  };
  return {
    ...actual,
    db: {
      select: vi.fn((_projection?: unknown) => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(selectFor(table)),
        }),
      })),
      update: vi.fn((_table: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: () => Promise.resolve(mockUpdateReturning()),
          }),
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: (vals: any) => {
          if (table === actual.threadTurns)
            capturedInserts.threadTurns.push(vals);
          else if (table === actual.agentWakeupRequests)
            capturedInserts.agentWakeupRequests.push(vals);
          return Promise.resolve();
        },
      })),
    },
  };
});

vi.mock("../graphql/notify.js", () => ({
  notifyThreadUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
  resolveCallerTenantId: vi.fn(async () => null),
}));

// eslint-disable-next-line import/first
import { escalateThread } from "../graphql/resolvers/threads/escalateThread.mutation.js";
// eslint-disable-next-line import/first
import { delegateThread } from "../graphql/resolvers/threads/delegateThread.mutation.js";

function cognitoCtx(principalId = "admin-1"): any {
  return {
    auth: {
      authType: "cognito",
      principalId,
      tenantId: null,
      email: "caller@example.com",
      agentId: null,
    },
  };
}

function apikeyCtx(): any {
  return {
    auth: {
      authType: "apikey",
      principalId: "admin-1",
      tenantId: "tenant-A",
      agentId: "agent-1",
      email: null,
    },
  };
}

const THREAD_ROW = {
  id: "thread-1",
  tenant_id: "tenant-A",
  title: "Let's talk",
  assignee_id: "agent-original",
};

const SUPERVISOR_AGENT = {
  reports_to: "agent-supervisor",
  name: "Polo",
  tenant_id: "tenant-A",
};

const SUPERVISOR_ROW = {
  tenant_id: "tenant-A",
};

const UPDATED_THREAD = {
  id: "thread-1",
  tenant_id: "tenant-A",
  status: "todo",
  title: "Let's talk",
  assignee_id: "agent-supervisor",
};

function resetAll() {
  mockThreadRows.mockReset();
  mockAgentRows.mockReset();
  mockAssigneeAgentRows.mockReset();
  mockMemberRows.mockReset();
  mockResolveCallerUserId.mockReset();
  mockUpdateReturning.mockReset();
  capturedInserts.threadTurns.length = 0;
  capturedInserts.agentWakeupRequests.length = 0;
}

describe("escalateThread — U2 refactor off thread_comments", () => {
  beforeEach(() => {
    resetAll();
    mockResolveCallerUserId.mockResolvedValue("user-admin-1");
  });

  it("happy path: writes thread_turns system_event, never touches thread_comments", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    mockAgentRows.mockReturnValue([SUPERVISOR_AGENT]);
    mockUpdateReturning.mockReturnValue([UPDATED_THREAD]);

    await escalateThread(
      {},
      {
        input: {
          threadId: "thread-1",
          reason: "needs supervisor",
          agentId: "agent-original",
        },
      },
      cognitoCtx(),
    );

    expect(capturedInserts.threadTurns).toHaveLength(1);
    const turn = capturedInserts.threadTurns[0];
    expect(turn.kind).toBe("system_event");
    expect(turn.status).toBe("succeeded");
    expect(turn.invocation_source).toBe("system");
    expect(turn.thread_id).toBe("thread-1");
    expect(turn.tenant_id).toBe("tenant-A");
    expect(turn.result_json.event).toBe("escalate");
    expect(turn.result_json.reason).toBe("needs supervisor");
    expect(turn.result_json.new_assignee_id).toBe("agent-supervisor");
    // Regression guard: previous_assignee_id must come from the pre-UPDATE
    // threadRow, not the post-UPDATE row (which has assignee_id=supervisorId
    // by construction). An earlier iteration read the post-UPDATE row and
    // produced null here for every escalation.
    expect(turn.result_json.previous_assignee_id).toBe("agent-original");
    expect(capturedInserts.agentWakeupRequests).toHaveLength(1);
  });

  it("self-supervising agent (reports_to === current assignee) → previous_assignee_id is null", async () => {
    const selfSupAgent = {
      reports_to: "agent-original", // reports to themselves
      name: "Solo",
      tenant_id: "tenant-A",
    };
    mockThreadRows.mockReturnValue([THREAD_ROW]); // thread assigned to agent-original
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    mockAgentRows.mockReturnValue([selfSupAgent]);
    mockUpdateReturning.mockReturnValue([
      { ...UPDATED_THREAD, assignee_id: "agent-original" },
    ]);

    await escalateThread(
      {},
      {
        input: { threadId: "thread-1", reason: "x", agentId: "agent-original" },
      },
      cognitoCtx(),
    );

    expect(
      capturedInserts.threadTurns[0].result_json.previous_assignee_id,
    ).toBeNull();
  });

  it("supervisor in different tenant → 'Thread not found' (new supervisor-tenant check, not the input-agent check)", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    // First agents query (the escalating agent): in-tenant, has reports_to.
    // Second agents query (the supervisor tenant check): cross-tenant.
    mockAgentRows
      .mockReturnValueOnce([SUPERVISOR_AGENT])
      .mockReturnValueOnce([{ tenant_id: "tenant-B" }]);

    await expect(
      escalateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            reason: "x",
            agentId: "agent-original",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/Thread not found/);
    expect(capturedInserts.threadTurns).toEqual([]);
    expect(capturedInserts.agentWakeupRequests).toEqual([]);
  });

  it("thread row missing → 'Thread not found' before any side effect", async () => {
    mockThreadRows.mockReturnValue([]);
    await expect(
      escalateThread(
        {},
        {
          input: { threadId: "nope", reason: "x", agentId: "agent-original" },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/Thread not found/);
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("non-admin caller → FORBIDDEN, no writes to threadTurns or threadComments", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "member" }]);

    await expect(
      escalateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            reason: "x",
            agentId: "agent-original",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("cross-tenant caller (no membership row) → FORBIDDEN before supervisor lookup", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([]); // caller has no row on tenant-A

    await expect(
      escalateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            reason: "x",
            agentId: "agent-original",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("apikey caller without a tenant admin membership → FORBIDDEN", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([]);

    await expect(
      escalateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            reason: "x",
            agentId: "agent-original",
          },
        },
        apikeyCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("supervisor agent in different tenant → 'Thread not found' (cross-tenant supervisor isolation)", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    mockAgentRows.mockReturnValue([
      { ...SUPERVISOR_AGENT, tenant_id: "tenant-B" },
    ]);

    await expect(
      escalateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            reason: "x",
            agentId: "agent-original",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/Thread not found/);
    expect(capturedInserts.threadTurns).toEqual([]);
  });
});

describe("delegateThread — U2 refactor off thread_comments", () => {
  beforeEach(() => {
    resetAll();
    mockResolveCallerUserId.mockResolvedValue("user-admin-1");
  });

  it("happy path: writes thread_turns system_event with delegate payload, never touches thread_comments", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "owner" }]);
    // delegateThread queries agents once for the assignee check
    mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
    mockUpdateReturning.mockReturnValue([
      { ...UPDATED_THREAD, assignee_id: "agent-new" },
    ]);

    await delegateThread(
      {},
      {
        input: {
          threadId: "thread-1",
          assigneeId: "agent-new",
          reason: "handing off",
          agentId: "agent-actor",
        },
      },
      cognitoCtx(),
    );

    expect(capturedInserts.threadTurns).toHaveLength(1);
    const turn = capturedInserts.threadTurns[0];
    expect(turn.kind).toBe("system_event");
    expect(turn.result_json).toEqual(
      expect.objectContaining({
        event: "delegate",
        reason: "handing off",
        actor_agent_id: "agent-actor",
        previous_assignee_id: "agent-original",
        new_assignee_id: "agent-new",
      }),
    );
    expect(capturedInserts.agentWakeupRequests).toHaveLength(1);
    expect(capturedInserts.agentWakeupRequests[0].agent_id).toBe("agent-new");
  });

  it("thread row missing → 'Thread not found' before auth or writes", async () => {
    mockThreadRows.mockReturnValue([]);
    await expect(
      delegateThread(
        {},
        {
          input: {
            threadId: "nope",
            assigneeId: "agent-new",
            reason: "x",
            agentId: "agent-actor",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/Thread not found/);
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("non-admin caller → FORBIDDEN, no writes", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "member" }]);

    await expect(
      delegateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            assigneeId: "agent-new",
            reason: "x",
            agentId: "agent-actor",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("assignee in different tenant → 'Thread not found' (cross-tenant handoff blocked)", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    mockAgentRows.mockReturnValue([{ tenant_id: "tenant-B" }]);

    await expect(
      delegateThread(
        {},
        {
          input: {
            threadId: "thread-1",
            assigneeId: "agent-new",
            reason: "x",
            agentId: "agent-actor",
          },
        },
        cognitoCtx(),
      ),
    ).rejects.toThrow(/Thread not found/);
    expect(capturedInserts.threadTurns).toEqual([]);
  });

  it("delegate with no reason → reason is null in result_json", async () => {
    mockThreadRows.mockReturnValue([THREAD_ROW]);
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
    mockUpdateReturning.mockReturnValue([
      { ...UPDATED_THREAD, assignee_id: "agent-new" },
    ]);

    await delegateThread(
      {},
      {
        input: {
          threadId: "thread-1",
          assigneeId: "agent-new",
          agentId: "agent-actor",
        },
      },
      cognitoCtx(),
    );

    expect(capturedInserts.threadTurns[0].result_json.reason).toBeNull();
  });
});
