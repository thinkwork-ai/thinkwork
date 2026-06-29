import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captures,
  mockDb,
  mockCanReadTenantSpaces,
  mockHasSpaceMemberAccess,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockS3Send,
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
      "open_engine_human_hold",
      "open_engine_human_hold_reason",
      "open_engine_dependency_state",
      "open_engine_claimed_by_agent_id",
      "open_engine_claimed_at",
      "open_engine_claim_expires_at",
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
    workItemEvents: table("work_item_events", [
      "tenant_id",
      "work_item_id",
      "actor_user_id",
      "metadata",
    ]),
    workItemLabels: table("work_item_labels", [
      "id",
      "tenant_id",
      "name",
      "slug",
      "color",
      "description",
      "archived_at",
      "created_by_user_id",
      "updated_at",
    ]),
    workItemLabelAssignments: table("work_item_label_assignments", [
      "tenant_id",
      "work_item_id",
      "label_id",
      "created_by_user_id",
    ]),
    workItemDocuments: table("work_item_documents", [
      "id",
      "tenant_id",
      "work_item_id",
      "kind",
      "title",
      "content_type",
      "s3_key",
      "size_bytes",
      "checksum_sha256",
      "metadata",
      "created_by_user_id",
      "created_by_agent_id",
      "created_at",
      "updated_at",
      "archived_at",
    ]),
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
    spaces: table("spaces", ["id", "tenant_id", "status", "access_mode"]),
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
    mockS3Send: vi.fn(),
    tables,
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn((input) => ({ kind: "PutObjectCommand", input })),
  GetObjectCommand: vi.fn((input) => ({ kind: "GetObjectCommand", input })),
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: vi.fn((key: string) =>
    key === "WORKSPACE_BUCKET" ? "workspace-bucket" : undefined,
  ),
  getApiAuthSecret: vi.fn(() => "test-secret"),
}));

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
    inArray: vi.fn((field: unknown, values: unknown[]) => ({
      inArray: [field, values],
    })),
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
    workItemLabels: tables.workItemLabels,
    workItemLabelAssignments: tables.workItemLabelAssignments,
    workItemDocuments: tables.workItemDocuments,
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
import { workItemLabels } from "./workItemLabels.query.js";
import { createWorkItemLabel } from "./createWorkItemLabel.mutation.js";
import { createWorkItemDocument } from "./createWorkItemDocument.mutation.js";
import { updateWorkItemLabel } from "./updateWorkItemLabel.mutation.js";
import { updateWorkItemDocument } from "./updateWorkItemDocument.mutation.js";
import { updateWorkItemStatus } from "./updateWorkItemStatus.mutation.js";
import { recordOpenEngineHumanAction } from "./recordOpenEngineHumanAction.mutation.js";
import { workItemDocument } from "./workItemDocument.query.js";
import { workItemDocuments } from "./workItemDocuments.query.js";
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
  mockS3Send.mockReset().mockResolvedValue({
    Body: { transformToString: async () => "# Plan\n\nDo the thing." },
  });
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

  it("filters Work Items by normalized label slugs", async () => {
    captures.selectQueue.push([]);

    await workItems(
      null,
      { input: { tenantId: "tenant-1", labelSlugs: ["Needs Human"] } },
      ctx,
    );

    expect(captures.selectWhere[0]).toMatchObject({ op: "and" });
    expect(JSON.stringify(captures.selectWhere[0])).toContain(
      "wil.archived_at IS NULL",
    );
    expect(JSON.stringify(captures.selectWhere[0])).toContain("IN (?)");
  });

  it("includes caller-assigned Work Items even when Space membership is not the grant", async () => {
    captures.selectQueue.push([]);

    await workItems(null, { input: { tenantId: "tenant-1" } }, ctx);

    expect(JSON.stringify(captures.selectWhere[0])).toContain(
      "work_items.owner_user_id",
    );
    expect(JSON.stringify(captures.selectWhere[0])).toContain("user-1");
  });

  it("lists Work Item labels", async () => {
    captures.selectQueue.push([
      {
        id: "label-1",
        tenant_id: "tenant-1",
        name: "OpenEngine",
        slug: "openengine",
        color: "#3b82f6",
      },
    ]);

    const result = await workItemLabels(
      null,
      { input: { tenantId: "tenant-1" } },
      ctx,
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "label-1",
        name: "OpenEngine",
        slug: "openengine",
      }),
    ]);
  });

  it("creates Work Item labels with normalized slugs", async () => {
    captures.selectQueue.push([
      {
        id: "label-1",
        tenant_id: "tenant-1",
        name: "Needs Human",
        slug: "needs-human",
      },
    ]);

    const result = await createWorkItemLabel(
      null,
      { input: { tenantId: "tenant-1", name: "Needs Human" } },
      ctx,
    );

    expect(captures.insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      name: "Needs Human",
      slug: "needs-human",
    });
    expect(result).toMatchObject({ id: "label-1", slug: "needs-human" });
  });

  it("archives Work Item labels without deleting assignments", async () => {
    captures.updateReturningQueue.push([
      {
        id: "label-1",
        tenant_id: "tenant-1",
        name: "Blocked",
        slug: "blocked",
        archived_at: new Date("2026-06-27T00:00:00Z"),
      },
    ]);

    const result = await updateWorkItemLabel(
      null,
      { input: { tenantId: "tenant-1", id: "label-1", archived: true } },
      ctx,
    );

    expect(captures.updateSets[0]).toHaveProperty("archived_at");
    expect(result).toMatchObject({ id: "label-1", slug: "blocked" });
  });

  it("creates Work Item documents in S3 and records metadata", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      title: "Implement OpenEngine docs",
    };
    captures.selectQueue.push(
      [existingItem],
      [
        {
          id: "document-1",
          tenant_id: "tenant-1",
          work_item_id: "work-item-1",
          kind: "plan",
          title: "Implementation plan",
          content_type: "text/markdown",
          s3_key:
            "tenants/tenant-1/work-items/work-item-1/documents/document-1.md",
          size_bytes: 12,
          checksum_sha256: "checksum",
          created_by_user_id: "user-1",
        },
      ],
    );

    const result = await createWorkItemDocument(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          kind: "PLAN",
          title: "Implementation plan",
          content: "# Plan",
          metadata: JSON.stringify({ source: "test" }),
        },
      },
      ctx,
    );

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "PutObjectCommand",
        input: expect.objectContaining({
          Bucket: "workspace-bucket",
          ContentType: "text/markdown",
          Key: expect.stringContaining(
            "tenants/tenant-1/work-items/work-item-1/documents/",
          ),
        }),
      }),
    );
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        work_item_id: "work-item-1",
        kind: "plan",
        title: "Implementation plan",
        content_type: "text/markdown",
        created_by_user_id: "user-1",
        metadata: { source: "test" },
      }),
    );
    expect(captures.insertValues[1]).toEqual(
      expect.objectContaining({
        event_type: "updated",
        metadata: expect.objectContaining({ action: "document_created" }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "document-1",
        kind: "PLAN",
        title: "Implementation plan",
      }),
    );
  });

  it("creates uploaded binary Work Item documents without inline content", async () => {
    const pdfBytes = Buffer.from("%PDF-1.7");
    const checksum = createHash("sha256").update(pdfBytes).digest("hex");
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      title: "Implement OpenEngine docs",
    };
    captures.selectQueue.push(
      [existingItem],
      [
        {
          id: "document-1",
          tenant_id: "tenant-1",
          work_item_id: "work-item-1",
          kind: "evidence",
          title: "Evidence.pdf",
          content_type: "application/pdf",
          s3_key:
            "tenants/tenant-1/work-items/work-item-1/documents/document-1.pdf",
          size_bytes: 8,
          checksum_sha256: "checksum",
          created_by_user_id: "user-1",
        },
      ],
    );

    const result = await createWorkItemDocument(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          kind: "EVIDENCE",
          title: "Evidence.pdf",
          contentBase64: Buffer.from("%PDF-1.7").toString("base64"),
          contentType: "application/pdf",
          filename: "Evidence.pdf",
        },
      },
      ctx,
    );

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "PutObjectCommand",
        input: expect.objectContaining({
          Bucket: "workspace-bucket",
          ContentType: "application/pdf",
          Key: expect.stringMatching(/document.*\.pdf$/),
          Body: pdfBytes,
        }),
      }),
    );
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        content_type: "application/pdf",
        size_bytes: pdfBytes.byteLength,
        checksum_sha256: checksum,
        metadata: { filename: "Evidence.pdf" },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "document-1",
        kind: "EVIDENCE",
        content: null,
      }),
    );
  });

  it("rejects malformed base64 Work Item document uploads", async () => {
    captures.selectQueue.push([
      {
        id: "work-item-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        title: "Implement OpenEngine docs",
      },
    ]);

    await expect(
      createWorkItemDocument(
        null,
        {
          input: {
            tenantId: "tenant-1",
            workItemId: "work-item-1",
            title: "Evidence.pdf",
            contentBase64: "not-base64",
            contentType: "application/pdf",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
      message: "contentBase64 must be valid base64",
    });
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(captures.insertValues).toEqual([]);
  });

  it("lists Work Item document content when requested", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      title: "Implement OpenEngine docs",
    };
    captures.selectQueue.push(
      [existingItem],
      [
        {
          id: "document-1",
          tenant_id: "tenant-1",
          work_item_id: "work-item-1",
          kind: "handoff",
          title: "Agent handoff",
          content_type: "text/markdown",
          s3_key: "doc.md",
          size_bytes: 21,
        },
      ],
    );

    const result = await workItemDocuments(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          includeContent: true,
        },
      },
      ctx,
    );

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "GetObjectCommand" }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "document-1",
        kind: "HANDOFF",
        content: "# Plan\n\nDo the thing.",
      }),
    ]);
  });

  it("fetches and archives Work Item documents", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      title: "Implement OpenEngine docs",
    };
    const documentRow = {
      id: "document-1",
      tenant_id: "tenant-1",
      work_item_id: "work-item-1",
      kind: "evidence",
      title: "Verification",
      content_type: "text/markdown",
      s3_key: "doc.md",
      size_bytes: 21,
    };
    captures.selectQueue.push([documentRow], [existingItem]);

    const fetched = await workItemDocument(
      null,
      { input: { tenantId: "tenant-1", id: "document-1" } },
      ctx,
    );

    expect(fetched).toEqual(
      expect.objectContaining({
        id: "document-1",
        kind: "EVIDENCE",
        content: "# Plan\n\nDo the thing.",
      }),
    );

    captures.selectQueue.push([documentRow], [existingItem]);
    captures.updateReturningQueue.push([
      {
        ...documentRow,
        archived_at: new Date("2026-06-27T12:00:00Z"),
      },
    ]);

    const archived = await updateWorkItemDocument(
      null,
      { input: { tenantId: "tenant-1", id: "document-1", archived: true } },
      ctx,
    );

    expect(captures.updateSets[0]).toHaveProperty("archived_at");
    expect(captures.insertValues.at(-1)).toEqual(
      expect.objectContaining({
        event_type: "updated",
        metadata: expect.objectContaining({ action: "document_archived" }),
      }),
    );
    expect(archived).toEqual(
      expect.objectContaining({ id: "document-1", content: null }),
    );
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

  it("records a human OpenEngine blocker answer and releases the item for pickup", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      status_id: "status-blocked",
      title: "Need tax forms",
      priority: "high",
      blocked: true,
      open_engine_human_hold: true,
      open_engine_human_hold_reason: "Need exemption form.",
    };
    const now = "2026-06-27T13:00:00.000Z";
    captures.selectQueue.push([existingItem]);
    captures.updateReturningQueue.push([
      {
        ...existingItem,
        blocked: false,
        open_engine_human_hold: false,
        open_engine_human_hold_reason: null,
        open_engine_dependency_state: "ready",
      },
    ]);
    captures.selectQueue.push([
      {
        id: "event-1",
        tenant_id: "tenant-1",
        work_item_id: "work-item-1",
        actor_user_id: "user-1",
        event_type: "unblocked",
        message: "Customer uploaded the form.",
        metadata: {
          source: "open_engine_human_action",
          actionType: "answer_blocker",
          evidence: { documentId: "doc-1" },
        },
      },
    ]);

    const result = await recordOpenEngineHumanAction(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          actionType: "ANSWER_BLOCKER",
          message: "Customer uploaded the form.",
          evidence: JSON.stringify({ documentId: "doc-1" }),
          now,
        },
      },
      ctx,
    );

    expect(captures.updateSets[0]).toEqual({
      blocked: false,
      open_engine_human_hold: false,
      open_engine_human_hold_reason: null,
      open_engine_dependency_state: "ready",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: new Date(now),
    });
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        work_item_id: "work-item-1",
        actor_user_id: "user-1",
        event_type: "unblocked",
        message: "Customer uploaded the form.",
        metadata: {
          source: "open_engine_human_action",
          actionType: "answer_blocker",
          evidence: { documentId: "doc-1" },
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "event-1",
        eventType: "UNBLOCKED",
        message: "Customer uploaded the form.",
      }),
    );
  });

  it("does not duplicate idempotent human OpenEngine actions", async () => {
    const existingItem = {
      id: "work-item-1",
      tenant_id: "tenant-1",
      space_id: "space-1",
      title: "Need review",
      priority: "normal",
    };
    captures.selectQueue.push(
      [existingItem],
      [
        {
          id: "event-existing",
          tenant_id: "tenant-1",
          work_item_id: "work-item-1",
          actor_user_id: "user-1",
          event_type: "status_changed",
          message: "Already reviewed.",
        },
      ],
    );

    const result = await recordOpenEngineHumanAction(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workItemId: "work-item-1",
          actionType: "MARK_REVIEWED",
          idempotencyKey: "review-key-1",
        },
      },
      ctx,
    );

    expect(captures.updateSets).toEqual([]);
    expect(captures.insertValues).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        id: "event-existing",
        eventType: "STATUS_CHANGED",
      }),
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
