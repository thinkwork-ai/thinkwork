import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  tables,
  updatedParticipantValues,
  updatedThreadValues,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockNotifyThreadUpdate,
  state,
} = vi.hoisted(() => {
  const tableCol = (label: string) => ({ __col: label });
  const tableObjects = {
    threads: {
      __table__: "threads",
      id: tableCol("threads.id"),
      tenant_id: tableCol("threads.tenant_id"),
      user_id: tableCol("threads.user_id"),
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
  };
  const mutableState = {
    threadRow: {
      id: "thread-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      title: "Thread",
      status: "in_progress",
      channel: "chat",
      last_read_at: new Date("2026-05-18T12:00:00.000Z"),
    },
    participantRows: [{ id: "participant-1" }],
    userParticipantCount: 1,
  };
  const participantUpdates: Record<string, unknown>[] = [];
  const threadUpdates: Record<string, unknown>[] = [];

  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(async () => {
          if (table === tableObjects.threads) return [mutableState.threadRow];
          if (table === tableObjects.threadParticipants) {
            if (selection && "count" in selection) {
              return [{ count: mutableState.userParticipantCount }];
            }
            return mutableState.participantRows;
          }
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
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-1" as string | null),
    mockNotifyThreadUpdate: vi.fn(async () => undefined),
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

import { updateThread } from "./updateThread.mutation.js";

beforeEach(() => {
  updatedParticipantValues.length = 0;
  updatedThreadValues.length = 0;
  state.threadRow = {
    id: "thread-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    title: "Thread",
    status: "in_progress",
    channel: "chat",
    last_read_at: new Date("2026-05-18T12:00:00.000Z"),
  };
  state.participantRows = [{ id: "participant-1" }];
  state.userParticipantCount = 1;
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockNotifyThreadUpdate.mockClear();
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

  it("rejects read-state updates from non-participant Cognito callers", async () => {
    state.participantRows = [];
    state.userParticipantCount = 1;
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
});
