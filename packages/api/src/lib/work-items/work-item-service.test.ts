import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbState,
  tables,
  mockRequireWorkItemSpaceAccess,
  mockResolveCallerUserId,
  mockResolveWorkItemTenant,
} = vi.hoisted(() => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([
      ["__table__", name],
      ...fields.map((field) => [field, `${name}.${field}`]),
    ]);

  return {
    dbState: {
      items: [] as unknown[][],
      duplicateComments: [] as unknown[][],
      insertedComments: [] as Record<string, unknown>[],
      insertedEvents: [] as Record<string, unknown>[],
    },
    mockRequireWorkItemSpaceAccess: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
    mockResolveWorkItemTenant: vi.fn(),
    tables: {
      spaceMembers: table("space_members", ["tenant_id", "space_id", "user_id"]),
      spaces: table("spaces", ["id", "tenant_id", "status", "access_mode"]),
      workItemComments: table("work_item_comments", [
        "tenant_id",
        "work_item_id",
        "author_user_id",
        "author_agent_id",
        "metadata",
        "archived_at",
        "created_at",
      ]),
      workItemDocuments: table("work_item_documents", ["tenant_id", "id"]),
      workItemEvents: table("work_item_events", ["tenant_id", "work_item_id"]),
      workItemLabelAssignments: table("work_item_label_assignments", [
        "tenant_id",
        "work_item_id",
        "label_id",
      ]),
      workItemLabels: table("work_item_labels", [
        "id",
        "tenant_id",
        "name",
        "slug",
        "color",
        "archived_at",
      ]),
      workItemStatuses: table("work_item_statuses", [
        "id",
        "tenant_id",
        "space_id",
        "category",
      ]),
      workItemThreadLinks: table("work_item_thread_links", [
        "tenant_id",
        "work_item_id",
        "thread_id",
      ]),
      workItems: table("work_items", [
        "id",
        "tenant_id",
        "space_id",
        "archived_at",
        "updated_at",
      ]),
    },
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {},
  PutObjectCommand: class PutObjectCommand {},
  S3Client: class S3Client {
    send = vi.fn();
  },
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => "workspace-bucket",
}));

vi.mock("../../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../graphql/resolvers/spaces/shared.js", () => ({
  canReadTenantSpaces: vi.fn(async () => true),
}));

vi.mock("./auth.js", () => ({
  requireWorkItemSpaceAccess: mockRequireWorkItemSpaceAccess,
  resolveWorkItemTenant: mockResolveWorkItemTenant,
}));

vi.mock("./status-service.js", () => ({
  findStatusForWorkItemUpdate: vi.fn(),
  normalizeWorkItemStatusCategory: vi.fn((value) => value),
}));

vi.mock("./open-engine-queue-service.js", () => ({
  normalizeOpenEngineQueueKey: vi.fn((value) => value),
}));

vi.mock("../../graphql/utils.js", () => {
  function selectChain() {
    const chain: any = {
      table: null,
      from(tableRef: Record<string, unknown>) {
        chain.table = tableRef;
        return chain;
      },
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () =>
        chain.table?.__table__ === "work_item_comments"
          ? (dbState.duplicateComments.shift() ?? [])
          : (dbState.items.shift() ?? []),
      ),
      then(resolve: any, reject: any) {
        return chain.limit().then(resolve, reject);
      },
    };
    return chain;
  }

  function insertChain(tableRef: Record<string, unknown>) {
    const chain: any = {
      values(value: Record<string, unknown>) {
        if (tableRef.__table__ === "work_item_comments") {
          dbState.insertedComments.push(value);
        }
        if (tableRef.__table__ === "work_item_events") {
          dbState.insertedEvents.push(value);
        }
        return chain;
      },
      returning: vi.fn(async () => [
        {
          id: "created-comment",
          ...dbState.insertedComments.at(-1),
          created_at: new Date("2026-06-29T01:00:00Z"),
        },
      ]),
    };
    return chain;
  }

  const tx = {
    select: vi.fn(() => selectChain()),
    insert: vi.fn((tableRef: Record<string, unknown>) => insertChain(tableRef)),
  };

  return {
    and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
    asc: vi.fn((field: unknown) => ({ asc: field })),
    db: {
      select: vi.fn(() => selectChain()),
      transaction: vi.fn(async (callback: (input: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
    desc: vi.fn((field: unknown) => ({ desc: field })),
    eq: vi.fn((field: unknown, value: unknown) => ({ eq: [field, value] })),
    gte: vi.fn((field: unknown, value: unknown) => ({ gte: [field, value] })),
    inArray: vi.fn((field: unknown, value: unknown) => ({
      inArray: [field, value],
    })),
    isNull: vi.fn((field: unknown) => ({ isNull: field })),
    lte: vi.fn((field: unknown, value: unknown) => ({ lte: [field, value] })),
    or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.reduce((acc, fragment, index) => {
        const value = index < values.length ? String(values[index]) : "";
        return `${acc}${fragment}${value}`;
      }, ""),
    })),
    ...tables,
  };
});

