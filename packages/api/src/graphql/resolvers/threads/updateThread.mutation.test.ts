import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  tables,
  updatedParticipantValues,
  updatedThreadValues,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockNotifyThreadUpdate,
  mockRefreshGoalFolder,
  state,
  updatedGoalValues,
} = vi.hoisted(() => {
  const tableCol = (label: string) => ({ __col: label });
  const tableObjects = {
    threads: {
      __table__: "threads",
      id: tableCol("threads.id"),
      tenant_id: tableCol("threads.tenant_id"),
      user_id: tableCol("threads.user_id"),
      space_id: tableCol("threads.space_id"),
      last_read_at: tableCol("threads.last_read_at"),
      status: tableCol("threads.status"),
    },
    threadParticipants: {
      __table__: "thread_participants",
      id: tableCol("thread_participants.id"),
      tenant_id: tableCol("thread_participants.tenant_id"),
      thread_id: tableCol("thread_participants.thread_id"),
      participant_type: tableCol("thread_participants.participant_type"),
      user_id: tableCol("thread_participants.user_id"),
      last_read_at: tableCol("thread_participants.last_read_at"),
      updated_at: tableCol("thread_participants.updated_at"),
    },
    goals: {
      __table__: "goals",
      id: tableCol("goals.id"),
      tenant_id: tableCol("goals.tenant_id"),
      thread_id: tableCol("goals.thread_id"),
      status: tableCol("goals.status"),
      review_policy: tableCol("goals.review_policy"),
    },
  };
  const mutableState = {
    threadRow: {
      id: "thread-1",
      tenant_id: "tenant-1",
      user_id: "user-1" as string | null,
      space_id: null as string | null,
      title: "Thread",
      status: "in_progress",
      channel: "chat",
      last_read_at: new Date("2026-05-18T12:00:00.000Z"),
    },
    participantRows: [{ id: "participant-1" }],
    userParticipantCount: 1,
    visibleThreadRows: [] as Record<string, unknown>[],
    goalRows: [] as Record<string, unknown>[],
  };
  const participantUpdates: Record<string, unknown>[] = [];
  const threadUpdates: Record<string, unknown>[] = [];
  const goalUpdates: Record<string, unknown>[] = [];

  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(async () => {
          if (table === tableObjects.threads) {
            if (
              selection &&
              Object.keys(selection).length === 1 &&
              "id" in selection
            ) {
              return mutableState.visibleThreadRows;
            }
            return [mutableState.threadRow];
          }
          if (table === tableObjects.threadParticipants) {
            if (selection && "count" in selection) {
              return [{ count: mutableState.userParticipantCount }];
            }
            return mutableState.participantRows;
          }
          if (table === tableObjects.goals) return mutableState.goalRows;
          return [];
        }),
      })),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          if (table === tableObjects.threadParticipants) {
            participantUpdates.push(values);
            return Promise.resolve([]);
          }
          if (table === tableObjects.goals) {
            goalUpdates.push(values);
            return Promise.resolve([]);
          }
          threadUpdates.push(values);
          return {
            returning: vi.fn(async () => [
              { ...mutableState.threadRow, ...values },
            ]),
          };
        }),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
  };

  return {
    mockDb: db,
    tables: tableObjects,
    updatedParticipantValues: participantUpdates,
    updatedThreadValues: threadUpdates,
    updatedGoalValues: goalUpdates,
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-1" as string | null),
    mockNotifyThreadUpdate: vi.fn(async () => undefined),
    mockRefreshGoalFolder: vi.fn(async () => null),
    state: mutableState,
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  and: vi.fn((...conditions: unknown[]) => ({ __and: conditions })),
  sql: vi.fn(() => ({ __sql: true })),
  threads: tables.threads,
  threadParticipants: tables.threadParticipants,
  goals: tables.goals,
  agentWakeupRequests: { __table__: "agent_wakeup_requests" },
  inboxItems: { __table__: "inbox_items" },
  threadToCamel: (row: Record<string, unknown>) => ({
    ...row,
    lastReadAt:
      row.last_read_at instanceof Date
        ? row.last_read_at.toISOString()
        : row.last_read_at,
  }),
  assertTransition: vi.fn(),
  checkAndFireUnblockWakeups: vi.fn(),
}));

vi.mock("../../notify.js", () => ({
  notifyThreadUpdate: mockNotifyThreadUpdate,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/spaces/customer-onboarding-goal-md.js", () => ({
  refreshCustomerOnboardingGoalFolderSafely: mockRefreshGoalFolder,
}));

const mockCancelPendingQuestions = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../../lib/user-questions/consume.js", () => ({
  cancelPendingQuestions: mockCancelPendingQuestions,
}));

import { updateThread } from "./updateThread.mutation.js";

