import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createHarnessCapabilityMcpHandler,
  type HarnessCapabilityClaims,
  type HarnessCapabilityContext,
} from "./harness-capability-mcp.js";
import type { McpServerConfig } from "../lib/mcp-configs.js";
import type { McpToolDefinition } from "../lib/mcp-client-call.js";

const CLAIMS: HarnessCapabilityClaims = {
  sub: "user-1",
  participant_id: "user-1",
  tenant_id: "tenant-1",
  agent_id: "agent-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  session_generation: 1,
};

const CONTEXT: HarnessCapabilityContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  triggeringMessageId: "message-1",
  spaceId: "space-1",
};

function event(
  path: string,
  body: Record<string, unknown>,
  authorization = "Bearer exact-user-token",
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { authorization },
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
  };
}

function capabilityBody(body: Record<string, unknown>) {
  return { tenant_id: CLAIMS.tenant_id, ...body };
}

function deps() {
  const ledgerRows: Array<Record<string, unknown>> = [];
  return {
    ledgerRows,
    verifyAccessToken: vi.fn(() => CLAIMS),
    resolveCanonicalContext: vi.fn<
      (
        claims: HarnessCapabilityClaims,
      ) => Promise<HarnessCapabilityContext | null>
    >(async () => CONTEXT),
    resolveMcpConfigs: vi.fn<() => Promise<McpServerConfig[]>>(async () => [
      {
        name: "twenty--crm",
        url: "https://mcp.example.test/twenty",
        transport: "streamable-http" as const,
      },
      {
        name: "lastmile-data-catalog",
        url: "https://mcp.example.test/lastmile",
        transport: "streamable-http" as const,
      },
    ]),
    listTools: vi.fn<(config: McpServerConfig) => Promise<McpToolDefinition[]>>(
      async (config) => [
        {
          name: config.name === "twenty--crm" ? "get_tool_catalog" : "query",
          description: "Authorized tool",
          inputSchema: { type: "object" },
        },
      ],
    ),
    callTool: vi.fn(async () => ({
      content: [{ type: "text", text: "provider result" }],
      isError: false,
    })),
    ledgerStore: {
      append: vi.fn(async (row) => {
        ledgerRows.push(row);
        return { id: ledgerRows.length };
      }),
    },
    policyRevision: "policy-v1",
    now: vi.fn(() => 1_700_000_000_000),
  };
}

