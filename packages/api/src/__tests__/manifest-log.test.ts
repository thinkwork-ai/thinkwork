/**
 * manifest-log handler tests (plan §U15).
 *
 * Covers the narrow runtime→API write surface: auth shape, UUID
 * validation, body-size cap, tenant isolation, 405/404 route hygiene.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTenantRow, mockInsertedRow, insertedValues, mockDeleteWhere } =
  vi.hoisted(() => ({
    mockTenantRow: vi.fn(),
    mockInsertedRow: vi.fn(),
    insertedValues: [] as Record<string, unknown>[],
    mockDeleteWhere: vi.fn(),
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
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          insertedValues.push(values);
          const row = mockInsertedRow();
          return Promise.resolve(row ? [row] : []);
        },
      }),
    }),
    delete: () => ({
      where: (...args: unknown[]) => Promise.resolve(mockDeleteWhere(...args)),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  resolvedCapabilityManifests: {
    id: "rcm.id",
    tenant_id: "rcm.tenant_id",
    created_at: "rcm.created_at",
  },
  tenants: { id: "tenants.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => ({ _eq: _args }),
  and: (...preds: unknown[]) => ({ _and: preds }),
  lt: (..._args: unknown[]) => ({ _lt: _args }),
  sql: Object.assign((..._args: unknown[]) => ({ _sql: _args }), {
    raw: (text: string) => ({ _raw: text }),
  }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/manifest-log.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_A = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_A = "33333333-3333-3333-3333-333333333333";
const USER_A = "44444444-4444-4444-4444-444444444444";
const THREAD_A = "55555555-5555-5555-5555-555555555555";
const TURN_A = "66666666-6666-6666-6666-666666666666";
const SPACE_A = "77777777-7777-7777-7777-777777777777";
const PROFILE_A = "88888888-8888-8888-8888-888888888888";

/** Minimal valid U11 (schema_version 2) manifest body. */
function v2Manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    resolved: {
      skills: ["greet"],
      builtInTools: [],
      mcpServers: [],
      piExtensions: [],
    },
    loaded: {
      skills: ["greet"],
      builtInTools: [],
      mcpServers: [],
      piExtensions: [],
    },
    ...overrides,
  };
}

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
  insertedValues.length = 0;
  process.env.API_AUTH_SECRET = "secret";
  mockTenantRow.mockReturnValue({ id: TENANT_A });
  mockInsertedRow.mockReturnValue({
    id: "rcm-1",
    created_at: new Date("2026-04-24T00:00:00Z"),
  });
  mockDeleteWhere.mockReturnValue(undefined);
});

describe("POST /api/runtime/manifests", () => {
  it("happy path: persists a v2 manifest + returns 201 with id", async () => {
    const res = await handler(
      ev({
        session_id: "sess-abc",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        template_id: TEMPLATE_A,
        user_id: USER_A,
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body as string);
    expect(body.id).toBe("rcm-1");
    expect(body.created_at).toBeTruthy();
  });

  it("accepts minimal payload (only session_id + tenant_id + v2 manifest_json)", async () => {
    const res = await handler(
      ev({
        session_id: "sess-min",
        tenant_id: TENANT_A,
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(201);
  });

  it("persists turn/context identity + fingerprint columns (U11)", async () => {
    const res = await handler(
      ev({
        session_id: "sess-ctx",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        thread_id: THREAD_A,
        thread_turn_id: TURN_A,
        space_id: SPACE_A,
        agent_profile_id: PROFILE_A,
        config_fingerprint: "fp-abc123",
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(insertedValues[0]).toMatchObject({
      thread_id: THREAD_A,
      thread_turn_id: TURN_A,
      space_id: SPACE_A,
      agent_profile_id: PROFILE_A,
      config_fingerprint: "fp-abc123",
    });
  });

  it("runs the 30-day retention sweep after a successful write (best-effort)", async () => {
    const res = await handler(
      ev({
        session_id: "sess-sweep",
        tenant_id: TENANT_A,
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it("a sweep failure never fails the write", async () => {
    mockDeleteWhere.mockImplementation(() => {
      throw new Error("delete blew up");
    });
    const res = await handler(
      ev({
        session_id: "sess-sweep-fail",
        tenant_id: TENANT_A,
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(201);
  });
});

describe("manifest_json shape (U11)", () => {
  it.each([
    ["shapeless empty object", {}],
    ["wrong schema_version", { schema_version: 1, resolved: {}, loaded: {} }],
    ["missing resolved", { schema_version: 2, loaded: {} }],
    ["missing loaded", { schema_version: 2, resolved: {} }],
    ["resolved is an array", { schema_version: 2, resolved: [], loaded: {} }],
    [
      "gated is not an array",
      { schema_version: 2, resolved: {}, loaded: {}, gated: {} },
    ],
  ])("400 on %s", async (_name, manifest_json) => {
    const res = await handler(
      ev({ session_id: "s", tenant_id: TENANT_A, manifest_json }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 on cross-actor aggregates (single-actor scoping, KTD-7)", async () => {
    const res = await handler(
      ev({
        session_id: "s",
        tenant_id: TENANT_A,
        manifest_json: v2Manifest({
          users: [{ id: USER_A }, { id: TENANT_A }],
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("cross-actor");
  });

  it("400 when a context id is present but not a UUID", async () => {
    const res = await handler(
      ev({
        session_id: "s",
        tenant_id: TENANT_A,
        space_id: "not-a-uuid",
        manifest_json: v2Manifest(),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 when config_fingerprint is empty or oversized", async () => {
    for (const config_fingerprint of ["", "x".repeat(300)]) {
      const res = await handler(
        ev({
          session_id: "s",
          tenant_id: TENANT_A,
          config_fingerprint,
          manifest_json: v2Manifest(),
        }),
      );
      expect(res.statusCode).toBe(400);
    }
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
        manifest_json: v2Manifest(),
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
