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
  connect: (transport: Transport, opts?: { timeout?: number }) => Promise<void>;
  listTools: (
    args: undefined,
    opts?: { timeout?: number },
  ) => Promise<FakeListing>;
  callTool: (
    args: { name: string; arguments: Record<string, unknown> },
    schema: unknown,
    opts?: { timeout?: number },
  ) => Promise<unknown>;
  readResource?: (
    args: { uri: string },
    opts?: { timeout?: number },
  ) => Promise<unknown>;
}

function makeFakeClient(
  tools: FakeListing["tools"],
  callResponse?: unknown,
  resourceResponse?: unknown,
): {
  client: FakeClient;
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn(async () => {});
  const listTools = vi.fn(async () => ({ tools }));
  const callTool = vi.fn(
    async () =>
      callResponse ?? {
        content: [{ type: "text", text: "ok" }],
      },
  );
  const readResource = vi.fn(async () => resourceResponse ?? { contents: [] });
  return {
    client: {
      connect: connect as unknown as FakeClient["connect"],
      listTools: listTools as unknown as FakeClient["listTools"],
      callTool: callTool as unknown as FakeClient["callTool"],
      readResource: readResource as unknown as FakeClient["readResource"],
    },
    connect,
    listTools,
    callTool,
    readResource,
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

  it("reads openai outputTemplate resources as app descriptors", async () => {
    const fake = makeFakeClient(
      [{ name: "dispatch_optimization_app" }],
      {
        _meta: {
          "openai/outputTemplate": "ui://lastmile-dispatch/optimization-v2",
          "ui/resourceUri": "ui://lastmile-dispatch/optimization-v2",
          ui: { resourceUri: "ui://lastmile-dispatch/optimization-v2" },
        },
        content: [{ type: "text", text: "Dispatch optimization app" }],
        structuredContent: {
          state: "empty",
          message: "Select optimization inputs to preview dispatch results.",
        },
      },
      {
        contents: [
          {
            uri: "ui://lastmile-dispatch/optimization-v2",
            mimeType: "text/html;profile=mcp-app",
            text: "<!doctype html><title>Dispatch Optimization</title><main>app</main>",
          },
        ],
      },
    );
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
      readResourceTimeoutMs: 4_000,
    });
    const [tool] = await factory({
      url: "https://mcp-dev.lastmile-tei.com/dispatch",
      headers: {},
      serverName: "lastmile-dispatch",
    });

    const result = await tool!.execute("call-1", {});

    expect(fake.readResource).toHaveBeenCalledTimes(1);
    expect(fake.readResource).toHaveBeenCalledWith(
      { uri: "ui://lastmile-dispatch/optimization-v2" },
      { timeout: 4_000 },
    );
    expect(result.details).toMatchObject({
      mcp_apps: [
        {
          uri: "ui://lastmile-dispatch/optimization-v2",
          mimeType: "text/html",
          html: expect.stringContaining("<main>app</main>"),
          title: "Dispatch Optimization",
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

  it("applies manifest-declared scaled integer transforms without provider knowledge", async () => {
    const upstream = {
      result: {
        records: [
          {
            name: "Choke Canyon travel centers",
            amount: {
              amountMicros: 1_500_000_000,
              currencyCode: "USD",
            },
            lineItems: [
              {
                amount: {
                  amountMicros: "1234567",
                  currencyCode: "USD",
                },
              },
            ],
          },
        ],
      },
    };
    const fake = makeFakeClient([{ name: "execute_tool" }], {
      content: [{ type: "text", text: JSON.stringify(upstream) }],
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://provider.example.com/mcp",
      headers: {},
      serverName: "provider--crm",
      resultTransforms: [
        {
          type: "scaled-integer-to-decimal",
          sourceField: "amountMicros",
          targetField: "value",
          scale: 6,
          removeSource: true,
        },
      ],
    });

    const result = await tool!.execute("call-1", {});
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : "";
    const modelPayload = JSON.parse(text);

    expect(modelPayload.result.records[0].amount).toEqual({
      currencyCode: "USD",
      value: "1500",
    });
    expect(modelPayload.result.records[0].lineItems[0].amount).toEqual({
      currencyCode: "USD",
      value: "1.234567",
    });
    expect(text).not.toContain("amountMicros");
    expect(result.details.raw).toEqual({
      content: [{ type: "text", text: JSON.stringify(upstream) }],
    });
  });

  it("leaves MCP result content unchanged when no transform is declared", async () => {
    const payload = {
      amount: { amountMicros: 1_500_000_000, currencyCode: "USD" },
    };
    const fake = makeFakeClient([{ name: "search" }], {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    });
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const [tool] = await factory({
      url: "https://mcp.example.com",
      headers: {},
      serverName: "provider--crm",
    });

    const result = await tool!.execute("call-1", {});
    const text =
      result.content?.[0]?.type === "text" ? result.content[0].text : "";

    expect(JSON.parse(text)).toEqual(payload);
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

describe("McpConnectionRetention rebind ping tolerance (THINK-586 U7)", () => {
  function retainedConnection(
    ping: () => Promise<unknown>,
  ): import("../src/mcp-connect.js").RetainedMcpConnection {
    return {
      serverName: "demo",
      ping,
      close: async () => undefined,
      setFetch: () => undefined,
      setAuthorization: () => undefined,
      hasAuthorization: false,
    };
  }

  it("treats JSON-RPC -32601 (ping unimplemented) as liveness proof", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const retention = createMcpConnectionRetention();
    retention.register(
      retainedConnection(() =>
        Promise.reject(
          Object.assign(new Error("MCP error -32601: Method not found: ping"), {
            code: -32601,
          }),
        ),
      ),
    );
    await expect(
      retention.rebind({
        fetch: globalThis.fetch,
        authorizationForServer: () => null,
      }),
    ).resolves.toBeUndefined();
  });

  it("still fails rebind on transport-level ping errors", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const retention = createMcpConnectionRetention();
    retention.register(
      retainedConnection(() => Promise.reject(new Error("fetch failed"))),
    );
    await expect(
      retention.rebind({
        fetch: globalThis.fetch,
        authorizationForServer: () => null,
      }),
    ).rejects.toThrow(/fetch failed/);
  });
});

// ─── THINK-946: cross-thread connection reuse ───────────────────────────────

describe("createConnectMcpServer — cross-thread reuse (THINK-946)", () => {
  /** One turn's worth of MCP-connect wiring, sharing a retention across
   * "turns" the way the connection-scoped warm cache does. */
  function turn(options: {
    retention: import("../src/mcp-connect.js").McpConnectionRetention;
    client: FakeClient & { ping: ReturnType<typeof vi.fn> };
    transport: Transport;
    fetchImpl: typeof fetch;
    reused: string[];
  }) {
    const transportFetches: Array<typeof fetch | undefined> = [];
    const factory = createConnectMcpServer({
      cleanup: [],
      fetch: options.fetchImpl,
      retention: options.retention,
      onConnectionReused: (info) => options.reused.push(info.serverName),
      transportFactory: (args) => {
        transportFetches.push(args.fetch);
        return options.transport;
      },
      clientFactory: () => options.client as never,
    });
    return { factory, transportFetches };
  }

  function pingableClient(tools: FakeListing["tools"] = [{ name: "alpha" }]) {
    const fake = makeFakeClient(tools);
    const ping = vi.fn(async () => ({}));
    return {
      ...fake,
      ping,
      client: { ...fake.client, ping } as FakeClient & {
        ping: ReturnType<typeof vi.fn>;
      },
    };
  }

  const connectArgs = (overrides: Record<string, unknown> = {}) => ({
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Handle turn-1-uuid" },
    serverName: "demo",
    ...overrides,
  });

  it("serves a second thread's connect from the retained transport — no initialize, no tools/list", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const retention = createMcpConnectionRetention();
    const fake = pingableClient([{ name: "alpha" }, { name: "beta" }]);
    const transport = makeFakeTransport();
    const reused: string[] = [];

    const first = turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: globalThis.fetch,
      reused,
    });
    const firstTools = await first.factory(connectArgs());
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.listTools).toHaveBeenCalledTimes(1);

    // A different thread of the same user: fresh turn wiring, same retention.
    const second = turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: globalThis.fetch,
      reused,
    });
    const secondTools = await second.factory(
      connectArgs({ headers: { Authorization: "Handle turn-2-uuid" } }),
    );

    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.listTools).toHaveBeenCalledTimes(1);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(reused).toEqual(["demo"]);
    expect(secondTools.map((tool) => tool.name)).toEqual(
      firstTools.map((tool) => tool.name),
    );
    // Rebuilt closures, never the previous turn's objects.
    expect(secondTools[0]).not.toBe(firstTools[0]);
  });

  it("repoints the retained transport at THIS turn's fetch and minted handle", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const retention = createMcpConnectionRetention();
    const fake = pingableClient();
    const transport = makeFakeTransport();
    const reused: string[] = [];
    const firstFetch = vi.fn(async () => new Response("first"));
    const secondFetch = vi.fn(async () => new Response("second"));

    const first = turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: firstFetch as unknown as typeof fetch,
      reused,
    });
    await first.factory(connectArgs());
    // The transport was handed the indirection, not the raw turn fetch.
    const indirect = first.transportFetches[0]!;

    const second = turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: secondFetch as unknown as typeof fetch,
      reused,
    });
    await second.factory(
      connectArgs({ headers: { Authorization: "Handle turn-2-uuid" } }),
    );

    await indirect(
      new Request("https://mcp.example.com/mcp", {
        headers: { authorization: "Handle turn-1-uuid" },
      }),
    );
    expect(firstFetch).not.toHaveBeenCalled();
    expect(secondFetch).toHaveBeenCalledTimes(1);
    const sent = (secondFetch.mock.calls[0] as unknown as [Request])[0];
    expect(sent.headers.get("authorization")).toBe("Handle turn-2-uuid");
  });

  it("a dead retained transport falls back to a full connect and is dropped", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const retention = createMcpConnectionRetention();
    const fake = pingableClient();
    const transport = makeFakeTransport();
    const reused: string[] = [];

    await turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: globalThis.fetch,
      reused,
    }).factory(connectArgs());
    expect(retention.size).toBe(1);

    fake.ping.mockRejectedValueOnce(new Error("fetch failed"));
    const tools = await turn({
      retention,
      client: fake.client,
      transport,
      fetchImpl: globalThis.fetch,
      reused,
    }).factory(connectArgs());

    expect(reused).toEqual([]);
    expect(fake.connect).toHaveBeenCalledTimes(2);
    expect(fake.listTools).toHaveBeenCalledTimes(2);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(tools).toHaveLength(1);
    // The corpse was replaced, not accumulated.
    expect(retention.size).toBe(1);
  });

  it("never reuses across a changed connect shape (url, whitelist, transport, auth presence)", async () => {
    const { createMcpConnectionRetention } = await import(
      "../src/mcp-connect.js"
    );
    const fake = pingableClient([{ name: "alpha" }, { name: "beta" }]);
    const reused: string[] = [];
    for (const changed of [
      { url: "https://other.example.com/mcp" },
      { toolWhitelist: ["alpha"] },
      { transport: "sse" as const },
      { headers: {} },
      { serverName: "other" },
    ]) {
      const retention = createMcpConnectionRetention();
      const transport = makeFakeTransport();
      const wiring = {
        retention,
        client: fake.client,
        transport,
        fetchImpl: globalThis.fetch,
        reused,
      };
      fake.connect.mockClear();
      await turn(wiring).factory(connectArgs());
      await turn(wiring).factory(connectArgs(changed));
      expect(fake.connect).toHaveBeenCalledTimes(2);
    }
    expect(reused).toEqual([]);
  });

  it("without a retention (Lambda path) nothing is retained or reused", async () => {
    const fake = pingableClient();
    const cleanup: Array<() => Promise<void>> = [];
    const factory = createConnectMcpServer({
      cleanup,
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    await factory(connectArgs());
    await factory(connectArgs());
    expect(fake.connect).toHaveBeenCalledTimes(2);
    expect(fake.ping).not.toHaveBeenCalled();
    // Per-turn teardown, exactly as before.
    expect(cleanup).toHaveLength(2);
  });
});