import { createWorkItemComment } from "./work-item-service.js";

beforeEach(() => {
  dbState.items.length = 0;
  dbState.duplicateComments.length = 0;
  dbState.insertedComments.length = 0;
  dbState.insertedEvents.length = 0;
  vi.clearAllMocks();
  mockResolveWorkItemTenant.mockResolvedValue("tenant-1");
  mockRequireWorkItemSpaceAccess.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockRejectedValue(new Error("no user"));
});

describe("createWorkItemComment", () => {
  it("returns an existing OpenEngine comment for a repeated idempotency key", async () => {
    const existing = {
      id: "comment-existing",
      tenant_id: "tenant-1",
      work_item_id: "work-item-1",
      author_agent_id: "agent-1",
      body: "AGENT STATUS: ready",
      metadata: {
        source: "open_engine_mcp",
        openEngine: { idempotencyKey: "key-1" },
      },
    };
    dbState.items.push([baseWorkItem()]);
    dbState.duplicateComments.push([existing]);

    const result = await createWorkItemComment(baseContext(), {
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      authorAgentId: "agent-1",
      body: "AGENT STATUS: ready",
      metadata: { openEngine: { gate: "status" } },
      idempotencyKey: "key-1",
      source: "open_engine_mcp",
    });

    expect(result).toBe(existing);
    expect(dbState.insertedComments).toHaveLength(0);
    expect(dbState.insertedEvents).toHaveLength(0);
  });

  it("creates separate comments when no idempotency key is supplied", async () => {
    dbState.items.push([baseWorkItem()]);

    const result = await createWorkItemComment(baseContext(), {
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      authorAgentId: "agent-1",
      body: "Plain comment",
      source: "open_engine_mcp",
    });

    expect(result.id).toBe("created-comment");
    expect(dbState.insertedComments).toHaveLength(1);
    expect(dbState.insertedEvents).toHaveLength(1);
    expect(dbState.insertedComments[0].metadata).toBeUndefined();
  });

  it("stores OpenEngine idempotency metadata on new comments", async () => {
    dbState.items.push([baseWorkItem()]);
    dbState.duplicateComments.push([]);

    await createWorkItemComment(baseContext(), {
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      authorAgentId: "agent-1",
      body: "AGENT DONE: finished",
      metadata: { openEngine: { gate: "done" } },
      idempotencyKey: "key-2",
      source: "open_engine_mcp",
    });

    expect(dbState.insertedComments[0].metadata).toMatchObject({
      source: "open_engine_mcp",
      openEngine: { gate: "done", idempotencyKey: "key-2" },
    });
    expect(dbState.insertedEvents).toHaveLength(1);
  });
});

function baseContext() {
  return { auth: { authType: "api-key" } } as any;
}

function baseWorkItem() {
  return {
    id: "work-item-1",
    tenant_id: "tenant-1",
    space_id: "space-1",
  };
}
