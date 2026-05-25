import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockHasSpaceMemberAccess,
  mockResolveCallerUserId,
  tables,
} = vi.hoisted(() => {
  const tables = {
    linkedTasks: {
      id: { __column__: "linked_tasks.id" },
      tenant_id: { __column__: "linked_tasks.tenant_id" },
      thread_id: { __column__: "linked_tasks.thread_id" },
      __table__: "linkedTasks",
    },
    linkedTaskEvents: {
      __table__: "linkedTaskEvents",
    },
  };
  const captures = {
    taskRows: [] as Record<string, any>[],
    updateSet: null as Record<string, any> | null,
    insertedEvents: [] as Record<string, any>[],
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => captures.taskRows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, any>) => {
        captures.updateSet = values;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                ...captures.taskRows[0],
                ...values,
              },
            ]),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, any>) => {
        captures.insertedEvents.push(values);
      }),
    })),
  };
  return {
    captures,
    mockDb: db,
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    mockResolveCallerUserId: vi.fn(async () => "user-1"),
    tables,
  };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    db: mockDb,
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    linkedTasks: tables.linkedTasks,
    linkedTaskEvents: tables.linkedTaskEvents,
  };
});

vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { updateLinkedTask } from "./updateLinkedTask.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  captures.taskRows.length = 0;
  captures.updateSet = null;
  captures.insertedEvents.length = 0;
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
});

describe("updateLinkedTask", () => {
  it("lets a Space participant update a ThinkWork-native checklist row", async () => {
    captures.taskRows.push(nativeTaskRow());

    const result = await updateLinkedTask(
      {},
      {
        input: {
          tenantId: "tenant-1",
          linkedTaskId: "linked-task-1",
          threadId: "thread-1",
          status: "COMPLETED",
          note: "Signed package received.",
          metadata: JSON.stringify({ source: "manual-demo" }),
        },
      },
      ctx,
    );

    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-1",
    );
    expect(captures.updateSet).toEqual(
      expect.objectContaining({
        status: "completed",
        blocked: false,
        sync_status: "synced",
      }),
    );
    expect(captures.updateSet?.metadata).toMatchObject({
      existing: true,
      nativeChecklist: {
        lastStatusNote: "Signed package received.",
        lastStatusMetadata: { source: "manual-demo" },
        lastStatusUpdatedByUserId: "user-1",
      },
    });
    expect(captures.insertedEvents).toHaveLength(1);
    expect(captures.insertedEvents[0]).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        linked_task_id: "linked-task-1",
        provider: "thinkwork",
        event_type: "completed",
        previous_status: "todo",
        new_status: "completed",
        message:
          "Send DocuSign package marked completed. Note: Signed package received.",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "linked-task-1",
        provider: "THINKWORK",
        status: "COMPLETED",
        syncStatus: "SYNCED",
      }),
    );
  });

  it("rejects non-members before updating a native checklist row", async () => {
    captures.taskRows.push(nativeTaskRow());
    mockHasSpaceMemberAccess.mockResolvedValue(false);

    await expect(
      updateLinkedTask(
        {},
        {
          input: {
            tenantId: "tenant-1",
            linkedTaskId: "linked-task-1",
            threadId: "thread-1",
            status: "IN_PROGRESS",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Not authorized");

    expect(captures.updateSet).toBeNull();
    expect(captures.insertedEvents).toEqual([]);
  });

  it("rejects external-provider rows", async () => {
    captures.taskRows.push({ ...nativeTaskRow(), provider: "lastmile" });

    await expect(
      updateLinkedTask(
        {},
        {
          input: {
            tenantId: "tenant-1",
            linkedTaskId: "linked-task-1",
            threadId: "thread-1",
            status: "COMPLETED",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Only ThinkWork checklist rows can be updated");

    expect(captures.updateSet).toBeNull();
  });

  it("rejects rows outside the caller tenant scope", async () => {
    await expect(
      updateLinkedTask(
        {},
        {
          input: {
            tenantId: "tenant-1",
            linkedTaskId: "missing",
            threadId: "thread-1",
            status: "COMPLETED",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Linked task not found");
  });
});

function nativeTaskRow() {
  return {
    id: "linked-task-1",
    tenant_id: "tenant-1",
    space_id: "space-1",
    thread_id: "thread-1",
    checklist_item_id: "checklist-1",
    provider: "thinkwork",
    external_task_id: "thinkwork:thread-1:docusign_package",
    external_task_url: null,
    title: "Send DocuSign package",
    required: true,
    role_key: "sales",
    assignee_display: "Sales",
    assignee_external_id: null,
    status: "todo",
    blocked: false,
    sync_status: "synced",
    metadata: { existing: true },
    created_at: new Date("2026-05-25T00:00:00.000Z"),
    updated_at: new Date("2026-05-25T00:00:00.000Z"),
  };
}
