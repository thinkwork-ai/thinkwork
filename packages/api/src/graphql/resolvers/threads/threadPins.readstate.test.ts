import { describe, expect, it, beforeEach, vi } from "vitest";

// Regression for the "pinning a read thread flips it back to unread" bug.
// Read-state is stored per-user on `thread_participants.last_read_at`; the
// pinned-thread list must resolve the same effective value threadsPaged does
// (participant value, falling back to the thread column) rather than reading
// the usually-null `threads.last_read_at`.

const {
  mockDb,
  mockEq,
  mockAnd,
  mockAsc,
  mockDesc,
  mockSql,
  threadsTable,
  threadParticipantsTable,
  capturedProjections,
  mutableRows,
} = vi.hoisted(() => {
  const col = (label: string) => ({ __col: label });
  const threads = {
    id: col("threads.id"),
    tenant_id: col("threads.tenant_id"),
    last_read_at: col("threads.last_read_at"),
    archived_at: col("threads.archived_at"),
  };
  const threadParticipants = {
    id: col("thread_participants.id"),
    tenant_id: col("thread_participants.tenant_id"),
    thread_id: col("thread_participants.thread_id"),
    participant_type: col("thread_participants.participant_type"),
    user_id: col("thread_participants.user_id"),
    pinned_at: col("thread_participants.pinned_at"),
    pin_order: col("thread_participants.pin_order"),
    last_read_at: col("thread_participants.last_read_at"),
  };
  const projections: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  return {
    threadsTable: threads,
    threadParticipantsTable: threadParticipants,
    capturedProjections: projections,
    mutableRows: rows,
    mockEq: vi.fn((field: unknown, value: unknown) => ({
      __eq: { field, value },
    })),
    mockAnd: vi.fn((...conditions: unknown[]) => ({ __and: conditions })),
    mockAsc: vi.fn((field: unknown) => ({ __asc: field })),
    mockDesc: vi.fn((field: unknown) => ({ __desc: field })),
    // Capture the template + interpolated column refs so the test can assert
    // the coalesce references BOTH participant and thread last_read_at columns.
    mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      __sql: { text: strings.join("?"), values },
    })),
    mockDb: {
      select: vi.fn((projection: Record<string, unknown>) => {
        projections.push(projection);
        return {
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(async () => rows),
                })),
              })),
            })),
          })),
        };
      }),
    },
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: mockEq,
  and: mockAnd,
  asc: mockAsc,
  desc: mockDesc,
  sql: mockSql,
  threads: threadsTable,
  threadParticipants: threadParticipantsTable,
  threadToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("drizzle-orm", () => ({
  getTableColumns: (table: Record<string, unknown>) => table,
}));

vi.mock("./access.js", () => ({
  callerVisibleThreadPredicate: vi.fn(() => ({ __visible: true })),
}));

import { loadPinnedThreads } from "./threadPins.shared.js";

beforeEach(() => {
  capturedProjections.length = 0;
  mutableRows.length = 0;
  mockSql.mockClear();
});

describe("loadPinnedThreads read-state", () => {
  it("projects last_read_at as COALESCE(participant, thread)", async () => {
    await loadPinnedThreads({
      tenantId: "tenant-1",
      userId: "user-1",
      limit: 20,
    });

    const projection = capturedProjections[0];
    expect(projection).toBeTruthy();

    const lastReadProjection = projection?.last_read_at as
      | { __sql?: { values: unknown[] } }
      | undefined;
    // It must NOT be the bare thread column (the bug) — it must be a sql
    // expression interpolating both the participant and thread columns.
    expect(lastReadProjection?.__sql).toBeTruthy();
    expect(lastReadProjection?.__sql?.values).toContain(
      threadParticipantsTable.last_read_at,
    );
    expect(lastReadProjection?.__sql?.values).toContain(
      threadsTable.last_read_at,
    );
  });
});
