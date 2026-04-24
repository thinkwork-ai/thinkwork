/**
 * manifest-log handler tests (plan §U15).
 *
 * Covers the narrow runtime→API write surface: auth shape, UUID
 * validation, body-size cap, tenant isolation, 405/404 route hygiene.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTenantRow, mockInsertedRow } = vi.hoisted(() => ({
  mockTenantRow: vi.fn(),
  mockInsertedRow: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const row = mockTenantRow();
            return Promise.resolve(row ? [row] : []);
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => {
          const row = mockInsertedRow();
          return Promise.resolve(row ? [row] : []);
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  resolvedCapabilityManifests: {
    id: "rcm.id",
    created_at: "rcm.created_at",
  },
  tenants: { id: "tenants.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => ({ _eq: _args }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/manifest-log.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_A = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_A = "33333333-3333-3333-3333-333333333333";
const USER_A = "44444444-4444-4444-4444-444444444444";

function ev(
  body: unknown,
  overrides: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: overrides.path ?? "/api/runtime/manifests",
    requestContext: {
      http: { method: overrides.method ?? "POST" },
    },
    headers: overrides.headers ?? { authorization: "Bearer secret" },
    body:
      typeof body === "string"
        ? body
        : body === undefined
          ? null
          : JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_AUTH_SECRET = "secret";
  mockTenantRow.mockReturnValue({ id: TENANT_A });
  mockInsertedRow.mockReturnValue({
    id: "rcm-1",
    created_at: new Date("2026-04-24T00:00:00Z"),
  });
});

describe("POST /api/runtime/manifests", () => {
  it("happy path: persists manifest + returns 201 with id", async () => {
    const res = await handler(
      ev({
        session_id: "sess-abc",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        template_id: TEMPLATE_A,
        user_id: USER_A,
        manifest_json: {
          skills: [{ slug: "greet", version: "1.0.0", source: "builtin" }],
          tools: [],
          mcp_servers: [],
          workspace_files: [],
          blocks: { tenant_disabled_builtins: [], template_blocked_tools: [] },
          runtime_version: "v1.0.0",
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.id).toBe("rcm-1");
    expect(body.created_at).toBeTruthy();
  });

  it("accepts minimal payload (only session_id + tenant_id + manifest_json)", async () => {
    const res = await handler(
      ev({
        session_id: "sess-min",
        tenant_id: TENANT_A,
        manifest_json: { runtime_version: "v1.0.0" },
      }),
    );
    expect(res.statusCode).toBe(201);
  });
});

describe("auth", () => {
  it("401 without Bearer token", async () => {
    const res = await handler(
      ev(
        { session_id: "s", tenant_id: TENANT_A, manifest_json: {} },
        {
          headers: {},
        },
      ),
    );
    expect(res.statusCode).toBe(401);
  });

  it("401 with wrong secret", async () => {
    const res = await handler(
      ev(
        { session_id: "s", tenant_id: TENANT_A, manifest_json: {} },
        {
          headers: { authorization: "Bearer WRONG" },
        },
      ),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("request validation", () => {
  it("400 when session_id is missing", async () => {
    const res = await handler(ev({ tenant_id: TENANT_A, manifest_json: {} }));
    expect(res.statusCode).toBe(400);
  });

  it("400 when tenant_id is not a UUID", async () => {
    const res = await handler(
      ev({ session_id: "s", tenant_id: "not-a-uuid", manifest_json: {} }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 when agent_id is present but not a UUID", async () => {
    const res = await handler(
      ev({
        session_id: "s",
        tenant_id: TENANT_A,
        agent_id: "not-a-uuid",
        manifest_json: {},
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 when manifest_json is missing", async () => {
    const res = await handler(ev({ session_id: "s", tenant_id: TENANT_A }));
    expect(res.statusCode).toBe(400);
  });

  it("400 when manifest_json is an array, not an object", async () => {
    const res = await handler(
      ev({ session_id: "s", tenant_id: TENANT_A, manifest_json: [] }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 on invalid JSON body", async () => {
    const res = await handler(ev("{not-json"));
    expect(res.statusCode).toBe(400);
  });

  it("413 when body exceeds 256 KB cap", async () => {
    const big = "x".repeat(300 * 1024);
    const res = await handler(ev(big));
    expect(res.statusCode).toBe(413);
  });

  it("400 when session_id exceeds 256 chars", async () => {
    const res = await handler(
      ev({
        session_id: "x".repeat(300),
        tenant_id: TENANT_A,
        manifest_json: {},
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("404 when tenant_id does not exist", async () => {
    mockTenantRow.mockReturnValue(null);
    const res = await handler(
      ev({
        session_id: "s",
        tenant_id: TENANT_A,
        manifest_json: { runtime_version: "v1" },
      }),
    );
    expect(res.statusCode).toBe(404);
  });
});

describe("route + method hygiene", () => {
  it("OPTIONS returns 204", async () => {
    const res = await handler(ev(undefined, { method: "OPTIONS" }));
    expect(res.statusCode).toBe(204);
  });

  it("405 on GET", async () => {
    const res = await handler(ev(undefined, { method: "GET" }));
    expect(res.statusCode).toBe(405);
  });

  it("404 on unrelated path", async () => {
    const res = await handler(ev({}, { path: "/api/runtime/other" }));
    expect(res.statusCode).toBe(404);
  });
});
