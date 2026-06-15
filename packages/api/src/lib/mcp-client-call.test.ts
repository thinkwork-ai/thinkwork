import { describe, expect, it, vi } from "vitest";
import {
  mcpListTools,
  mcpCallTool,
  textFromMcpContent,
  McpTransportError,
  MCP_PROTOCOL_VERSION,
} from "./mcp-client-call.js";

const TARGET = { url: "https://mcp.example.com/rpc", name: "demo" };

/** Build a JSON Response. */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/**
 * A fetch stub that walks the MCP session lifecycle: initialize → initialized
 * (notification, no id) → the real call. Returns the queued responses for the
 * id-bearing requests in order, after answering initialize.
 */
function lifecycleFetch(
  callResponses: Response[],
  opts: { sessionId?: string; onRequest?: (body: any) => void } = {},
): typeof fetch {
  let callIdx = 0;
  return vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body as string);
    opts.onRequest?.(body);
    if (body.method === "initialize") {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: MCP_PROTOCOL_VERSION },
        },
        opts.sessionId ? { headers: { "mcp-session-id": opts.sessionId } } : {},
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    const resp = callResponses[callIdx];
    callIdx += 1;
    return resp;
  }) as unknown as typeof fetch;
}

describe("mcp-client-call session lifecycle", () => {
  it("initializes before tools/list and returns tool defs", async () => {
    const requests: any[] = [];
    const fetchImpl = lifecycleFetch(
      [
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            tools: [
              {
                name: "create_lead",
                description: "make a lead",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      ],
      { onRequest: (b) => requests.push(b.method) },
    );

    const tools = await mcpListTools(TARGET, { fetchImpl });

    expect(requests).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(tools).toEqual([
      {
        name: "create_lead",
        description: "make a lead",
        inputSchema: { type: "object" },
      },
    ]);
  });

  it("carries the Mcp-Session-Id from initialize onto later requests", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      seen.push(init.headers as Record<string, string>);
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize") {
        return jsonResponse(
          { jsonrpc: "2.0", id: body.id, result: {} },
          { headers: { "mcp-session-id": "sess-123" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    }) as unknown as typeof fetch;

    await mcpListTools(TARGET, { fetchImpl });

    // initialize has no session id; the ack + tools/list carry it.
    expect(seen[0]["mcp-session-id"]).toBeUndefined();
    expect(seen[1]["mcp-session-id"]).toBe("sess-123");
    expect(seen[2]["mcp-session-id"]).toBe("sess-123");
  });

  it("sends the protocol version + bearer token", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      seen.push(init.headers as Record<string, string>);
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize")
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    }) as unknown as typeof fetch;

    await mcpListTools({ ...TARGET, token: "tok-abc" }, { fetchImpl });

    expect(seen[0]["MCP-Protocol-Version"]).toBe(MCP_PROTOCOL_VERSION);
    expect(seen[0].Authorization).toBe("Bearer tok-abc");
  });

  it("sends user-provided header auth without allowing Authorization override", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      seen.push(init.headers as Record<string, string>);
      const body = JSON.parse(init.body as string);
      if (body.method === "initialize")
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized")
        return new Response("", { status: 202 });
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    }) as unknown as typeof fetch;

    await mcpListTools(
      {
        ...TARGET,
        headers: {
          "x-api-key": "plane_pat_user_123",
          "x-workspace-slug": "eng",
          Authorization: "Bearer should-not-override",
        },
      },
      { fetchImpl },
    );

    expect(seen[0]["x-api-key"]).toBe("plane_pat_user_123");
    expect(seen[0]["x-workspace-slug"]).toBe("eng");
    expect(seen[0].Authorization).toBeUndefined();
  });

  it("parses an SSE-framed JSON-RPC response", async () => {
    const sse = [
      "event: message",
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "t" }] } })}`,
      "",
    ].join("\n");
    const fetchImpl = lifecycleFetch([
      new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ]);

    const tools = await mcpListTools(TARGET, { fetchImpl });
    expect(tools.map((t) => t.name)).toEqual(["t"]);
  });

  it("returns an MCP isError result rather than throwing", async () => {
    const fetchImpl = lifecycleFetch([
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "nope" }], isError: true },
      }),
    ]);
    const result = await mcpCallTool(
      TARGET,
      "do_thing",
      { a: 1 },
      { fetchImpl },
    );
    expect(result.isError).toBe(true);
    expect(textFromMcpContent(result.content)).toBe("nope");
  });

  it("throws McpTransportError on a JSON-RPC error", async () => {
    const fetchImpl = lifecycleFetch([
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "no method" },
      }),
    ]);
    await expect(
      mcpCallTool(TARGET, "x", {}, { fetchImpl }),
    ).rejects.toBeInstanceOf(McpTransportError);
  });

  it("throws McpTransportError on a non-2xx call", async () => {
    const fetchImpl = lifecycleFetch([
      new Response("upstream down", { status: 503 }),
    ]);
    await expect(mcpListTools(TARGET, { fetchImpl })).rejects.toBeInstanceOf(
      McpTransportError,
    );
  });

  it("throws McpTransportError when initialize itself fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("denied", { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(mcpListTools(TARGET, { fetchImpl })).rejects.toBeInstanceOf(
      McpTransportError,
    );
  });
});

describe("textFromMcpContent", () => {
  it("flattens text blocks", () => {
    expect(
      textFromMcpContent([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("passes through a plain string", () => {
    expect(textFromMcpContent("hi")).toBe("hi");
  });

  it("reads resource text/uri", () => {
    expect(textFromMcpContent([{ resource: { uri: "s3://x" } }])).toBe(
      "s3://x",
    );
  });
});
