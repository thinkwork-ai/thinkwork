import { describe, expect, it, vi } from "vitest";
import {
  buildEvidenceArguments,
  collectGovernedConnectorEvidence,
  selectEvidenceTool,
  unwrapGatewayResult,
} from "./gateway-evidence.js";

describe("AgentCore Gateway evidence", () => {
  it("unwraps the MCP text response without accepting a JSON-RPC error", () => {
    expect(
      unwrapGatewayResult({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ connector: "twenty--crm", tools: [] }),
            },
          ],
        },
      }),
    ).toEqual({ connector: "twenty--crm", tools: [] });
    expect(() =>
      unwrapGatewayResult({ error: { code: -32000, message: "denied" } }),
    ).toThrow(/rejected/);
  });

  it("selects an opportunity read tool and builds bounded optional arguments", () => {
    const tool = selectEvidenceTool(
      [
        { name: "find_many_people", description: "Search people records" },
        {
          name: "find_many_opportunities",
          description: "Search opportunity records",
        },
      ],
      "Create a sales rep review from our CRM opportunities",
    );
    expect(tool.name).toBe("find_many_opportunities");
    expect(
      buildEvidenceArguments({
        type: "object",
        properties: {
          limit: { type: "integer" },
          filter: { type: "object" },
        },
      }),
    ).toEqual({ limit: 50 });
  });

  it("prefers opportunity records over layers and supplies a non-empty select", () => {
    const tool = selectEvidenceTool(
      [
        {
          name: "find_many_opportunity_layers",
          description: "Find opportunity layer records",
        },
        {
          name: "find_many_opportunities",
          description: "Find opportunity records",
        },
      ],
      "List CRM opportunity records for Eric Odom",
    );
    expect(tool.name).toBe("find_many_opportunities");
    expect(
      buildEvidenceArguments({
        type: "object",
        required: ["select", "offset"],
        properties: {
          select: { type: "array", items: { type: "string" } },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      }),
    ).toEqual({
      select: [
        "id",
        "name",
        "stage",
        "amount",
        "closeDate",
        "owner",
        "company",
      ],
      limit: 50,
      offset: 0,
    });
  });

  it("fails closed when a required provider argument cannot be derived", () => {
    expect(() =>
      buildEvidenceArguments({
        type: "object",
        required: ["dangerous_provider_expression"],
        properties: { dangerous_provider_expression: { type: "string" } },
      }),
    ).toThrow(/unsupported arguments/);
  });

  it("performs exact list then call JSON-RPC operations with fresh assertions", async () => {
    const mintAssertion = vi.fn(async () => ({
      token: "turn-jwt",
      expiresAt: 2_000_000_000,
      jti: "jti",
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init",
            result: { protocolVersion: "2025-03-26" },
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "gateway-session-1" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "0",
            result: {
              tools: [
                { name: "target-generated___list_connector_tools" },
                { name: "target-generated___call_connector_tool" },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    connector: "generic--crm",
                    tools: [
                      {
                        name: "find_many_opportunities",
                        inputSchema: {
                          type: "object",
                          properties: { limit: { type: "integer" } },
                        },
                      },
                    ],
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "2",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    connector: "generic--crm",
                    tool: "find_many_opportunities",
                    result: { opportunities: [{ name: "Acme" }] },
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const result = await collectGovernedConnectorEvidence({
      profile: {
        gatewayUrl: "https://gateway.example.com/mcp",
        gatewayTargetName: "ThinkworkDevOwnerProof",
      },
      deps: { mintAssertion, fetch },
      tenantId: "tenant-1",
      turnId: "turn-1",
      connector: "generic--crm",
      query: "Create a sales rep review from CRM opportunities",
    });

    expect(result).toMatchObject({
      connector: "generic--crm",
      tool: "find_many_opportunities",
      evidence: { result: { opportunities: [{ name: "Acme" }] } },
    });
    expect(mintAssertion).toHaveBeenCalledTimes(1);
    expect(mintAssertion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ operation: "gateway_session" }),
    );
    const sessionHeaders = fetch.mock.calls
      .slice(1)
      .map(
        (call) =>
          (call[1]?.headers as Record<string, string>)["mcp-session-id"],
      );
    expect(new Set(sessionHeaders).size).toBe(1);
    expect(sessionHeaders[0]).toBe("gateway-session-1");
    const fifthBody = JSON.parse(String(fetch.mock.calls[4]?.[1]?.body));
    expect(fifthBody.params).toEqual({
      name: "target-generated___call_connector_tool",
      arguments: {
        connector: "generic--crm",
        query: "Create a sales rep review from CRM opportunities",
        tool: "find_many_opportunities",
        arguments: { limit: 50 },
      },
    });
  });

  it("uses the deterministic Twenty opportunity recipe without schema discovery", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init",
            result: { protocolVersion: "2025-03-26" },
          }),
          { status: 200, headers: { "mcp-session-id": "session-1" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "catalog",
            result: {
              tools: [
                { name: "target___list_connector_tools" },
                { name: "target___call_connector_tool" },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "call",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ opportunities: [{ name: "Acme" }] }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await collectGovernedConnectorEvidence({
      profile: {
        gatewayUrl: "https://gateway.example.com/mcp",
        gatewayTargetName: "target",
      },
      deps: {
        mintAssertion: async () => ({
          token: "token",
          expiresAt: 2_000_000_000,
          jti: "jti",
        }),
        fetch,
      },
      tenantId: "tenant-1",
      turnId: "turn-1",
      connector: "twenty--crm",
      query: "List CRM opportunity records for Eric Odom",
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    const callBody = JSON.parse(String(fetch.mock.calls[3]?.[1]?.body));
    expect(callBody.params.arguments).toMatchObject({
      connector: "twenty--crm",
      tool: "find_many_opportunities",
      arguments: {
        limit: 20,
        offset: 0,
        select: expect.arrayContaining(["name", "stage", "amount", "owner"]),
      },
    });
  });

  it("fails closed when a provider wraps an error in successful MCP content", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          result: { protocolVersion: "2025-03-26" },
        }),
        { status: 200, headers: { "mcp-session-id": "session-1" } },
      ),
      new Response(null, { status: 202 }),
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "catalog",
          result: {
            tools: [
              { name: "target___list_connector_tools" },
              { name: "target___call_connector_tool" },
            ],
          },
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "list",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  tools: [
                    {
                      name: "find_many_opportunities",
                      inputSchema: {
                        type: "object",
                        required: ["select"],
                        properties: {
                          select: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  ],
                }),
              },
            ],
          },
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "call",
          result: {
            content: [{ type: "text", text: "Select is required." }],
          },
        }),
        { status: 200 },
      ),
    ];
    const fetch = vi.fn(async () => responses.shift()!);

    await expect(
      collectGovernedConnectorEvidence({
        profile: {
          gatewayUrl: "https://gateway.example.com/mcp",
          gatewayTargetName: "target",
        },
        deps: {
          mintAssertion: async () => ({
            token: "token",
            expiresAt: 2_000_000_000,
            jti: "jti",
          }),
          fetch,
        },
        tenantId: "tenant-1",
        turnId: "turn-1",
        connector: "generic--crm",
        query: "List CRM opportunity records",
      }),
    ).rejects.toThrow(/unusable evidence/);
  });
});
