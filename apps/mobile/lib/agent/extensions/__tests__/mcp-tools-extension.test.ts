import { describe, expect, it, vi } from "vitest";
import { McpProxyClientError } from "@/lib/mcp-client";
import { mcpToolsExtension } from "../mcp-tools-extension";
import { loadExtensions } from "../load-extensions";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function load(factory: ReturnType<typeof mcpToolsExtension>) {
  return loadExtensions([factory], { logger: silentLogger });
}

describe("mcpToolsExtension", () => {
  it("registers one bounded mcp tool by default for multiple MCP tools", async () => {
    const listCatalog = vi.fn().mockResolvedValue({
      tools: [
        {
          name: "crm__create_lead",
          server: "crm",
          tool: "create_lead",
          description: "make a lead",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
        {
          name: "crm__search_crm",
          server: "crm",
          tool: "search_crm",
          description: "search",
        },
      ],
      errors: [],
    });

    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: { listCatalog, callMcpTool: vi.fn() },
      }),
    );

    expect(loaded.tools.map((t) => t.name)).toEqual(["mcp"]);
    expect(loaded.tools[0].parameters.properties).toHaveProperty("list");
    expect(loaded.tools[0].parameters.properties).toHaveProperty("search");
    expect(loaded.tools[0].parameters.properties).toHaveProperty("call");

    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(listCatalog).not.toHaveBeenCalled();
    expect(composed.systemPrompt).toContain("one connected-services gateway");
    expect(composed.systemPrompt).toContain("mcp({ list: true })");
  });

  it("mcp list returns server/tool descriptions and optional schemas", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({
            tools: [
              {
                name: "crm__create_lead",
                server: "crm",
                tool: "create_lead",
                description: "Create a lead",
                inputSchema: { type: "object", required: ["email"] },
              },
            ],
            errors: [],
          }),
          callMcpTool: vi.fn(),
        },
      }),
    );

    const result = await loaded.tools[0].execute(
      { list: true, includeSchemas: true },
      {},
    );
    const body = JSON.parse(result.content);

    expect(result.isError).toBe(false);
    expect(body.tools).toEqual([
      {
        server: "crm",
        tool: "create_lead",
        name: "crm__create_lead",
        description: "Create a lead",
        inputSchema: { type: "object", required: ["email"] },
      },
    ]);
  });

  it("mcp search narrows CRM-related tools", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({
            tools: [
              {
                name: "crm__list_opportunities",
                server: "crm",
                tool: "list_opportunities",
                description: "List sales opportunities",
              },
              {
                name: "slack__search",
                server: "slack",
                tool: "search",
                description: "Search messages",
              },
            ],
            errors: [],
          }),
          callMcpTool: vi.fn(),
        },
      }),
    );

    const result = await loaded.tools[0].execute(
      { search: "opportunities" },
      {},
    );
    const body = JSON.parse(result.content);

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({
      server: "crm",
      tool: "list_opportunities",
    });
  });

  it("mcp call dispatches through server/tool without exposing bearer tokens", async () => {
    const callMcpTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "created" }],
      isError: false,
    });
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({ tools: [], errors: [] }),
          callMcpTool,
        },
      }),
    );

    const result = await loaded.tools[0].execute(
      {
        call: {
          server: "crm",
          tool: "create_lead",
          args: { email: "x@y.com" },
        },
      },
      {},
    );

    expect(callMcpTool).toHaveBeenCalledWith(
      "agent-1",
      { server: "crm", tool: "create_lead", args: { email: "x@y.com" } },
      expect.anything(),
    );
    expect(result).toEqual({ content: "created", isError: false });
    expect(JSON.stringify(callMcpTool.mock.calls)).not.toContain("Bearer");
  });

  it("surfaces an upstream isError result as an error tool-result", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({ tools: [], errors: [] }),
          callMcpTool: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "bad input" }],
            isError: true,
          }),
        },
      }),
    );

    const result = await loaded.tools[0].execute(
      { call: { server: "crm", tool: "create_lead", args: {} } },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).toBe("bad input");
  });

  it("expired connector auth produces visible recovery guidance", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi
            .fn()
            .mockRejectedValue(new McpProxyClientError(401, "expired")),
          callMcpTool: vi.fn(),
        },
      }),
    );

    const result = await loaded.tools[0].execute({ list: true }, {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("authentication");
    expect(result.content).toContain("Reconnect");
  });

  it("discovery errors are observable in list results", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({
            tools: [{ name: "crm__search", server: "crm", tool: "search" }],
            errors: [
              {
                server: "erp",
                error: "timeout",
                kind: "transport",
              },
            ],
          }),
          callMcpTool: vi.fn(),
        },
      }),
    );

    const result = await loaded.tools[0].execute({ list: true }, {});
    const body = JSON.parse(result.content);

    expect(result.isError).toBe(true);
    expect(body.errors).toEqual([
      { server: "erp", error: "timeout", kind: "transport" },
    ]);
  });

  it("direct per-tool registration is opt-in through an allowlist", async () => {
    const callMcpTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "pong" }],
    });
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        directToolAllowlist: ["crm__echo"],
        deps: {
          listCatalog: vi.fn().mockResolvedValue({
            tools: [
              {
                name: "crm__echo",
                server: "crm",
                tool: "echo",
                description: "echo",
                inputSchema: undefined,
              },
              { name: "crm__hidden", server: "crm", tool: "hidden" },
            ],
            errors: [],
          }),
          callMcpTool,
        },
      }),
    );

    expect(loaded.tools.map((t) => t.name)).toEqual(["mcp", "crm__echo"]);
    expect(loaded.tools[1].parameters).toEqual({ type: "object" });

    const result = await loaded.tools[1].execute({ v: 1 }, {});
    expect(callMcpTool).toHaveBeenCalledWith(
      "agent-1",
      { server: "crm", tool: "echo", args: { v: 1 } },
      expect.anything(),
    );
    expect(result.content).toBe("pong");
  });

  it("requires exactly one mcp mode", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listCatalog: vi.fn().mockResolvedValue({ tools: [], errors: [] }),
          callMcpTool: vi.fn(),
        },
      }),
    );

    expect(
      (await loaded.tools[0].execute({ list: true, search: "x" }, {})).isError,
    ).toBe(true);
    expect((await loaded.tools[0].execute({}, {})).isError).toBe(true);
  });

  it("adds explicit execution guidance when MCP exposes code or shell tools", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        directToolAllowlist: ["tools__bash"],
        deps: {
          listCatalog: vi.fn().mockResolvedValue({
            tools: [
              { name: "tools__bash", server: "tools", tool: "bash" },
              {
                name: "code__execute_code",
                server: "code",
                tool: "execute_code",
              },
            ],
            errors: [],
          }),
          callMcpTool: vi.fn(),
        },
      }),
    );

    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(composed.systemPrompt).toContain("tools/bash");
    expect(composed.systemPrompt).toContain("execute code or shell commands");
    expect(composed.systemPrompt).toContain(
      "Do not calculate code results mentally",
    );
  });
});
