import { describe, expect, it, beforeEach, vi } from "vitest";

const {
  mockDb,
  mockEq,
  mockAnd,
  mockInArray,
  mockSql,
  threadParticipantsTable,
  mockRequireThreadPinCaller,
  mockLoadVisibleThreadForPin,
  mockEnsureUserThreadParticipant,
  mockLoadPinnedThread,
  mockLoadPinnedThreads,
  mockNextPinOrder,
  updatedValues,
  mutableState,
} = vi.hoisted(() => {
  const tableCol = (label: string) => ({ __col: label });
  const table = {
    id: tableCol("thread_participants.id"),
    tenant_id: tableCol("thread_participants.tenant_id"),
    thread_id: tableCol("thread_participants.thread_id"),
    participant_type: tableCol("thread_participants.participant_type"),
    user_id: tableCol("thread_participants.user_id"),
    pinned_at: tableCol("thread_participants.pinned_at"),
    pin_order: tableCol("thread_participants.pin_order"),
    updated_at: tableCol("thread_participants.updated_at"),
  };
  const state = {
    selectRows: [{ thread_id: "thread-1" }],
  };
  const updates: Record<string, unknown>[] = [];
  return {
    threadParticipantsTable: table,
    mutableState: state,
    updatedValues: updates,
    mockEq: vi.fn((field: unknown, value: unknown) => ({
      __eq: { field, value },
    })),
    mockAnd: vi.fn((...conditions: unknown[]) => ({ __and: conditions })),
    mockInArray: vi.fn((field: unknown, values: unknown[]) => ({
      __inArray: { field, values },
    })),
    mockSql: vi.fn(() => ({ __sql: true })),
    mockDb: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => state.selectRows),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            updates.push(values);
            return [];
          }),
        })),
      })),
    },
    mockRequireThreadPinCaller: vi.fn(async () => ({
      tenantId: "tenant-1",
      userId: "user-1",
    })),
    mockLoadVisibleThreadForPin: vi.fn(async () => ({
      id: "thread-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      space_id: "space-1",
    })),
    mockEnsureUserThreadParticipant: vi.fn(async () => "participant-1"),
    mockLoadPinnedThread: vi.fn(),
    mockLoadPinnedThreads: vi.fn(async () => [
      { thread: { id: "thread-1" }, pinnedAt: "now", pinOrder: 1 },
    ]),
    mockNextPinOrder: vi.fn(async () => 3),
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: mockEq,
  and: mockAnd,
  inArray: mockInArray,
  sql: mockSql,
  threadParticipants: threadParticipantsTable,
}));

vi.mock("./threadPins.shared.js", () => ({
  requireThreadPinCaller: mockRequireThreadPinCaller,
  loadVisibleThreadForPin: mockLoadVisibleThreadForPin,
  ensureUserThreadParticipant: mockEnsureUserThreadParticipant,
  loadPinnedThread: mockLoadPinnedThread,
  loadPinnedThreads: mockLoadPinnedThreads,
  nextPinOrder: mockNextPinOrder,
}));

import { pinThread } from "./pinThread.mutation.js";
import { unpinThread } from "./unpinThread.mutation.js";
import { reorderPinnedThreads } from "./reorderPinnedThreads.mutation.js";

beforeEach(() => {
  updatedValues.length = 0;
  mutableState.selectRows = [{ thread_id: "thread-1" }];
  mockRequireThreadPinCaller.mockClear();
  mockLoadVisibleThreadForPin.mockClear();
  mockEnsureUserThreadParticipant.mockClear();
  mockLoadPinnedThread.mockReset();
  mockLoadPinnedThreads.mockClear();
  mockNextPinOrder.mockClear();
});

describe("thread pin mutations", () => {
  it("pins a visible thread to the caller participant row", async () => {
    mockLoadPinnedThread
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        thread: { id: "thread-1" },
        pinnedAt: "2026-05-28T12:00:00.000Z",
        pinOrder: 3,
      });

    const result = await pinThread(
      {},
      { tenantId: "tenant-1", threadId: "thread-1" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mockLoadVisibleThreadForPin).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      callerUserId: "user-1",
      threadId: "thread-1",
    });
    expect(mockEnsureUserThreadParticipant).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      thread: expect.objectContaining({ id: "thread-1" }),
    });
    expect(updatedValues[0]).toMatchObject({ pin_order: 3 });
    expect(updatedValues[0]?.pinned_at).toBeInstanceOf(Date);
    expect(result).toMatchObject({ thread: { id: "thread-1" }, pinOrder: 3 });
  });

  it("unpins only the caller's participant row", async () => {
    await unpinThread(
      {},
      { tenantId: "tenant-1", threadId: "thread-1" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedValues[0]).toMatchObject({
      pinned_at: null,
      pin_order: null,
    });
  });

  it("reorders only threads already pinned by the caller", async () => {
    const result = await reorderPinnedThreads(
      {},
      { tenantId: "tenant-1", threadIds: ["thread-1"] },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updatedValues[0]).toMatchObject({ pin_order: 1 });
    expect(result).toEqual([
      { thread: { id: "thread-1" }, pinnedAt: "now", pinOrder: 1 },
    ]);
  });

  it("rejects reorder requests that include unpinned thread ids", async () => {
    mutableState.selectRows = [];

    await expect(
      reorderPinnedThreads(
        {},
        { tenantId: "tenant-1", threadIds: ["missing-thread"] },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Pinned thread required");

    expect(updatedValues).toHaveLength(0);
  });
});
