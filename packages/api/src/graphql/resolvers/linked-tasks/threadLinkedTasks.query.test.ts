import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockHasSpaceMemberAccess,
  mockCanReadTenantSpaces,
  tables,
} = vi.hoisted(() => {
  const tables = {
    threads: {
      id: { __column__: "threads.id" },
      tenant_id: { __column__: "threads.tenant_id" },
      space_id: { __column__: "threads.space_id" },
      __table__: "threads",
    },
    linkedTasks: {
      tenant_id: { __column__: "linked_tasks.tenant_id" },
      thread_id: { __column__: "linked_tasks.thread_id" },
      created_at: { __column__: "linked_tasks.created_at" },
      __table__: "linkedTasks",
    },
  };
  const captures = {
    threadRows: [] as Record<string, unknown>[],
    linkedTaskRows: [] as Record<string, unknown>[],
  };
  const rowsFor = (table: any) => {
    if (table === tables.threads) return captures.threadRows;
    if (table === tables.linkedTasks) return captures.linkedTaskRows;
    return [];
  };
  const chain = (rows: Record<string, unknown>[]) =>
    Object.assign(Promise.resolve(rows), {
      orderBy: vi.fn(async () => rows),
    });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(() => chain(rowsFor(table))),
      })),
    })),
  };

  return {
    captures,
    mockDb: db,
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    mockCanReadTenantSpaces: vi.fn(async () => true),
    tables,
  };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    db: mockDb,
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    asc: vi.fn((column: unknown) => ({ asc: column })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    linkedTasks: tables.linkedTasks,
    threads: tables.threads,
  };
});

vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
  canReadTenantSpaces: mockCanReadTenantSpaces,
}));

import { threadLinkedTasks } from "./threadLinkedTasks.query.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  captures.threadRows.length = 0;
  captures.linkedTaskRows.length = 0;
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockCanReadTenantSpaces.mockReset();
  mockCanReadTenantSpaces.mockResolvedValue(true);
});

describe("threadLinkedTasks", () => {
  it("returns mirrored checklist tasks for an authorized Space thread", async () => {
    captures.threadRows.push({
      id: "thread-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
    });
    captures.linkedTaskRows.push({
      id: "linked-task-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      thread_id: "thread-1",
      checklist_item_id: "checklist-1",
      provider: "lastmile",
      external_task_id: "LM-100",
      external_task_url: "https://tasks.example/LM-100",
      title: "Collect sales tax exemption",
      required: true,
      role_key: "accounting",
      assignee_display: "Accounting",
      status: "blocked",
      blocked: true,
      sync_status: "warning",
    });

    await expect(
      threadLinkedTasks(
        {},
        { tenantId: "tenant-1", threadId: "thread-1" },
        ctx,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "linked-task-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        checklistItemId: "checklist-1",
        provider: "LASTMILE",
        externalTaskId: "LM-100",
        title: "Collect sales tax exemption",
        required: true,
        roleKey: "accounting",
        assigneeDisplay: "Accounting",
        status: "BLOCKED",
        blocked: true,
        syncStatus: "WARNING",
      }),
    ]);
    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-1",
    );
  });

  it("returns empty for cross-tenant thread ids", async () => {
    captures.threadRows.push({
      id: "thread-1",
      tenant_id: "tenant-2",
      space_id: "space-1",
    });

    await expect(
      threadLinkedTasks(
        {},
        { tenantId: "tenant-1", threadId: "thread-1" },
        ctx,
      ),
    ).resolves.toEqual([]);
    expect(mockHasSpaceMemberAccess).not.toHaveBeenCalled();
  });

  it("returns empty when the caller cannot access the Space", async () => {
    captures.threadRows.push({
      id: "thread-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
    });
    mockHasSpaceMemberAccess.mockResolvedValue(false);

    await expect(
      threadLinkedTasks(
        {},
        { tenantId: "tenant-1", threadId: "thread-1" },
        ctx,
      ),
    ).resolves.toEqual([]);
  });

  it("falls back to tenant read access for non-Space task mirrors", async () => {
    captures.threadRows.push({
      id: "thread-1",
      tenant_id: "tenant-1",
      space_id: null,
    });

    await threadLinkedTasks(
      {},
      { tenantId: "tenant-1", threadId: "thread-1" },
      ctx,
    );

    expect(mockCanReadTenantSpaces).toHaveBeenCalledWith(ctx, "tenant-1");
  });
});
