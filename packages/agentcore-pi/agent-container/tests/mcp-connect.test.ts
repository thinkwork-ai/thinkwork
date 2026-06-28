import { describe, expect, it, vi } from "vitest";
import { createConnectMcpServer } from "../src/mcp-connect.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface FakeListing {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: { type: string };
  }>;
}

interface FakeClient {
  connect: (transport: Transport) => Promise<void>;
  listTools: (
    args: undefined,
    opts?: { timeout?: number },
  ) => Promise<FakeListing>;
  callTool: (
    args: { name: string; arguments: Record<string, unknown> },
    schema: unknown,
    opts?: { timeout?: number },
  ) => Promise<unknown>;
}

function makeFakeClient(
  tools: FakeListing["tools"],
  callResponse?: unknown,
): {
  client: FakeClient;
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn(async () => {});
  const listTools = vi.fn(async () => ({ tools }));
  const callTool = vi.fn(
    async () =>
      callResponse ?? {
        content: [{ type: "text", text: "ok" }],
      },
  );
  return {
    client: {
      connect: connect as unknown as FakeClient["connect"],
      listTools: listTools as unknown as FakeClient["listTools"],
      callTool: callTool as unknown as FakeClient["callTool"],
    },
    connect,
    listTools,
    callTool,
  };
}

function makeFakeTransport(): Transport & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => {});
  return {
    close,
    start: vi.fn(async () => {}) as unknown as Transport["start"],
    send: vi.fn(async () => {}) as unknown as Transport["send"],
  } as unknown as Transport & { close: ReturnType<typeof vi.fn> };
}

