/**
 * capability-catalog-list handler tests (plan §U15 pt 3/3).
 *
 * Narrow GET endpoint — no DB writes; pure read + shape. Validates:
 *  - Bearer auth (401 missing / wrong secret).
 *  - Query parameter validation (type + source).
 *  - Route + method hygiene (OPTIONS 204, POST 405, wrong path 404).
 *  - Happy path returns sorted slugs + count + ISO version.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSlugRows, mockVersionRows } = vi.hoisted(() => ({
  mockSlugRows: vi.fn(),
  mockVersionRows: vi.fn(),
}));

// The handler runs two selects: one for the slug list, one for the
// version (max(updated_at)). Sequence the mock to return each in turn.
let _selectCall = 0;
vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          _selectCall += 1;
          const rows = _selectCall === 1 ? mockSlugRows() : mockVersionRows();
          return Promise.resolve((rows as unknown[]) ?? []);
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityCatalog: {
    slug: "capability_catalog.slug",
    type: "capability_catalog.type",
    source: "capability_catalog.source",
    updated_at: "capability_catalog.updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  max: (col: unknown) => ({ _max: col }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/capability-catalog-list.js";

function ev(
  overrides: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    qs?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: overrides.path ?? "/api/runtime/capability-catalog",
    requestContext: {
      http: { method: overrides.method ?? "GET" },
    },
    headers: overrides.headers ?? { authorization: "Bearer secret" },
    queryStringParameters: overrides.qs ?? {
      type: "tool",
      source: "builtin",
    },
    body: null,
  } as unknown as APIGatewayProxyEventV2;
}

const EXAMPLE_DATE = new Date("2026-04-24T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  _selectCall = 0;
  process.env.API_AUTH_SECRET = "secret";
  mockSlugRows.mockReturnValue([
    { slug: "browser_automation" },
    { slug: "execute_code" },
    { slug: "web_search" },
    { slug: "recall" },
  ]);
  mockVersionRows.mockReturnValue([{ version: EXAMPLE_DATE }]);
});

describe("GET /api/runtime/capability-catalog", () => {
  it("happy path: returns sorted slugs + count + version", async () => {
    const res = await handler(ev());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.slugs).toEqual([
      "browser_automation",
      "execute_code",
      "recall",
      "web_search",
    ]);
    expect(body.count).toBe(4);
    expect(body.version).toBe(EXAMPLE_DATE.toISOString());
    expect(body.type).toBe("tool");
    expect(body.source).toBe("builtin");
  });

  it("empty catalog returns empty slug list + 0 count + empty version", async () => {
    mockSlugRows.mockReturnValue([]);
    mockVersionRows.mockReturnValue([{ version: null }]);
    const res = await handler(ev());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.slugs).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.version).toBe("");
  });
});

describe("auth", () => {
  it("401 when bearer missing", async () => {
    const res = await handler(ev({ headers: {} }));
    expect(res.statusCode).toBe(401);
  });

  it("401 with wrong secret", async () => {
    const res = await handler(
      ev({ headers: { authorization: "Bearer WRONG" } }),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("validation", () => {
  it("400 when type is missing", async () => {
    const res = await handler(ev({ qs: { source: "builtin" } }));
    expect(res.statusCode).toBe(400);
  });

  it("400 when type is not in the allowed set", async () => {
    const res = await handler(
      ev({ qs: { type: "weapon", source: "builtin" } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("400 when source is missing", async () => {
    const res = await handler(ev({ qs: { type: "tool" } }));
    expect(res.statusCode).toBe(400);
  });

  it("400 when source is not in the allowed set", async () => {
    const res = await handler(ev({ qs: { type: "tool", source: "builtins" } }));
    expect(res.statusCode).toBe(400);
  });
});

describe("method + route hygiene", () => {
  it("OPTIONS returns 204 without auth lookup", async () => {
    const res = await handler(ev({ method: "OPTIONS", headers: {} }));
    expect(res.statusCode).toBe(204);
  });

  it("405 on POST", async () => {
    const res = await handler(ev({ method: "POST" }));
    expect(res.statusCode).toBe(405);
  });

  it("404 on unrelated path", async () => {
    const res = await handler(ev({ path: "/api/runtime/other" }));
    expect(res.statusCode).toBe(404);
  });
});
