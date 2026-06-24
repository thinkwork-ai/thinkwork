import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  mockAuthenticate,
  mockSelectLimit,
  mockBuildMcpConfigs,
  mockListTools,
  mockCallTool,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockBuildMcpConfigs: vi.fn(),
  mockListTools: vi.fn(),
  mockCallTool: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSelectLimit() as unknown[]),
        }),
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  schema: {
    users: { email: "users.email" },
    agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
  },
}));

vi.mock("../lib/mcp-configs.js", () => ({
  buildMcpConfigs: mockBuildMcpConfigs,
}));

// Reuse the real McpTransportError so `instanceof` checks in the handler match.
vi.mock("../lib/mcp-client-call.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/mcp-client-call.js")
  >("../lib/mcp-client-call.js");
  return {
    ...actual,
    mcpListTools: mockListTools,
    mcpCallTool: mockCallTool,
  };
});

import { handler } from "./mcp-proxy";
import { McpTransportError } from "../lib/mcp-client-call.js";

function event(
  path: string,
  body: unknown,
  method = "POST",
): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method, path } },
    headers: { authorization: "Bearer tok" },
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

function parse(res: { body?: unknown }) {
  return JSON.parse(res.body as string);
}

const LIST_PATH = "/api/mcp/tools/list";
const CALL_PATH = "/api/mcp/tools/call";

const SERVER_A = {
  name: "crm",
  url: "https://mcp.example.com/crm",
  transport: "streamable-http" as const,
  auth: { type: "bearer", token: "tok-a" },
};

const OK_CONTENT = [{ type: "text", text: "ok" }];
const RECORD_LINK_HINTS = {
  schemaVersion: 1 as const,
  source: "plugin-manifest" as const,
  browserBaseUrl: "https://crm.example.com",
  routes: [
    {
      objectType: "opportunity",
      routeTemplate: "/object/opportunity/{id}",
      idFields: ["id"],
      labelFields: ["name"],
    },
  ],
};

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockSelectLimit.mockReset();
  mockBuildMcpConfigs.mockReset();
  mockListTools.mockReset();
  mockCallTool.mockReset();

  // Google-federated caller: JWT tenantId is null, resolved by email.
  mockAuthenticate.mockResolvedValue({
    principalId: "p1",
    tenantId: null,
    email: "eric@example.com",
    authType: "cognito",
    agentId: null,
  });
  // 1st select → user row (by email); 2nd select → agent row (tenant-scoped)
  mockSelectLimit
    .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
    .mockReturnValueOnce([{ id: "ag1" }]);
  mockBuildMcpConfigs.mockResolvedValue([SERVER_A]);
});

afterEach(() => vi.clearAllMocks());

