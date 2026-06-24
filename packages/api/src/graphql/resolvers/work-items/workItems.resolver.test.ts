import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockCanReadTenantSpaces,
  mockHasSpaceMemberAccess,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  tables,
} = vi.hoisted(() => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([
      ["__table__", name],
      ...fields.map((field) => [field, `${name}.${field}`]),
    ]);

  const tables = {
    workItems: table("work_items", [
      "id",
      "tenant_id",
      "space_id",
      "status_id",
      "title",
      "priority",
      "blocked",
      "required",
      "applicable",
      "due_at",
      "owner_user_id",
      "owner_agent_id",
      "archived_at",
      "updated_at",
    ]),
    workItemStatuses: table("work_item_statuses", [
      "id",
      "tenant_id",
      "space_id",
      "category",
      "is_active",
      "is_default",
      "display_order",
    ]),
    workItemThreadLinks: table("work_item_thread_links", [
      "tenant_id",
      "work_item_id",
      "thread_id",
    ]),
    workItemEvents: table("work_item_events", []),
    workItemSavedViews: table("work_item_saved_views", [
      "id",
      "tenant_id",
      "user_id",
      "name",
      "space_id",
      "is_private",
      "is_default",
      "updated_at",
    ]),
    spaces: table("spaces", ["id"]),
    spaceMembers: table("space_members", ["id"]),
  };

  const captures = {
    selectQueue: [] as unknown[][],
    updateSets: [] as Record<string, unknown>[],
    updateWhere: [] as unknown[],
    updateReturningQueue: [] as unknown[][],
    insertValues: [] as Record<string, unknown>[],
    deleteWhere: [] as unknown[],
    selectWhere: [] as unknown[],
  };

  const buildSelectChain = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((clause: unknown) => {
        captures.selectWhere.push(clause);
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => captures.selectQueue.shift() ?? []),
      then: (resolve: any, reject: any) =>
        Promise.resolve(captures.selectQueue.shift() ?? []).then(
          resolve,
          reject,
        ),
    };
    return chain;
  };
  const buildUpdateChain = () => {
    const chain: any = {
      set: vi.fn((values: Record<string, unknown>) => {
        captures.updateSets.push(values);
        return chain;
      }),
      where: vi.fn((clause: unknown) => {
        captures.updateWhere.push(clause);
        return chain;
      }),
      returning: vi.fn(async () => captures.updateReturningQueue.shift() ?? []),
    };
    return chain;
  };
  const buildInsertChain = () => {
    const chain: any = {
      values: vi.fn((values: Record<string, unknown>) => {
        captures.insertValues.push(values);
        return chain;
      }),
      returning: vi.fn(async () => captures.selectQueue.shift() ?? []),
      onConflictDoNothing: vi.fn(async () => undefined),
    };
    return chain;
  };
  const buildDeleteChain = () => {
    const chain: any = {
      where: vi.fn((clause: unknown) => {
        captures.deleteWhere.push(clause);
        return chain;
      }),
      returning: vi.fn(async () => captures.updateReturningQueue.shift() ?? []),
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
    insert: vi.fn(() => buildInsertChain()),
    delete: vi.fn(() => buildDeleteChain()),
    transaction: vi.fn((fn: any) => fn(db)),
  };

  return {
    captures,
    mockDb: db,
    mockCanReadTenantSpaces: vi.fn(async () => true),
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    mockResolveCallerTenantId: vi.fn(async () => "tenant-1"),
    mockResolveCallerUserId: vi.fn(async () => "user-1"),
    tables,
  };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    db: mockDb,
    and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
    or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
    asc: vi.fn((column: unknown) => ({ asc: column })),
    desc: vi.fn((column: unknown) => ({ desc: column })),
    eq: vi.fn((field: unknown, value: unknown) => ({ eq: [field, value] })),
    gte: vi.fn((field: unknown, value: unknown) => ({ gte: [field, value] })),
    lte: vi.fn((field: unknown, value: unknown) => ({ lte: [field, value] })),
    isNull: vi.fn((field: unknown) => ({ isNull: field })),
    sql: Object.assign(
      vi.fn((strings: TemplateStringsArray) => ({ sql: strings.join("?") })),
      { join: vi.fn() },
    ),
    spaceMembers: tables.spaceMembers,
    spaces: tables.spaces,
    workItems: tables.workItems,
    workItemStatuses: tables.workItemStatuses,
    workItemThreadLinks: tables.workItemThreadLinks,
    workItemEvents: tables.workItemEvents,
    workItemSavedViews: tables.workItemSavedViews,
  };
});

