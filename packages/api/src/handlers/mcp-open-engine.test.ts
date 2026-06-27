import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbRows,
  mockClaimNext,
  mockCreateDocument,
  mockCreateWorkItem,
  mockGetDocument,
  mockGetWorkItem,
  mockListDocuments,
  mockListEligible,
  mockListWorkItems,
  mockRecordReceipt,
  mockUpdateDocument,
  mockUpdateStatus,
  mockUpdateWorkItem,
  tables,
} = vi.hoisted(() => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([
      ["__table__", name],
      ...fields.map((field) => [field, `${name}.${field}`]),
    ]);

  return {
    dbRows: [] as unknown[][],
    mockClaimNext: vi.fn(),
    mockCreateDocument: vi.fn(),
    mockCreateWorkItem: vi.fn(),
    mockGetDocument: vi.fn(),
    mockGetWorkItem: vi.fn(),
    mockListDocuments: vi.fn(),
    mockListEligible: vi.fn(),
    mockListWorkItems: vi.fn(),
    mockRecordReceipt: vi.fn(),
    mockUpdateDocument: vi.fn(),
    mockUpdateStatus: vi.fn(),
    mockUpdateWorkItem: vi.fn(),
    tables: {
      workItemEvents: table("work_item_events", [
        "tenant_id",
        "work_item_id",
        "event_type",
        "created_at",
      ]),
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
    },
  };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getApiAuthSecret: () => "service-secret",
  getAppsyncApiKey: () => "",
}));

vi.mock("./mcp-oauth.js", () => ({
  verifyMcpAccessToken: vi.fn(),
}));

vi.mock("../graphql/dataloaders.js", () => ({
  createLoaders: () => ({}),
}));

vi.mock("../graphql/utils.js", () => {
  const chain = () => {
    const value: any = {
      from: vi.fn(() => value),
      innerJoin: vi.fn(() => value),
      where: vi.fn(() => value),
      orderBy: vi.fn(() => value),
      limit: vi.fn(async () => dbRows.shift() ?? []),
      then: (resolve: any, reject: any) =>
        Promise.resolve(dbRows.shift() ?? []).then(resolve, reject),
    };
    return value;
  };
  return {
    and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
    asc: vi.fn((field: unknown) => ({ asc: field })),
    db: { select: vi.fn(() => chain()) },
    desc: vi.fn((field: unknown) => ({ desc: field })),
    eq: vi.fn((field: unknown, value: unknown) => ({ eq: [field, value] })),
    isNull: vi.fn((field: unknown) => ({ isNull: field })),
    workItemEvents: tables.workItemEvents,
    workItemLabelAssignments: tables.workItemLabelAssignments,
    workItemLabels: tables.workItemLabels,
  };
});

vi.mock("../lib/work-items/open-engine-queue-service.js", () => ({
  claimNextOpenEngineWorkItem: mockClaimNext,
  listEligibleOpenEngineWorkItems: mockListEligible,
}));

vi.mock("../lib/work-items/work-item-service.js", () => ({
  createWorkItem: mockCreateWorkItem,
  createWorkItemDocument: mockCreateDocument,
  getWorkItem: mockGetWorkItem,
  getWorkItemDocument: mockGetDocument,
  listWorkItemDocuments: mockListDocuments,
  listWorkItems: mockListWorkItems,
  updateWorkItem: mockUpdateWorkItem,
  updateWorkItemDocument: mockUpdateDocument,
  updateWorkItemStatus: mockUpdateStatus,
}));

vi.mock("../lib/work-items/open-engine-receipt-service.js", () => ({
  recordOpenEngineReceipt: mockRecordReceipt,
}));

import { handler } from "./mcp-open-engine.js";

beforeEach(() => {
  dbRows.length = 0;
  vi.clearAllMocks();
  mockGetWorkItem.mockResolvedValue(baseWorkItem());
  mockListDocuments.mockResolvedValue([]);
  mockRecordReceipt.mockResolvedValue({
    id: "event-1",
    work_item_id: "work-item-1",
    event_type: "agent_action",
    message: "ok",
    metadata: { receiptType: "claimed" },
    created_at: new Date("2026-06-27T12:00:00Z"),
  });
});