describe("createConnectMcpServer — RPC option shapes (THINK-623)", () => {
  it("caps `connect` with an explicit timeout so a cold server fails fast", async () => {
    const fake = makeFakeClient([]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
    });
    expect(fake.connect.mock.calls[0]![1]).toEqual({ timeout: 10_000 });
  });

  it("keeps the fixed 60s wall and sends no progress token by default", async () => {
    const fake = makeFakeClient([{ name: "search" }]);
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
    await tools[0]!.execute("call-1", {});
    expect(fake.callTool.mock.calls[0]![2]).toEqual({ timeout: 60_000 });
  });

  it("gives `longRunning` servers a progress-resetting wall plus a total ceiling", async () => {
    const fake = makeFakeClient([{ name: "search" }]);
    const factory = createConnectMcpServer({
      cleanup: [],
      transportFactory: () => makeFakeTransport(),
      clientFactory: () => fake.client as never,
    });
    const tools = await factory({
      url: "https://mcp.example.com/",
      headers: {},
      serverName: "demo",
      longRunning: true,
    });
    await tools[0]!.execute("call-1", {});
    const opts = fake.callTool.mock.calls[0]![2] as Record<string, unknown>;
    expect(opts.timeout).toBe(60_000);
    expect(opts.resetTimeoutOnProgress).toBe(true);
    expect(opts.maxTotalTimeout).toBe(480_000);
    // Presence of `onprogress` is what makes the SDK attach the
    // `_meta.progressToken` the server needs to reset the wall.
    expect(typeof opts.onprogress).toBe("function");
  });
});