describe("mcp-proxy handler", () => {
  it("tools/list returns the tenant's tool defs (server-qualified)", async () => {
    mockListTools.mockResolvedValue([
      {
        name: "create_lead",
        description: "Create a lead",
        inputSchema: { type: "object" },
      },
    ]);

    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).tools).toEqual([
      {
        name: "crm__create_lead",
        server: "crm",
        tool: "create_lead",
        description: "Create a lead",
        inputSchema: { type: "object" },
      },
    ]);
    // buildMcpConfigs keyed by (agentId, caller's users.id) for BOTH
    // halves of the dispatch identity (direct per_user_oauth AND
    // plugin-managed servers resolve by the caller in mcp-proxy).
    expect(mockBuildMcpConfigs).toHaveBeenCalledWith(
      "ag1",
      { humanPairId: "u1", requesterUserId: "u1" },
      expect.any(String),
    );
  });

  it("tools/list reports per-server discovery failures without failing the whole catalog", async () => {
    mockBuildMcpConfigs.mockResolvedValue([
      SERVER_A,
      { name: "erp", url: "https://erp", transport: "streamable-http" },
    ]);
    mockListTools
      .mockResolvedValueOnce([{ name: "create_lead" }])
      .mockRejectedValueOnce(new McpTransportError("timeout", "erp"));

    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      "crm__create_lead",
    ]);
    expect(body.errors).toEqual([
      { server: "erp", error: "timeout", kind: "transport" },
    ]);
  });

  it("tools/call forwards {name, arguments} and returns the result", async () => {
    mockCallTool.mockResolvedValue({
      content: OK_CONTENT,
      isError: false,
      raw: {},
    });

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        name: "crm__create_lead",
        arguments: { email: "x@y.com" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.content).toEqual(OK_CONTENT);
    expect(body.isError).toBe(false);
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SERVER_A.url,
        token: "tok-a",
        name: "crm",
      }),
      "create_lead",
      { email: "x@y.com" },
    );
  });

  it("tools/call forwards record-link hints and returns structured links", async () => {
    mockBuildMcpConfigs.mockResolvedValue([
      { ...SERVER_A, recordLinkHints: RECORD_LINK_HINTS },
    ]);
    mockCallTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Found records.\n\nRecord links:\n- McPherson POC: https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
        },
      ],
      isError: false,
      raw: {},
      recordLinks: [
        {
          objectType: "opportunity",
          id: "c203680f-4d36-461b-b134-25aef43d62c5",
          label: "McPherson POC",
          url: "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
        },
      ],
    });

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        name: "crm__find_many_opportunities",
        arguments: {},
      }),
    );

    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.content[0].text).toContain("Record links:");
    expect(body.recordLinks).toEqual([
      {
        objectType: "opportunity",
        id: "c203680f-4d36-461b-b134-25aef43d62c5",
        label: "McPherson POC",
        url: "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
      },
    ]);
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SERVER_A.url,
        token: "tok-a",
        name: "crm",
      }),
      "find_many_opportunities",
      {},
      { recordLinkHints: RECORD_LINK_HINTS },
    );
  });

  it("tools/call forwards auxiliary headers for bearer-auth servers", async () => {
    mockBuildMcpConfigs.mockResolvedValue([
      {
        ...SERVER_A,
        auth: {
          type: "bearer",
          token: "header_token_user_123",
          headers: { "x-workspace-slug": "eng" },
        },
      },
    ]);
    mockCallTool.mockResolvedValue({
      content: OK_CONTENT,
      isError: false,
      raw: {},
    });

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        name: "crm__create_lead",
        arguments: {},
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "header_token_user_123",
        headers: { "x-workspace-slug": "eng" },
      }),
      "create_lead",
      {},
    );
  });

  it("tools/call accepts bounded {server, tool, arguments}", async () => {
    mockCallTool.mockResolvedValue({
      content: OK_CONTENT,
      isError: false,
      raw: {},
    });

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        server: "crm",
        tool: "create_lead",
        arguments: { email: "x@y.com" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SERVER_A.url,
        token: "tok-a",
        name: "crm",
      }),
      "create_lead",
      { email: "x@y.com" },
    );
  });

  it("upstream isError result is returned as 200 (not 500)", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "bad args" }],
      isError: true,
      raw: {},
      recordLinks: [
        {
          objectType: "opportunity",
          id: "opp-1",
          label: "Should Not Leak",
          url: "https://crm.example.com/object/opportunity/opp-1",
        },
      ],
    });

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        name: "crm__create_lead",
        arguments: {},
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.isError).toBe(true);
    expect(body.content).toEqual([{ type: "text", text: "bad args" }]);
    expect(body.recordLinks).toBeUndefined();
  });

  it("upstream transport failure → 502 with no unhandled throw", async () => {
    mockCallTool.mockRejectedValue(
      new McpTransportError("connection refused", "crm"),
    );

    const res = await handler(
      event(CALL_PATH, {
        agentId: "ag1",
        name: "crm__create_lead",
        arguments: {},
      }),
    );
    expect(res.statusCode).toBe(502);
    expect(parse(res).error).toContain("connection refused");
  });

  it("tools/list skips a broken server but still returns 200", async () => {
    mockBuildMcpConfigs.mockResolvedValue([
      SERVER_A,
      { name: "broken", url: "https://broken", transport: "streamable-http" },
    ]);
    mockListTools
      .mockResolvedValueOnce([{ name: "create_lead" }])
      .mockRejectedValueOnce(new McpTransportError("boom", "broken"));

    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      "crm__create_lead",
    ]);
    expect(body.errors).toEqual([
      { server: "broken", error: "boom", kind: "transport" },
    ]);
  });

  it("missing/invalid idToken → 401", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(401);
  });

  it("non-cognito auth → 401", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "p1",
      tenantId: "t1",
      email: "svc@example.com",
      authType: "api_key",
      agentId: null,
    });
    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(401);
  });

  it("authenticated non-member (no tenant resolved) → 403", async () => {
    mockSelectLimit.mockReset();
    mockSelectLimit.mockReturnValueOnce([]); // no user row
    const res = await handler(event(LIST_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(403);
  });

  it("agent not in caller's tenant → 404", async () => {
    mockSelectLimit.mockReset();
    mockSelectLimit
      .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
      .mockReturnValueOnce([]); // no agent in tenant
    const res = await handler(
      event(CALL_PATH, { agentId: "ag1", name: "crm__x" }),
    );
    expect(res.statusCode).toBe(404);
    expect(mockBuildMcpConfigs).not.toHaveBeenCalled();
  });

  it("400 on missing agentId", async () => {
    const res = await handler(event(LIST_PATH, {}));
    expect(res.statusCode).toBe(400);
  });

  it("400 on missing tool name for tools/call", async () => {
    const res = await handler(event(CALL_PATH, { agentId: "ag1" }));
    expect(res.statusCode).toBe(400);
  });

  it("unknown route → 404", async () => {
    const res = await handler(
      event("/api/mcp/tools/bogus", { agentId: "ag1" }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("short-circuits OPTIONS with 204 before auth", async () => {
    const res = await handler(event(LIST_PATH, { agentId: "ag1" }, "OPTIONS"));
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("405 on non-POST method", async () => {
    const res = await handler(event(LIST_PATH, { agentId: "ag1" }, "GET"));
    expect(res.statusCode).toBe(405);
  });
});