describe("Harness capability MCP target", () => {
  it("lists only the exact participant's canonically resolved connector tools", async () => {
    const injected = deps();
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/list", {
        tenant_id: CLAIMS.tenant_id,
        connector: "twenty--crm",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toEqual({
      connector: "twenty--crm",
      tools: [
        {
          name: "get_tool_catalog",
          description: "Authorized tool",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(injected.resolveCanonicalContext).toHaveBeenCalledWith(CLAIMS);
    expect(injected.resolveMcpConfigs).toHaveBeenNthCalledWith(
      1,
      CONTEXT,
      "probe",
    );
    expect(injected.resolveMcpConfigs).toHaveBeenNthCalledWith(
      2,
      CONTEXT,
      "resolve",
    );
    expect(injected.ledgerRows).toEqual([
      expect.objectContaining({
        event_type: "started",
        turn_id: "turn-1",
        principal_id: "user-1",
        policy_revision: "policy-v1",
        credential_owner_alias:
          "user:user-1:agentcore-identity:twenty--crm",
        input_preview: { connector: "twenty--crm" },
      }),
      expect.objectContaining({
        event_type: "completed",
        output_preview: {
          connector: "twenty--crm",
          toolCount: 1,
        },
      }),
    ]);
    expect(JSON.stringify(injected.ledgerRows)).not.toContain(
      "exact-user-token",
    );
  });

  it("records the LastMile tenant service owner separately from the acting user", async () => {
    const injected = deps();
    const handler = createHarnessCapabilityMcpHandler(injected);
    const response = await handler(
      event(
        "/agentcore/capabilities/mcp/tools/list",
        capabilityBody({ connector: "lastmile-data-catalog" }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(injected.ledgerRows).toEqual([
      expect.objectContaining({
        principal_type: "user",
        principal_id: "user-1",
        credential_owner_alias:
          "tenant:tenant-1:service:lastmile-data-catalog",
      }),
      expect.objectContaining({
        credential_owner_alias:
          "tenant:tenant-1:service:lastmile-data-catalog",
      }),
    ]);
  });

  it("collapses universal MCP catalog discovery into relevant direct tools", async () => {
    const injected = deps();
    injected.listTools.mockResolvedValueOnce([
      { name: "get_tool_catalog", inputSchema: { type: "object" } },
      { name: "learn_tools", inputSchema: { type: "object" } },
      { name: "execute_tool", inputSchema: { type: "object" } },
    ]);
    injected.callTool
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              catalog: {
                DATABASE_CRUD: [
                  {
                    name: "find_many_opportunities",
                    description: "Search opportunity records",
                  },
                  {
                    name: "find_many_people",
                    description: "Search people records",
                  },
                ],
              },
            }),
          },
        ],
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tools: [
                {
                  name: "find_many_opportunities",
                  description: "Search opportunity records",
                  inputSchema: {
                    $schema: "https://json-schema.org/draft/2020-12/schema",
                    type: "object",
                    properties: {
                      name: {
                        type: "string",
                        pattern: "secretly-enormous-provider-regex",
                      },
                    },
                  },
                },
              ],
            }),
          },
        ],
        isError: false,
      });
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event(
        "/agentcore/capabilities/mcp/tools/list",
        capabilityBody({
          connector: "twenty--crm",
          query: "List the last five open opportunities",
        }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toEqual({
      connector: "twenty--crm",
      tools: [
        {
          name: "find_many_opportunities",
          description: "Search opportunity records",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      ],
    });
    expect(injected.callTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "twenty--crm" }),
      "get_tool_catalog",
      { categories: ["DATABASE_CRUD"] },
      CONTEXT,
    );
    expect(injected.callTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "twenty--crm" }),
      "learn_tools",
      {
        toolNames: ["find_many_opportunities"],
        aspects: ["description", "schema"],
      },
      CONTEXT,
    );
  });

  it("maps an authorized direct facade tool back through execute_tool", async () => {
    const injected = deps();
    injected.listTools.mockResolvedValueOnce([
      { name: "get_tool_catalog", inputSchema: { type: "object" } },
      { name: "learn_tools", inputSchema: { type: "object" } },
      { name: "execute_tool", inputSchema: { type: "object" } },
    ]);
    injected.callTool
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              catalog: {
                DATABASE_CRUD: [
                  {
                    name: "find_many_opportunities",
                    description: "Search opportunity records",
                  },
                ],
              },
            }),
          },
        ],
        isError: false,
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "provider result" }],
        isError: false,
      });
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event(
        "/agentcore/capabilities/mcp/tools/call",
        capabilityBody({
          connector: "twenty--crm",
          query: "List the last five open opportunities",
          tool: "find_many_opportunities",
          arguments: { limit: 5 },
        }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toMatchObject({
      connector: "twenty--crm",
      tool: "find_many_opportunities",
    });
    expect(injected.callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "twenty--crm" }),
      "execute_tool",
      {
        toolName: "find_many_opportunities",
        arguments: { limit: 5 },
      },
      CONTEXT,
    );
  });

  it("rejects a direct facade tool that the current connector catalog does not expose", async () => {
    const injected = deps();
    injected.listTools.mockResolvedValueOnce([
      { name: "get_tool_catalog", inputSchema: { type: "object" } },
      { name: "learn_tools", inputSchema: { type: "object" } },
      { name: "execute_tool", inputSchema: { type: "object" } },
    ]);
    injected.callTool.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            catalog: {
              DATABASE_CRUD: [
                {
                  name: "find_many_opportunities",
                  description: "Search opportunity records",
                },
              ],
            },
          }),
        },
      ],
      isError: false,
    });
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event(
        "/agentcore/capabilities/mcp/tools/call",
        capabilityBody({
          connector: "twenty--crm",
          query: "Delete everything",
          tool: "delete_everything",
          arguments: {},
        }),
      ),
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body!)).toEqual({
      error: "tool_not_available",
    });
    expect(injected.callTool).not.toHaveBeenCalledWith(
      expect.anything(),
      "execute_tool",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not disclose server tools excluded by the participant assignment", async () => {
    const injected = deps();
    injected.resolveMcpConfigs.mockResolvedValueOnce([
      {
        name: "twenty--crm",
        url: "https://mcp.example.test/twenty",
        transport: "streamable-http" as const,
        tools: ["read_opportunities"],
      },
    ]);
    injected.listTools.mockResolvedValueOnce([
      { name: "read_opportunities", inputSchema: { type: "object" } },
      { name: "delete_everything", inputSchema: { type: "object" } },
    ]);
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event(
        "/agentcore/capabilities/mcp/tools/list",
        capabilityBody({ connector: "twenty--crm" }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!).tools).toEqual([
      { name: "read_opportunities", inputSchema: { type: "object" } },
    ]);
  });

  it("calls a connector tool after a fresh canonical resolution", async () => {
    const injected = deps();
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/call", {
        tenant_id: CLAIMS.tenant_id,
        connector: "twenty--crm",
        tool: "get_tool_catalog",
        arguments: { category: "opportunities" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toEqual({
      connector: "twenty--crm",
      tool: "get_tool_catalog",
      result: {
        content: [{ type: "text", text: "provider result" }],
        isError: false,
      },
    });
    expect(injected.resolveCanonicalContext).toHaveBeenCalledTimes(1);
    expect(injected.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "twenty--crm" }),
      "get_tool_catalog",
      { category: "opportunities" },
      CONTEXT,
    );
  });

  it("does not call a connector tool that is absent from the current tool surface", async () => {
    const injected = deps();
    injected.resolveMcpConfigs.mockResolvedValue([
      {
        name: "twenty--crm",
        url: "https://mcp.example.test/twenty",
        transport: "streamable-http" as const,
        tools: ["get_tool_catalog"],
      },
    ]);
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/call", {
        tenant_id: CLAIMS.tenant_id,
        connector: "twenty--crm",
        tool: "delete_everything",
        arguments: {},
      }),
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body!)).toEqual({
      error: "tool_not_available",
    });
    expect(injected.resolveMcpConfigs).toHaveBeenCalledTimes(1);
    expect(injected.resolveMcpConfigs).toHaveBeenCalledWith(CONTEXT, "probe");
    expect(injected.listTools).not.toHaveBeenCalled();
    expect(injected.callTool).not.toHaveBeenCalled();
  });

  it("fails before connector credential resolution when the turn tuple is stale", async () => {
    const injected = deps();
    injected.resolveCanonicalContext = vi.fn(async () => null);
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/call", {
        tenant_id: CLAIMS.tenant_id,
        connector: "twenty--crm",
        tool: "get_tool_catalog",
        arguments: {},
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(injected.resolveMcpConfigs).not.toHaveBeenCalled();
    expect(injected.callTool).not.toHaveBeenCalled();
  });

  it("rejects an OBO token without the complete turn-bound identity tuple", async () => {
    const injected = deps();
    injected.verifyAccessToken.mockReturnValueOnce({
      ...CLAIMS,
      turn_id: undefined,
    } as unknown as HarnessCapabilityClaims);
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/list", {
        tenant_id: CLAIMS.tenant_id,
        connector: "twenty--crm",
      }),
    );

    expect(response.statusCode).toBe(401);
    expect(injected.resolveCanonicalContext).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied identity overrides", async () => {
    const injected = deps();
    const handler = createHarnessCapabilityMcpHandler(injected);
    const request = event("/agentcore/capabilities/mcp/tools/list", {
      tenant_id: CLAIMS.tenant_id,
      connector: "twenty--crm",
    });
    request.headers["x-thinkwork-user-id"] = "user-2";

    const response = await handler(request);

    expect(response.statusCode).toBe(400);
    expect(injected.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a tenant input that does not match the signed principal tag", async () => {
    const injected = deps();
    const handler = createHarnessCapabilityMcpHandler(injected);

    const response = await handler(
      event("/agentcore/capabilities/mcp/tools/list", {
        tenant_id: "tenant-2",
        connector: "twenty--crm",
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(injected.resolveCanonicalContext).not.toHaveBeenCalled();
    expect(injected.resolveMcpConfigs).not.toHaveBeenCalled();
  });
});