describe("createConnectMcpServer", () => {
  it("forwards URL + headers to the transport factory", async () => {
    const transport = makeFakeTransport();
    const fake = makeFakeClient([]);
    let capturedArgs:
      | { url: URL; headers: Record<string, string>; transport: string }
      | undefined;
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: (args) => {
        capturedArgs = args;
        return transport;
      },
      clientFactory: () => fake.client as never,
    });
    await factory({
      url: "https://mcp.example.com/api",
      headers: { Authorization: "Handle abc-123" },
      serverName: "demo",
      transport: "streamable-http",
    });
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!.url.toString()).toBe("https://mcp.example.com/api");
    expect(capturedArgs!.headers).toEqual({ Authorization: "Handle abc-123" });
    expect(capturedArgs!.transport).toBe("streamable-http");
  });

  it("defaults transport to streamable-http", async () => {
    const transport = makeFakeTransport();
    const fake = makeFakeClient([]);
    let capturedTransport: string | undefined;
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: (args) => {
        capturedTransport = args.transport;
        return transport;
      },
      clientFactory: () => fake.client as never,
    });
    await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(capturedTransport).toBe("streamable-http");
  });

  it("pushes a cleanup that closes the transport", async () => {
    const transport = makeFakeTransport();
    const fake = makeFakeClient([]);
    const cleanup: Array<() => Promise<void>> = [];
    const factory = createConnectMcpServer({
      cleanup,
      transportFactory: () => transport,
      clientFactory: () => fake.client as never,
    });
    await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(cleanup).toHaveLength(1);
    await cleanup[0]!();
    expect(transport.close).toHaveBeenCalled();
  });

  it("returns one AgentTool per server tool listed", async () => {
    const fake = makeFakeClient([
      {
        name: "search",
        description: "Search the corpus",
        inputSchema: { type: "object" },
      },
      {
        name: "fetch",
        description: "Fetch a URL",
      },
    ]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const tools = await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe("mcp_demo_search");
    expect(tools[1]?.name).toBe("mcp_demo_fetch");
  });

  it("keeps exposed MCP tool names below Bedrock toolUseId headroom", async () => {
    const fake = makeFakeClient([
      {
        name: "create_workflow_with_http_request_and_schedule_trigger",
        description: "Create a workflow",
      },
      {
        name: "create_workflow_with_http_request_and_manual_trigger",
        description: "Create a similar workflow",
      },
    ]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });

    const tools = await factory({
      url: "https://n8n.example.com/mcp-server/http",
      headers: {},
      serverName: "n8n--workflow-management",
    });

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toHaveLength(48);
    expect(tools[1]?.name).toHaveLength(48);
    expect(tools[0]?.name).not.toBe(tools[1]?.name);
    expect(tools[0]?.name).toMatch(/_[a-f0-9]{8}$/);
    expect(tools[1]?.name).toMatch(/_[a-f0-9]{8}$/);
  });

  it("respects toolWhitelist", async () => {
    const fake = makeFakeClient([
      { name: "search" },
      { name: "fetch" },
      { name: "secret" },
    ]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const tools = await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
      toolWhitelist: ["search"],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("mcp_demo_search");
  });

  it("invokes callTool with the chosen timeout", async () => {
    const fake = makeFakeClient([
      { name: "search", inputSchema: { type: "object" } },
    ]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
      callToolTimeoutMs: 5_000,
    });
    const [tool] = await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(tool).toBeDefined();
    await tool!.execute("call-1", { q: "ping" });
    expect(fake.callTool).toHaveBeenCalledWith(
      { name: "search", arguments: { q: "ping" } },
      undefined,
      { timeout: 5_000 },
    );
  });

  it("propagates listTools timeout override", async () => {
    const fake = makeFakeClient([]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
      listToolsTimeoutMs: 2_500,
    });
    await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(fake.listTools).toHaveBeenCalledWith(undefined, { timeout: 2_500 });
  });

  it("throws when callTool returns isError", async () => {
    const fake = makeFakeClient([{ name: "broken" }], {
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    await expect(tool!.execute("call-1", {})).rejects.toThrow(/boom/);
  });

  it("preserves text/html MCP resources as app descriptors", async () => {
    const fake = makeFakeClient([{ name: "dispatch_optimization_app" }], {
      content: [
        { type: "text", text: "Dispatch optimization app" },
        {
          type: "resource",
          resource: {
            uri: "ui://lastmile-dispatch/optimization",
            mimeType: "text/html;profile=mcp-app",
            text: "<!doctype html><title>Dispatch Optimization App</title><main>map</main>",
          },
        },
      ],
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://mcp-dev.lastmile-tei.com/dispatch",
      headers: {},
      serverName: "lastmile-dispatch",
    });

    const result = await tool!.execute("call-1", {});

    expect(result.details).toMatchObject({
      mcp_apps: [
        {
          uri: "ui://lastmile-dispatch/optimization",
          mimeType: "text/html",
          html: expect.stringContaining("<main>map</main>"),
          title: "Dispatch Optimization App",
          serverName: "lastmile-dispatch",
          toolName: "dispatch_optimization_app",
        },
      ],
    });
  });

  it("adds record links to successful supported MCP results", async () => {
    const fake = makeFakeClient([{ name: "find_many_opportunities" }], {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            opportunities: [
              {
                id: "c203680f-4d36-461b-b134-25aef43d62c5",
                name: "McPherson POC",
              },
            ],
          }),
        },
      ],
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://crm.example.com/mcp",
      headers: {},
      serverName: "twenty--crm",
      recordLinkHints: {
        schemaVersion: 1,
        source: "plugin-manifest",
        browserBaseUrl: "https://crm.example.com",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
            idFields: ["id"],
            labelFields: ["name"],
          },
        ],
      },
    });

    const result = await tool!.execute("call-1", {});
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("Record links:");
    expect(text).toContain(
      "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
    );
    expect(result.details).toMatchObject({
      recordLinks: [
        {
          objectType: "opportunity",
          id: "c203680f-4d36-461b-b134-25aef43d62c5",
          label: "McPherson POC",
          url: "https://crm.example.com/object/opportunity/c203680f-4d36-461b-b134-25aef43d62c5",
        },
      ],
    });
  });

  it("does not synthesize record links for MCP isError responses", async () => {
    const fake = makeFakeClient([{ name: "find_many_opportunities" }], {
      content: [
        {
          type: "text",
          text: JSON.stringify({ id: "opp-1", objectType: "opportunity" }),
        },
      ],
      isError: true,
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://crm.example.com/mcp",
      headers: {},
      serverName: "twenty--crm",
      recordLinkHints: {
        schemaVersion: 1,
        source: "plugin-manifest",
        browserBaseUrl: "https://crm.example.com",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
            idFields: ["id"],
          },
        ],
      },
    });

    await expect(tool!.execute("call-1", {})).rejects.toThrow(/opp-1/);
  });

  it("connect failure surfaces as a rejected promise (caller handles)", async () => {
    const transport = makeFakeTransport();
    const client: FakeClient = {
      connect: async () => {
        throw new Error("network error");
      },
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
    };
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => transport,
      clientFactory: () => client as never,
    });
    await expect(
      factory({
        url: "https://mcp.example.com/",
        headers: {},
        serverName: "demo",
      }),
    ).rejects.toThrow(/network error/);
  });
});
