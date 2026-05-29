import { describe, expect, it, vi } from "vitest";

import { buildContextEngineTools } from "../src/runtime/tools/context-engine.js";

const baseOptions = {
  apiUrl: "https://api.example.com/",
  apiSecret: "service-secret",
  tenantId: "tenant-1",
  userId: "user-1",
  agentId: "agent-1",
  contextEngineConfig: {},
};

describe("buildContextEngineTools", () => {
  it("registers the three Company Brain tools", () => {
    const tools = buildContextEngineTools(baseOptions);
    expect(tools.map((t) => t.name)).toEqual([
      "query_context",
      "query_memory_context",
      "query_wiki_context",
    ]);
  });

  it("posts a JSON-RPC tools/call with identity headers and renders text content", async () => {
    const fetchMock = vi.fn(async (_url: any, _init?: any) => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "pi-context-engine",
          result: { content: [{ type: "text", text: "Brain says hello" }] },
        }),
        { status: 200 },
      );
    });
    const [queryContext] = buildContextEngineTools({
      ...baseOptions,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await queryContext.execute("c", { query: "who is acme" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/mcp/context-engine");
    const headers = (init as any).headers;
    expect(headers.authorization).toBe("Bearer service-secret");
    expect(headers["x-tenant-id"]).toBe("tenant-1");
    expect(headers["x-user-id"]).toBe("user-1");
    expect(headers["x-agent-id"]).toBe("agent-1");
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({
      method: "tools/call",
      params: { name: "query_context", arguments: { query: "who is acme" } },
    });
    expect((result.content[0] as { text: string }).text).toBe("Brain says hello");
  });

  it("applies config provider defaults when no provider args are given", async () => {
    const fetchMock = vi.fn(
      async (_u: unknown, _i?: unknown) =>
        new Response(JSON.stringify({ result: { content: [] } }), { status: 200 }),
    );
    const [queryContext] = buildContextEngineTools({
      ...baseOptions,
      contextEngineConfig: {
        providers: { families: ["wiki"] },
        providerOptions: { deepThreshold: 3 },
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await queryContext.execute("c", { query: "x" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.params.arguments.providers).toEqual({ families: ["wiki"] });
    expect(body.params.arguments.providerOptions).toEqual({ deepThreshold: 3 });
  });

  it("returns a not-enabled message when API creds are missing", async () => {
    const fetchMock = vi.fn();
    const [queryContext] = buildContextEngineTools({
      ...baseOptions,
      apiSecret: "",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await queryContext.execute("c", { query: "x" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toMatch(/not enabled/i);
  });

  it("surfaces JSON-RPC errors as text", async () => {
    const fetchMock = vi.fn(
      async (_u: unknown, _i?: unknown) =>
        new Response(
          JSON.stringify({ error: { message: "provider exploded" } }),
          { status: 200 },
        ),
    );
    const [queryContext] = buildContextEngineTools({
      ...baseOptions,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await queryContext.execute("c", { query: "x" });
    expect((result.content[0] as { text: string }).text).toMatch(/provider exploded/);
  });

  it("rejects an empty query before any network call", async () => {
    const fetchMock = vi.fn();
    const [, queryMemory] = buildContextEngineTools({
      ...baseOptions,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await queryMemory.execute("c", { query: "  " });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toMatch(/non-empty query/);
  });
});
