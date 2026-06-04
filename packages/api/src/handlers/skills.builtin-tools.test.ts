import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  dbState,
  resetDbState,
  secretsSend,
  requireTenantMembershipMock,
  runFirecrawlScrapeMock,
} = vi.hoisted(() => {
  type DbState = {
    selectQueue: unknown[][];
    insertValues: unknown[];
  };
  const dbState: DbState = {
    selectQueue: [],
    insertValues: [],
  };
  return {
    dbState,
    resetDbState: () => {
      dbState.selectQueue = [];
      dbState.insertValues = [];
    },
    secretsSend: vi.fn(() => Promise.resolve({})),
    requireTenantMembershipMock: vi.fn(() =>
      Promise.resolve({ ok: true, userId: "user-1" }),
    ),
    runFirecrawlScrapeMock: vi.fn(() =>
      Promise.resolve({
        url: "https://example.com/",
        title: "Example",
        markdown: "# Example",
        metadata: { title: "Example" },
      }),
    ),
  };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve((dbState.selectQueue.shift() ?? []) as unknown[]),
      }),
    }),
    insert: () => ({
      values: (value: unknown) => {
        dbState.insertValues.push(value);
        return {
          returning: () => Promise.resolve([{ id: "builtin-web-extract" }]),
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => {
  const col = (name: string) => ({ name });
  return {
    agentSkills: {},
    skillRuns: {},
    tenantMcpServers: {},
    tenantMcpContextTools: {},
    tenantMcpAdminKeys: {},
    agentMcpServers: {},
    agentTemplateMcpServers: {},
    tenantBuiltinTools: {
      id: col("tenant_builtin_tools.id"),
      tenant_id: col("tenant_builtin_tools.tenant_id"),
      tool_slug: col("tenant_builtin_tools.tool_slug"),
      provider: col("tenant_builtin_tools.provider"),
      enabled: col("tenant_builtin_tools.enabled"),
      config: col("tenant_builtin_tools.config"),
      secret_ref: col("tenant_builtin_tools.secret_ref"),
      last_tested_at: col("tenant_builtin_tools.last_tested_at"),
      created_at: col("tenant_builtin_tools.created_at"),
      updated_at: col("tenant_builtin_tools.updated_at"),
    },
    connections: {},
    connectProviders: {},
    users: {},
    auditOutbox: {},
    COMPLIANCE_EVENT_TYPES: [],
    COMPLIANCE_ACTOR_TYPES: [],
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: (...args: unknown[]) => ({ sql: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: secretsSend })),
  CreateSecretCommand: vi.fn((input) => ({
    name: "CreateSecretCommand",
    input,
  })),
  UpdateSecretCommand: vi.fn((input) => ({
    name: "UpdateSecretCommand",
    input,
  })),
  DeleteSecretCommand: vi.fn((input) => ({
    name: "DeleteSecretCommand",
    input,
  })),
  GetSecretValueCommand: vi.fn((input) => ({
    name: "GetSecretValueCommand",
    input,
  })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {},
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: vi.fn(() => Promise.resolve({ sub: "user-1" })),
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: requireTenantMembershipMock,
}));

vi.mock("../lib/tenants.js", () => ({
  resolveTenantId: vi.fn(() => Promise.resolve("tenant-1")),
}));

vi.mock("../lib/builtin-tools/web-search.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/builtin-tools/web-search.js")
  >("../lib/builtin-tools/web-search.js");
  return {
    ...actual,
    loadTenantBuiltinTools: vi.fn(),
    resolveBuiltinToolApiKey: vi.fn(),
    runWebSearch: vi.fn(),
  };
});

vi.mock("../lib/builtin-tools/web-extract.js", () => ({
  runFirecrawlScrape: runFirecrawlScrapeMock,
}));

function event(
  path: string,
  method: string,
  body?: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: {
      authorization: "Bearer token",
      "x-tenant-slug": "acme",
    },
    requestContext: {
      http: {
        method,
        path,
        sourceIp: "",
        userAgent: "",
      },
    } as APIGatewayProxyEventV2["requestContext"],
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

describe("built-in tools handler", () => {
  beforeEach(() => {
    resetDbState();
    secretsSend.mockClear();
    requireTenantMembershipMock.mockClear();
    runFirecrawlScrapeMock.mockClear();
  });

  it("configures Firecrawl-backed Web Extraction as a credentialed built-in", async () => {
    const { handler } = await import("./skills.js");

    dbState.selectQueue.push([]);
    const res = await handler(
      event("/api/skills/builtin-tools/web-extract", "PUT", {
        provider: "firecrawl",
        enabled: true,
        apiKey: "fc-test-key",
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      id: "builtin-web-extract",
      toolSlug: "web-extract",
      created: true,
    });
    expect(secretsSend).toHaveBeenCalledTimes(1);
    expect(dbState.insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      tool_slug: "web-extract",
      provider: "firecrawl",
      enabled: true,
      secret_ref: "thinkwork/dev/tenant/tenant-1/builtin/web-extract",
    });
  });

  it("rejects unsupported Web Extraction providers", async () => {
    const { handler } = await import("./skills.js");

    const res = await handler(
      event("/api/skills/builtin-tools/web-extract", "PUT", {
        provider: "exa",
        enabled: true,
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body as string).error).toContain(
      "provider must be one of firecrawl",
    );
    expect(dbState.insertValues).toEqual([]);
  });

  it("tests Firecrawl-backed Web Extraction with a supplied API key", async () => {
    const { handler } = await import("./skills.js");

    const res = await handler(
      event("/api/skills/builtin-tools/web-extract/test", "POST", {
        provider: "firecrawl",
        apiKey: "fc-test-key",
        url: "https://example.com/docs",
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      ok: true,
      provider: "firecrawl",
      resultCount: 1,
    });
    expect(runFirecrawlScrapeMock).toHaveBeenCalledWith({
      provider: "firecrawl",
      apiKey: "fc-test-key",
      url: "https://example.com/docs",
    });
  });
});
