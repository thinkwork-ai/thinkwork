import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const { mockAuthenticate, mockSend, mockUserRows } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSend: vi.fn(),
  mockUserRows: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockUserRows() as unknown[]),
        }),
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  schema: { users: { email: "users.email" } },
}));

vi.mock("@aws-sdk/client-bedrock-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@aws-sdk/client-bedrock-runtime")
  >("@aws-sdk/client-bedrock-runtime");
  return {
    ...actual,
    BedrockRuntimeClient: vi
      .fn()
      .mockImplementation(() => ({ send: mockSend })),
  };
});

import { handler } from "./model-converse";

const MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

function event(
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: "POST" } },
    headers: { authorization: "Bearer tok" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
    }),
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

function converseOutput(content: unknown[], stopReason = "end_turn") {
  return {
    output: { message: { role: "assistant", content } },
    stopReason,
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    $metadata: {},
  };
}

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockSend.mockReset();
  mockUserRows.mockReset();
  mockAuthenticate.mockResolvedValue({
    principalId: "p1",
    tenantId: null, // federated user — null JWT claim
    email: "Eric@Example.com",
    authType: "cognito",
    agentId: null,
  });
  mockUserRows.mockReturnValue([
    { id: "u1", email: "eric@example.com", tenant_id: "t1" },
  ]);
});

afterEach(() => vi.clearAllMocks());

describe("model-converse handler", () => {
  it("returns a mapped Converse response for a valid request", async () => {
    mockSend.mockResolvedValue(converseOutput([{ text: "hello" }]));
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({
      text: "hello",
      toolCalls: [],
      stopReason: "end",
      usage: { inputTokens: 10, outputTokens: 4 },
      modelId: MODEL,
    });
  });

  it("maps toolUse blocks to toolCalls", async () => {
    mockSend.mockResolvedValue(
      converseOutput(
        [{ toolUse: { toolUseId: "t1", name: "echo", input: { x: 1 } } }],
        "tool_use",
      ),
    );
    const res = await handler(event());
    const body = JSON.parse(res.body as string);
    expect(body.stopReason).toBe("tool_use");
    expect(body.toolCalls).toEqual([
      { id: "t1", name: "echo", arguments: { x: 1 } },
    ]);
  });

  it("resolves tenant by email when the JWT tenantId is null", async () => {
    mockSend.mockResolvedValue(converseOutput([{ text: "ok" }]));
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    // the email lookup is what produced a tenant; a 200 proves it resolved
  });

  it("fails loud (400) on an un-prefixed model id; never calls Bedrock", async () => {
    const res = await handler(
      event({
        body: JSON.stringify({
          model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("fails loud (400) on a non-allowlisted model id", async () => {
    const res = await handler(
      event({
        body: JSON.stringify({
          model: "us.anthropic.claude-opus-4-1-v1:0",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("surfaces a Bedrock ValidationException as 502, not an empty-content 200", async () => {
    const err = new Error("Retry with an inference profile id");
    err.name = "ValidationException";
    mockSend.mockRejectedValue(err);
    const res = await handler(event());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body as string).error).toContain(
      "ValidationException",
    );
  });

  it("short-circuits OPTIONS with 204 before authenticating", async () => {
    const res = await handler(
      event({
        requestContext: { http: { method: "OPTIONS" } },
      } as Partial<APIGatewayProxyEventV2>),
    );
    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(event());
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for a non-cognito (apikey) caller", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "svc",
      tenantId: "t1",
      email: null,
      authType: "apikey",
      agentId: null,
    });
    const res = await handler(event());
    expect(res.statusCode).toBe(401);
  });

  it("fails closed (403) when the caller has no resolved tenant", async () => {
    mockUserRows.mockReturnValue([]); // no user row
    const res = await handler(event());
    expect(res.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const res = await handler(
      event({
        requestContext: { http: { method: "GET" } },
      } as Partial<APIGatewayProxyEventV2>),
    );
    expect(res.statusCode).toBe(405);
  });

  it("rejects an empty messages array", async () => {
    const res = await handler(
      event({ body: JSON.stringify({ model: MODEL, messages: [] }) }),
    );
    expect(res.statusCode).toBe(400);
  });
});
