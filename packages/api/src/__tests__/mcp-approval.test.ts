/**
 * mcp-approval handler tests — happy paths, authz, and tenant isolation.
 *
 * SI-5 URL-swap coverage lives in `mcp-approval-url-swap.test.ts`; TTL
 * sweeper tests live in `mcp-approval-ttl-sweeper.test.ts`; mcp-configs
 * approved-filter coverage lives in
 * `../lib/__tests__/mcp-configs-approved-filter.test.ts`.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticate, mockServerRow, mockMemberRows, mockUpdate } =
  vi.hoisted(() => ({
    mockAuthenticate: vi.fn(),
    mockServerRow: vi.fn(),
    mockMemberRows: vi.fn(),
    mockUpdate: vi.fn(),
  }));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mockAuthenticate,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: (_shape?: unknown) => ({
      from: (table: { __kind: string }) => ({
        where: () => ({
          limit: () => {
            if (table.__kind === "tenant_mcp_servers") {
              const row = mockServerRow();
              return Promise.resolve(row ? [row] : []);
            }
            return Promise.resolve(mockMemberRows() as unknown[]);
          },
        }),
      }),
    }),
    update: (table: { __kind: string }) => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => {
          mockUpdate({ table: table.__kind, payload });
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    __kind: "tenant_mcp_servers",
    id: "tenantMcpServers.id",
    tenant_id: "tenantMcpServers.tenant_id",
    url: "tenantMcpServers.url",
    auth_config: "tenantMcpServers.auth_config",
    status: "tenantMcpServers.status",
  },
  tenantMembers: {
    __kind: "tenant_members",
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
    role: "tenantMembers.role",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => ({ _and: _args }),
  eq: (..._args: unknown[]) => ({ _eq: _args }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/mcp-approval.js";
// eslint-disable-next-line import/first
import { computeMcpUrlHash } from "../lib/mcp-server-hash.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const SERVER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ADMIN_USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function event(
  path: string,
  method = "POST",
  body: Record<string, unknown> | null = null,
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: { authorization: "Bearer token" },
    body: body ? JSON.stringify(body) : null,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({
    authType: "cognito",
    principalId: ADMIN_USER,
    tenantId: null,
    email: null,
    agentId: null,
  });
  mockServerRow.mockReturnValue({
    id: SERVER_ID,
    tenant_id: TENANT_A,
    url: "https://mcp.example/a",
    auth_config: { token: "tkn" },
    status: "pending",
  });
  mockMemberRows.mockReturnValue([{ role: "admin" }]);
});

describe("POST /approve", () => {
  it("happy path: flips status to approved and pins url_hash", async () => {
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.status).toBe("approved");
    expect(body.url_hash).toBe(
      computeMcpUrlHash("https://mcp.example/a", { token: "tkn" }),
    );
    expect(body.approved_by).toBe(ADMIN_USER);
    expect(body.approved_at).toBeTruthy();
    const lastUpdate = mockUpdate.mock.calls.at(-1)?.[0];
    expect(lastUpdate.table).toBe("tenant_mcp_servers");
    expect(lastUpdate.payload.status).toBe("approved");
    expect(lastUpdate.payload.approved_by).toBe(ADMIN_USER);
    expect(lastUpdate.payload.url_hash).toBe(body.url_hash);
  });

  it("403 when caller is not admin/owner", async () => {
    mockMemberRows.mockReturnValue([{ role: "member" }]);
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`),
    );
    expect(res.statusCode).toBe(403);
  });

  it("401 when auth fails", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`),
    );
    expect(res.statusCode).toBe(401);
  });

  it("404 when server does not exist", async () => {
    mockServerRow.mockReturnValue(null);
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`),
    );
    expect(res.statusCode).toBe(404);
  });

  it("404 when server belongs to a different tenant (isolation)", async () => {
    mockServerRow.mockReturnValue({
      id: SERVER_ID,
      tenant_id: TENANT_B,
      url: "https://mcp.other/a",
      auth_config: null,
      status: "pending",
    });
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`),
    );
    expect(res.statusCode).toBe(404);
  });

  it("400 on non-UUID serverId", async () => {
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/not-a-uuid/approve`),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /reject", () => {
  it("happy path: flips status to rejected and clears approval metadata", async () => {
    mockServerRow.mockReturnValue({
      id: SERVER_ID,
      tenant_id: TENANT_A,
      url: "https://mcp.example/a",
      auth_config: null,
      status: "approved",
    });
    const res = await handler(
      event(
        `/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/reject`,
        "POST",
        { reason: "duplicate of existing server" },
      ),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.status).toBe("rejected");
    expect(body.reason).toBe("duplicate of existing server");
    const lastUpdate = mockUpdate.mock.calls.at(-1)?.[0];
    expect(lastUpdate.payload.status).toBe("rejected");
    expect(lastUpdate.payload.url_hash).toBeNull();
    expect(lastUpdate.payload.approved_by).toBeNull();
    expect(lastUpdate.payload.approved_at).toBeNull();
  });

  it("truncates reason to 500 chars", async () => {
    const longReason = "x".repeat(800);
    const res = await handler(
      event(
        `/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/reject`,
        "POST",
        { reason: longReason },
      ),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.reason.length).toBe(500);
  });

  it("400 on malformed JSON body", async () => {
    const ev = event(
      `/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/reject`,
      "POST",
    );
    (ev as unknown as { body: string }).body = "{not-json";
    const res = await handler(ev);
    expect(res.statusCode).toBe(400);
  });
});

describe("method / route enforcement", () => {
  it("OPTIONS short-circuits without auth lookup", async () => {
    const res = await handler(
      event(
        `/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`,
        "OPTIONS",
      ),
    );
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("405 on GET", async () => {
    const res = await handler(
      event(`/api/tenants/${TENANT_A}/mcp-servers/${SERVER_ID}/approve`, "GET"),
    );
    expect(res.statusCode).toBe(405);
  });

  it("404 on unrelated path", async () => {
    const res = await handler(event(`/api/something/else`));
    expect(res.statusCode).toBe(404);
  });
});
