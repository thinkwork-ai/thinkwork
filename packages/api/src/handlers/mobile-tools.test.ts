import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  mockAuthenticate,
  mockSelectLimit,
  mockLoadTenantWebSearchConfig,
  mockRunWebSearch,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockLoadTenantWebSearchConfig: vi.fn(),
  mockRunWebSearch: vi.fn(),
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
    agents: {
      id: "agents.id",
      tenant_id: "agents.tenant_id",
      web_search: "agents.web_search",
      blocked_tools: "agents.blocked_tools",
    },
  },
}));

vi.mock("../lib/builtin-tools/web-search.js", () => ({
  loadTenantWebSearchConfig: mockLoadTenantWebSearchConfig,
  runWebSearch: mockRunWebSearch,
}));

import { handler } from "./mobile-tools";

function event(
  path: string,
  body: unknown,
  method = "POST",
): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method, path } },
    headers: { authorization: "Bearer tok" },
    body: JSON.stringify(body),
    rawPath: path,
  } as unknown as APIGatewayProxyEventV2;
}

function parse(res: { body?: unknown }) {
  return JSON.parse(res.body as string);
}

const PATH = "/api/mobile/tools/web-search";

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockSelectLimit.mockReset();
  mockLoadTenantWebSearchConfig.mockReset();
  mockRunWebSearch.mockReset();

  mockAuthenticate.mockResolvedValue({
    principalId: "p1",
    tenantId: null,
    email: "eric@example.com",
    authType: "cognito",
    agentId: null,
  });
  mockSelectLimit
    .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
    .mockReturnValueOnce([
      {
        id: "ag1",
        web_search: { enabled: true },
        blocked_tools: [],
      },
    ]);
  mockLoadTenantWebSearchConfig.mockResolvedValue({
    provider: "exa",
    apiKey: "secret",
    config: null,
    secretRef: "secret-ref",
    toolSlug: "web-search",
  });
});

describe("mobile-tools handler", () => {
  it("runs web_search as a ThinkWork built-in tool without exposing secrets", async () => {
    mockRunWebSearch.mockResolvedValue([
      {
        title: "OpenAI News",
        url: "https://openai.com/news/",
        snippet: "Latest updates",
        raw: {},
      },
    ]);

    const res = await handler(
      event(PATH, {
        agentId: "ag1",
        query: "OpenAI News",
        num_results: 3,
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mockRunWebSearch).toHaveBeenCalledWith({
      provider: "exa",
      apiKey: "secret",
      query: "OpenAI News",
      limit: 3,
    });
    const body = parse(res);
    expect(body.isError).toBe(false);
    expect(JSON.parse(body.content[0].text)).toMatchObject({
      ok: true,
      provider: "exa",
      query: "OpenAI News",
      result_count: 1,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("hides web_search when blocked for the agent", async () => {
    mockSelectLimit.mockReset();
    mockSelectLimit
      .mockReturnValueOnce([{ id: "u1", tenant_id: "t1" }])
      .mockReturnValueOnce([
        {
          id: "ag1",
          web_search: { enabled: true },
          blocked_tools: ["web_search"],
        },
      ]);

    const res = await handler(
      event(PATH, { agentId: "ag1", query: "OpenAI News" }),
    );

    expect(res.statusCode).toBe(404);
    expect(mockRunWebSearch).not.toHaveBeenCalled();
  });

  it("requires a configured tenant provider", async () => {
    mockLoadTenantWebSearchConfig.mockResolvedValue(null);

    const res = await handler(
      event(PATH, { agentId: "ag1", query: "OpenAI News" }),
    );

    expect(res.statusCode).toBe(404);
    expect(parse(res).error).toContain("not configured");
  });

  it("rejects unauthenticated callers", async () => {
    mockAuthenticate.mockResolvedValue(null);

    const res = await handler(
      event(PATH, { agentId: "ag1", query: "OpenAI News" }),
    );

    expect(res.statusCode).toBe(401);
  });

  it("short-circuits OPTIONS with 204 before auth", async () => {
    const res = await handler(event(PATH, {}, "OPTIONS"));
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
