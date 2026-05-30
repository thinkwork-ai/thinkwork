import { describe, expect, it, vi } from "vitest";
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
  it("registers one tool per discovered def and contributes a system prompt", async () => {
    const listTools = vi.fn().mockResolvedValue([
      {
        name: "create_lead",
        description: "make a lead",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
      { name: "search_crm", description: "search", inputSchema: undefined },
    ]);
    const callTool = vi.fn();

    const ext = mcpToolsExtension({
      agentId: "agent-1",
      deps: { listTools, callTool },
    });
    const loaded = await load(ext);

    expect(listTools).toHaveBeenCalledWith("agent-1", expect.anything());
    expect(loaded.tools.map((t) => t.name)).toEqual([
      "create_lead",
      "search_crm",
    ]);
    // Missing inputSchema defaults to an object schema.
    expect(loaded.tools[1].parameters).toEqual({ type: "object" });

    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(composed.systemPrompt).toContain("create_lead, search_crm");
  });

  it("adds explicit execution guidance when MCP exposes code or shell tools", async () => {
    const loaded = await load(
      mcpToolsExtension({
        agentId: "agent-1",
        deps: {
          listTools: vi.fn().mockResolvedValue([
            { name: "bash", description: "run commands" },
            { name: "execute_code", description: "run Python" },
          ]),
          callTool: vi.fn(),
        },
      }),
    );

    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(composed.systemPrompt).toContain("bash, execute_code");
    expect(composed.systemPrompt).toContain("execute code or shell commands");
    expect(composed.systemPrompt).toContain(
      "Do not calculate code results mentally",
    );
  });

  it("a registered tool's execute calls the proxy and returns text content", async () => {
    const listTools = vi
      .fn()
      .mockResolvedValue([{ name: "echo", description: "echo" }]);
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "pong" }],
      isError: false,
    });

    const ext = mcpToolsExtension({
      agentId: "agent-1",
      deps: { listTools, callTool },
    });
    const loaded = await load(ext);

    const result = await loaded.tools[0].execute({ v: 1 }, {});
    expect(callTool).toHaveBeenCalledWith(
      "agent-1",
      "echo",
      { v: 1 },
      expect.anything(),
    );
    expect(result).toEqual({ content: "pong", isError: false });
  });

  it("surfaces an upstream isError result as an error tool-result (loop recovers)", async () => {
    const listTools = vi.fn().mockResolvedValue([{ name: "boom" }]);
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "bad input" }],
      isError: true,
    });
    const loaded = await load(
      mcpToolsExtension({ agentId: "a", deps: { listTools, callTool } }),
    );
    const result = await loaded.tools[0].execute({}, {});
    expect(result.isError).toBe(true);
    expect(result.content).toBe("bad input");
  });

  it("a proxy throw on call becomes an error tool-result, not a crash", async () => {
    const listTools = vi.fn().mockResolvedValue([{ name: "net" }]);
    const callTool = vi.fn().mockRejectedValue(new Error("network down"));
    const loaded = await load(
      mcpToolsExtension({ agentId: "a", deps: { listTools, callTool } }),
    );
    const result = await loaded.tools[0].execute({}, {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("network down");
  });

  it("registers nothing when discovery fails (turn degrades to plain chat)", async () => {
    const listTools = vi.fn().mockRejectedValue(new Error("offline"));
    const callTool = vi.fn();
    const loaded = await load(
      mcpToolsExtension({ agentId: "a", deps: { listTools, callTool } }),
    );
    expect(loaded.tools).toEqual([]);
    // No before_agent_start contribution either.
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(composed.systemPrompt).toBe("base");
  });

  it("registers nothing when the tenant exposes no tools", async () => {
    const listTools = vi.fn().mockResolvedValue([]);
    const loaded = await load(
      mcpToolsExtension({
        agentId: "a",
        deps: { listTools, callTool: vi.fn() },
      }),
    );
    expect(loaded.tools).toEqual([]);
  });
});
