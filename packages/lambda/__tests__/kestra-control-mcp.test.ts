import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { KestraApiError } from "../kestra-control-client.js";
import { createKestraControlMcpHandler } from "../kestra-control-mcp.js";

function makeEvent(
  body: unknown,
  opts: { authHeader?: string; method?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /mcp/kestra",
    rawPath: "/mcp/kestra",
    rawQueryString: "",
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
    requestContext: {
      accountId: "123",
      apiId: "test",
      domainName: "test.example.com",
      domainPrefix: "test",
      http: {
        method: opts.method ?? "POST",
        path: "/mcp/kestra",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "POST /mcp/kestra",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseToolResult(body: string | undefined): {
  isError: boolean;
  payload: unknown;
} {
  const parsed = JSON.parse(body ?? "{}");
  const text = parsed.result.content[0].text;
  return {
    isError: parsed.result.isError,
    payload: JSON.parse(text),
  };
}

describe("Kestra control MCP Lambda", () => {
  const client = {
    namespacesList: vi.fn(),
    flowGet: vi.fn(),
    flowUpsert: vi.fn(),
    executionStart: vi.fn(),
    executionGet: vi.fn(),
    executionLogs: vi.fn(),
  };
  const handler = createKestraControlMcpHandler({
    bearerVerifier: () => true,
    clientFactory: async () => client,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const mock of Object.values(client)) {
      mock.mockReset();
    }
  });

  it("rejects requests without an accepted bearer when using the default verifier", async () => {
    const defaultHandler = createKestraControlMcpHandler({
      clientFactory: async () => client,
    });

    const response = await defaultHandler(
      makeEvent({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );

    expect(response.statusCode).toBe(401);
  });

  it("initialize returns Kestra control server info", async () => {
    const response = await handler(
      makeEvent({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").result.serverInfo).toEqual({
      name: "thinkwork-kestra-control",
      version: "0.1.0",
    });
  });

  it("tools/list returns the curated Kestra tool names", async () => {
    const response = await handler(
      makeEvent({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const body = JSON.parse(response.body ?? "{}");
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "kestra_namespaces_list",
        "kestra_flows_get",
        "kestra_flows_validate",
        "kestra_flows_upsert",
        "kestra_executions_start",
        "kestra_executions_get",
        "kestra_executions_logs",
        "kestra_plugins_search",
      ]),
    );
  });

  it("validates a simple supported flow without calling Kestra", async () => {
    const response = await handler(
      makeEvent({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "kestra_flows_validate",
          arguments: {
            source:
              "id: hello\nnamespace: thinkwork.ops\n\ntasks:\n  - id: log\n    type: io.kestra.plugin.core.log.Log\n    message: hi\n",
          },
        },
      }),
    );

    const result = parseToolResult(response.body);
    expect(result.isError).toBe(false);
    expect(result.payload).toMatchObject({
      valid: true,
      namespace: "thinkwork.ops",
      flowId: "hello",
    });
    expect(client.flowUpsert).not.toHaveBeenCalled();
  });

  it("rejects unsafe flow upserts before calling Kestra", async () => {
    const response = await handler(
      makeEvent({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "kestra_flows_upsert",
          arguments: {
            source:
              "id: unsafe\nnamespace: thinkwork.ops\n\ntasks:\n  - id: docker\n    type: io.kestra.plugin.docker.Run\n",
          },
        },
      }),
    );

    const result = parseToolResult(response.body);
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({
      error: "kestra_control_error",
    });
    expect(JSON.stringify(result.payload)).toContain("flow policy rejected");
    expect(client.flowUpsert).not.toHaveBeenCalled();
  });

  it("upserts a policy-approved flow and starts an execution", async () => {
    client.flowUpsert.mockResolvedValue({ id: "hello", revision: 1 });
    client.executionStart.mockResolvedValue({
      id: "exec-1",
      namespace: "thinkwork.ops",
      flowId: "hello",
      state: { current: "CREATED" },
    });

    const upsert = await handler(
      makeEvent({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "kestra_flows_upsert",
          arguments: {
            source:
              "id: hello\nnamespace: thinkwork.ops\n\ntasks:\n  - id: log\n    type: io.kestra.plugin.core.log.Log\n    message: hi\n",
          },
        },
      }),
    );
    const start = await handler(
      makeEvent({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "kestra_executions_start",
          arguments: {
            namespace: "thinkwork.ops",
            flowId: "hello",
            inputs: { greeting: "hi" },
          },
        },
      }),
    );

    expect(parseToolResult(upsert.body).payload).toMatchObject({
      namespace: "thinkwork.ops",
      flowId: "hello",
      flow: { revision: 1 },
    });
    expect(parseToolResult(start.body).payload).toMatchObject({
      namespace: "thinkwork.ops",
      flowId: "hello",
      execution: { id: "exec-1" },
    });
    expect(client.executionStart).toHaveBeenCalledWith(
      "thinkwork.ops",
      "hello",
      {
        greeting: "hi",
      },
    );
  });

  it("returns structured MCP tool errors for Kestra API failures", async () => {
    client.executionGet.mockRejectedValue(
      new KestraApiError({
        status: 503,
        method: "GET",
        path: "/api/v1/main/executions/exec-1",
        message: "Kestra API GET /api/v1/main/executions/exec-1 returned 503",
        bodyPreview: "service unavailable",
      }),
    );

    const response = await handler(
      makeEvent({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "kestra_executions_get",
          arguments: { executionId: "exec-1" },
        },
      }),
    );

    const result = parseToolResult(response.body);
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({
      error: "kestra_api_error",
      status: 503,
      path: "/api/v1/main/executions/exec-1",
    });
  });
});