describe("OpenEngine MCP handler", () => {
  it("requires a bearer token", async () => {
    const response = await handler(event("tools/list", {}, { bearer: null }));

    expect(response.statusCode).toBe(401);
    expect(response.headers?.["WWW-Authenticate"]).toContain(
      "/.well-known/oauth-protected-resource/mcp/open-engine",
    );
  });

  it("lists OpenEngine tools for a tenant-scoped service caller", async () => {
    const response = await handler(event("tools/list"));
    const body = JSON.parse(response.body ?? "{}");

    expect(response.statusCode).toBe(200);
    expect(body.result.tools.map((tool: any) => tool.name)).toContain(
      "open_engine_claim_next",
    );
  });

  it("discovers eligible Work Items with queue filters", async () => {
    mockListEligible.mockResolvedValue([baseWorkItem()]);

    const response = await callTool("open_engine_list_work_items", {
      queueKey: "codex",
      spaceId: "space-1",
      labelSlugs: ["Codex", "Feature"],
      agentId: "agent-1",
      limit: 5,
    });
    const body = JSON.parse(response.body ?? "{}");

    expect(mockListEligible).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      queueKey: "codex",
      spaceId: "space-1",
      statusId: null,
      labelSlugs: ["Codex", "Feature"],
      ownerUserId: null,
      ownerAgentId: null,
      agentId: "agent-1",
      limit: 5,
    });
    expect(body.result.structuredContent.workItems[0].id).toBe("work-item-1");
  });

  it("claims one Work Item and records an AGENT CLAIMED receipt", async () => {
    mockClaimNext.mockResolvedValue(baseWorkItem());
    dbRows.push([], []);

    const response = await callTool("open_engine_claim_next", {
      agentId: "agent-1",
      queueKey: "codex",
      leaseSeconds: 120,
    });
    const body = JSON.parse(response.body ?? "{}");

    expect(mockClaimNext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        queueKey: "codex",
        agentId: "agent-1",
        leaseSeconds: 120,
      }),
    );
    expect(mockRecordReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workItemId: "work-item-1",
        agentId: "agent-1",
        receiptType: "claimed",
      }),
    );
    expect(body.result.structuredContent.claimed.id).toBe("work-item-1");
  });

  it("creates OpenEngine-enabled Work Items by default", async () => {
    mockCreateWorkItem.mockResolvedValue(baseWorkItem());

    const response = await callTool("open_engine_create_work_item", {
      spaceId: "space-1",
      title: "Dogfood pickup",
      queueKey: "codex",
      ownerAgentId: "agent-1",
    });
    const body = JSON.parse(response.body ?? "{}");

    expect(mockCreateWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        title: "Dogfood pickup",
        ownerAgentId: "agent-1",
        openEngineEnabled: true,
        openEngineQueueKey: "codex",
        openEngineDependencyState: "ready",
      }),
    );
    expect(body.result.structuredContent.workItem.id).toBe("work-item-1");
  });

  it("fetches binary document metadata without inline content", async () => {
    mockGetDocument.mockResolvedValue({
      id: "doc-1",
      work_item_id: "work-item-1",
      kind: "evidence",
      title: "Proof.pdf",
      content_type: "application/pdf",
      size_bytes: 100,
      checksum_sha256: "abc",
      metadata: { filename: "Proof.pdf" },
      content: null,
      created_at: new Date("2026-06-27T12:00:00Z"),
      updated_at: new Date("2026-06-27T12:00:00Z"),
    });

    const response = await callTool("open_engine_fetch_document", {
      documentId: "doc-1",
    });
    const body = JSON.parse(response.body ?? "{}");

    expect(mockGetDocument).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "tenant-1",
      id: "doc-1",
    });
    expect(body.result.structuredContent.document).toMatchObject({
      id: "doc-1",
      content: null,
      downloadAvailable: true,
      binary: true,
    });
  });

  it("updates an existing status ledger document instead of creating heartbeat clutter", async () => {
    mockListDocuments.mockResolvedValue([
      {
        id: "ledger-1",
        work_item_id: "work-item-1",
        kind: "progress",
        title: "OpenEngine status ledger: agent-1",
        content_type: "application/json",
        size_bytes: 10,
        metadata: { openEngineStatusLedger: true, agentId: "agent-1" },
      },
    ]);
    mockUpdateDocument.mockResolvedValue({
      id: "ledger-1",
      work_item_id: "work-item-1",
      kind: "progress",
      title: "OpenEngine status ledger: agent-1",
      content_type: "application/json",
      size_bytes: 20,
      metadata: { openEngineStatusLedger: true, agentId: "agent-1" },
      content: "{}",
    });

    const response = await callTool("open_engine_update_status_ledger", {
      workItemId: "work-item-1",
      agentId: "agent-1",
      status: "checking",
      message: "Looking for work",
    });
    const body = JSON.parse(response.body ?? "{}");

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        id: "ledger-1",
        kind: "progress",
        contentType: "application/json",
      }),
    );
    expect(mockCreateDocument).not.toHaveBeenCalled();
    expect(mockRecordReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptType: "status",
        metadata: { status: "checking", ledgerDocumentId: "ledger-1" },
      }),
    );
    expect(body.result.structuredContent.document.id).toBe("ledger-1");
  });
});

async function callTool(name: string, args: Record<string, unknown>) {
  return handler(
    event("tools/call", {
      name,
      arguments: args,
    }),
  );
}

function event(
  method: string,
  params: Record<string, unknown> = {},
  options: { bearer?: string | null } = {},
): any {
  const bearer =
    options.bearer === undefined ? "service-secret" : options.bearer;
  return {
    version: "2.0",
    rawPath: "/mcp/open-engine",
    headers: {
      host: "api.example.com",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "x-tenant-id": "tenant-1",
    },
    requestContext: {
      domainName: "api.example.com",
      http: {
        method: "POST",
        path: "/mcp/open-engine",
      },
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  };
}

function baseWorkItem() {
  return {
    id: "work-item-1",
    tenant_id: "tenant-1",
    space_id: "space-1",
    status_id: "status-1",
    title: "Ship OpenEngine MCP",
    notes: "Do the thing",
    priority: "high",
    owner_user_id: null,
    owner_agent_id: "agent-1",
    due_at: null,
    blocked: false,
    applicable: true,
    completed_at: null,
    open_engine_enabled: true,
    open_engine_queue_key: "codex",
    open_engine_claimed_by_agent_id: null,
    open_engine_claimed_at: null,
    open_engine_claim_expires_at: null,
    open_engine_human_hold: false,
    open_engine_human_hold_reason: null,
    open_engine_dependency_state: "ready",
    open_engine_scheduled_at: null,
    created_at: new Date("2026-06-27T12:00:00Z"),
    updated_at: new Date("2026-06-27T12:00:00Z"),
  };
}