vi.mock("../spaces/shared.js", () => ({
  canReadTenantSpaces: mockCanReadTenantSpaces,
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { workItems } from "./workItems.query.js";
import { updateWorkItemStatus } from "./updateWorkItemStatus.mutation.js";
import { deleteWorkItemView } from "./deleteWorkItemView.mutation.js";

const ctx = { auth: { authType: "cognito", tenantId: "tenant-1" } } as any;

beforeEach(() => {
  captures.selectQueue.length = 0;
  captures.updateSets.length = 0;
  captures.updateWhere.length = 0;
  captures.updateReturningQueue.length = 0;
  captures.insertValues.length = 0;
  captures.deleteWhere.length = 0;
  captures.selectWhere.length = 0;
  mockCanReadTenantSpaces.mockReset().mockResolvedValue(true);
  mockHasSpaceMemberAccess.mockReset().mockResolvedValue(true);
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
});

describe("work item resolvers", () => {
  it("lists only accessible Work Items and maps enum fields", async () => {
    captures.selectQueue.push([
      {
        id: "work-item-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        title: "Send DocuSign package",
        priority: "high",
        required: true,
        applicable: true,
        blocked: false,
      },
    ]);

    const result = await workItems(
      null,
      { input: { tenantId: "tenant-1", statusCategory: "ACTIVE" } },
      ctx,
    );

    expect(mockCanReadTenantSpaces).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockResolveCallerUserId).toHaveBeenCalledWith(ctx);
    expect(result).toEqual([
      expect.objectContaining({
        id: "work-item-1",
        title: "Send DocuSign package",
        priority: "HIGH",
      }),
    ]);
    expect(captures.selectWhere[0]).toMatchObject({ op: "and" });
  });

  it("updates status transactionally and records an event", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      status_id: "status-todo",
      title: "Collect tax exemption",
      priority: "normal",
    };
    const doneStatus = {
      id: "status-done",
      tenant_id: "tenant-1",
      space_id: "space-1",
      name: "Done",
      category: "done",
      is_final: true,
    };
    captures.selectQueue.push(
      [existingItem],
      [{ id: "status-todo" }],
      [doneStatus],
    );
    captures.updateReturningQueue.push([
      {
        ...existingItem,
        status_id: "status-done",
        completed_at: new Date("2026-06-24T12:00:00Z"),
      },
    ]);

    const result = await updateWorkItemStatus(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          statusCategory: "DONE",
          threadId: "thread-1",
          note: "Signed.",
        },
      },
      ctx,
    );

    expect(mockDb.transaction).toHaveBeenCalled();
    expect(captures.updateSets[0]).toEqual(
      expect.objectContaining({
        status_id: "status-done",
        blocked: false,
        completed_by_user_id: "user-1",
      }),
    );
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        work_item_id: "work-item-1",
        thread_id: "thread-1",
        actor_user_id: "user-1",
        event_type: "completed",
        previous_status_id: "status-todo",
        new_status_id: "status-done",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: "work-item-1", statusId: "status-done" }),
    );
  });

  it("deletes only a saved view owned by the caller", async () => {
    captures.updateReturningQueue.push([{ id: "view-1" }]);

    await expect(
      deleteWorkItemView(
        null,
        { input: { tenantId: "tenant-1", id: "view-1" } },
        ctx,
      ),
    ).resolves.toBe(true);

    expect(captures.deleteWhere[0]).toMatchObject({ op: "and" });
    expect(mockResolveCallerUserId).toHaveBeenCalledWith(ctx);
  });
});