beforeEach(() => {
  updatedParticipantValues.length = 0;
  updatedThreadValues.length = 0;
  updatedGoalValues.length = 0;
  state.threadRow = {
    id: "thread-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    space_id: null,
    title: "Thread",
    status: "in_progress",
    channel: "chat",
    last_read_at: new Date("2026-05-18T12:00:00.000Z"),
  };
  state.participantRows = [{ id: "participant-1" }];
  state.userParticipantCount = 1;
  state.visibleThreadRows = [];
  state.goalRows = [];
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockNotifyThreadUpdate.mockClear();
  mockRefreshGoalFolder.mockReset();
  mockRefreshGoalFolder.mockResolvedValue(null);
  mockCancelPendingQuestions.mockClear();
});

describe("updateThread participant-scoped read state", () => {
  it("updates the caller's participant row instead of legacy thread read state", async () => {
    const result = await updateThread(
      {},
      {
        id: "thread-1",
        input: { lastReadAt: "2026-05-19T12:00:00.000Z" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedParticipantValues).toHaveLength(1);
    expect(updatedParticipantValues[0]?.last_read_at).toEqual(
      new Date("2026-05-19T12:00:00.000Z"),
    );
    expect(updatedThreadValues).toHaveLength(0);
    expect(result).toMatchObject({ lastReadAt: "2026-05-19T12:00:00.000Z" });
    expect(mockNotifyThreadUpdate).not.toHaveBeenCalled();
  });

  it("falls back to legacy thread read state when no user participants exist", async () => {
    state.participantRows = [];
    state.userParticipantCount = 0;

    const result = await updateThread(
      {},
      {
        id: "thread-1",
        input: { lastReadAt: "2026-05-19T12:00:00.000Z" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedParticipantValues).toHaveLength(0);
    expect(updatedThreadValues).toHaveLength(1);
    expect(updatedThreadValues[0]?.last_read_at).toEqual(
      new Date("2026-05-19T12:00:00.000Z"),
    );
    expect(result).toMatchObject({ lastReadAt: "2026-05-19T12:00:00.000Z" });
  });

  it("skips read-state (no throw, no write) when the caller identity is unresolved", async () => {
    // A Google-federated session whose token lost its email claim resolves to a
    // null user id. Mark-read is best-effort — it must NOT surface a blocking
    // "Requester user identity required" error in the sidebar.
    mockResolveCallerUserId.mockResolvedValue(null);

    const result = await updateThread(
      {},
      {
        id: "thread-1",
        input: { lastReadAt: "2026-05-19T12:00:00.000Z" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedParticipantValues).toHaveLength(0);
    expect(updatedThreadValues).toHaveLength(0); // no legacy thread-level write either
    expect(result).toBeTruthy(); // returns the thread, unchanged read state
  });

  it("rejects read-state updates from non-participant Cognito callers", async () => {
    state.participantRows = [];
    state.userParticipantCount = 1;
    state.threadRow.space_id = null;
    mockResolveCallerUserId.mockResolvedValue("user-2");

    await expect(
      updateThread(
        {},
        {
          id: "thread-1",
          input: { lastReadAt: "2026-05-19T12:00:00.000Z" },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Thread participant required");

    expect(updatedParticipantValues).toHaveLength(0);
    expect(updatedThreadValues).toHaveLength(0);
  });

  it("skips read-state without throwing for visible Space threads with no participant row", async () => {
    state.threadRow.space_id = "space-1";
    state.threadRow.user_id = null;
    state.participantRows = [];
    state.userParticipantCount = 0;
    state.visibleThreadRows = [{ id: "thread-1" }];
    mockResolveCallerUserId.mockResolvedValue("user-2");

    const result = await updateThread(
      {},
      {
        id: "thread-1",
        input: { lastReadAt: "2026-05-19T12:00:00.000Z" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedParticipantValues).toHaveLength(0);
    expect(updatedThreadValues).toHaveLength(0);
    expect(result).toBeTruthy();
  });

  it("routes done transitions for reviewed Goals through the Goal review policy", async () => {
    state.goalRows = [
      {
        id: "goal-1",
        status: "active",
        review_policy: { required: true, type: "human_final_review" },
      },
    ];

    await expect(
      updateThread(
        {},
        {
          id: "thread-1",
          input: { status: "DONE" },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Goal requires human final review");

    expect(updatedThreadValues).toHaveLength(0);
    expect(updatedGoalValues).toEqual([
      expect.objectContaining({ status: "in_review" }),
    ]);
    expect(mockRefreshGoalFolder).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
    });
  });
});

describe("updateThread pending-question cancel hygiene (plan 2026-06-09-005 U3)", () => {
  it("cancels pending questions when the thread is archived", async () => {
    await updateThread(
      {},
      {
        id: "thread-1",
        input: { archivedAt: "2026-06-10T12:00:00.000Z" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mockCancelPendingQuestions).toHaveBeenCalledTimes(1);
    expect(mockCancelPendingQuestions).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread-1",
    });
  });

  it("does not cancel pending questions on unarchive (archivedAt: null) or unrelated updates", async () => {
    await updateThread({}, { id: "thread-1", input: { archivedAt: null } }, {
      auth: { authType: "cognito" },
    } as any);
    await updateThread({}, { id: "thread-1", input: { title: "Renamed" } }, {
      auth: { authType: "cognito" },
    } as any);
    expect(mockCancelPendingQuestions).not.toHaveBeenCalled();
  });
});
