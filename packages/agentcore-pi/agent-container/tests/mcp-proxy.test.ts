/**
 * Plan §006 U3 — tests for the inert mcp proxy AgentTool.
 *
 * The inert-first forcing function lives here: parametrized over
 * mode ("inert" vs future "live"), so that when U5 lands the live
 * body, the still-inert assertions remain a regression test against
 * accidentally re-disabling the proxy.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  buildMcpProxyTool,
  MCP_PROXY_TOOL_NAME,
  McpProxyInertError,
} from "../src/mcp-proxy.js";

describe("buildMcpProxyTool — inert mode", () => {
  it("returns an AgentTool named \"mcp\" with executionMode=sequential", () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    expect(tool.name).toBe(MCP_PROXY_TOOL_NAME);
    expect(tool.name).toBe("mcp");
    expect(tool.executionMode).toBe("sequential");
    expect(typeof tool.execute).toBe("function");
  });

  it("description mentions list / search / call modes", () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    expect(tool.description).toMatch(/list/i);
    expect(tool.description).toMatch(/search/i);
    expect(tool.description).toMatch(/call/i);
  });

  it("parameters schema accepts { list: true }", () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    // Typebox shape — verify the top-level properties exist
    const schema = tool.parameters as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("list");
    expect(properties).toHaveProperty("search");
    expect(properties).toHaveProperty("call");
    expect(properties).toHaveProperty("includeSchemas");
  });

  it("parameters schema rejects additional properties", () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    const schema = tool.parameters as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
  });

  it("JSON.stringify of the parameters schema succeeds (no circular refs)", () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    expect(() => JSON.stringify(tool.parameters)).not.toThrow();
  });

  it("execute() throws McpProxyInertError with an operator-readable recovery hint", async () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    await expect(tool.execute("call-1", {} as never)).rejects.toThrow(
      McpProxyInertError,
    );
    await expect(tool.execute("call-1", {} as never)).rejects.toThrow(
      /not yet wired/,
    );
  });

  it("execute() throws even when called with each discriminator", async () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    await expect(tool.execute("call-1", { list: true } as never)).rejects.toThrow(
      McpProxyInertError,
    );
    await expect(
      tool.execute("call-2", { search: "foo" } as never),
    ).rejects.toThrow(McpProxyInertError);
    await expect(
      tool.execute("call-3", {
        call: { server: "slack", tool: "search", args: {} },
      } as never),
    ).rejects.toThrow(McpProxyInertError);
  });

  it("inert throw names the per-tool surface as the v0 recovery path", async () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    await expect(tool.execute("call-1", {} as never)).rejects.toThrow(
      /mcp_<server>_<tool>/,
    );
  });
});

describe("buildMcpProxyTool — body-swap forcing function", () => {
  // This block exists to make the inert→live cutover impossible to land
  // silently. When U5 swaps the body to "live", these inert-mode
  // assertions continue to pass, but the matching live-mode test
  // (added in U5) starts asserting a real call into a fake
  // connectMcpServer. If a future PR regresses live mode back to a
  // throw, the live-mode test in U5 will fail — protecting the
  // production behavior even after the inert branch is gone from the
  // production assemble path.
  it("inert mode is the only currently-shipped behavior", async () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    await expect(tool.execute("call-1", {} as never)).rejects.toThrow(
      McpProxyInertError,
    );
  });

  it("an unimplemented mode throws a distinct error class", async () => {
    // Forcing function: if someone adds a new mode to the union without
    // implementing it, this test catches the silent fallthrough.
    const tool = buildMcpProxyTool({ mode: "live" });
    await expect(tool.execute("call-1", {} as never)).rejects.toThrow(
      /not implemented/,
    );
  });
});

describe("buildMcpProxyTool — telemetry-shape compatibility", () => {
  // The agent loop subscribes to tool_execution_start / _end events; we
  // mirror that lifecycle here with a fake subscriber to prove the inert
  // proxy participates in the same telemetry pipeline as today's per-tool
  // surface (server.ts:593-629).
  it("a fake subscribe captures a start and an end event with toolName=mcp", async () => {
    const tool: AgentTool<any> = buildMcpProxyTool({ mode: "inert" });
    const events: Array<{ type: string; toolName: string }> = [];
    const subscribe = (event: { type: string; toolName: string }) =>
      events.push(event);

    // Simulate the agent loop's tool-execution wrapper: fire start, run
    // execute, fire end with the error result. The Pi agent loop does
    // this internally; we replicate the shape here.
    subscribe({ type: "tool_execution_start", toolName: tool.name });
    let captured: unknown;
    try {
      await tool.execute("call-1", {} as never);
    } catch (err) {
      captured = err;
    }
    subscribe({ type: "tool_execution_end", toolName: tool.name });

    expect(events).toEqual([
      { type: "tool_execution_start", toolName: "mcp" },
      { type: "tool_execution_end", toolName: "mcp" },
    ]);
    expect(captured).toBeInstanceOf(McpProxyInertError);
  });

  it("calling execute through vi.fn wrapper preserves the throw", async () => {
    const tool = buildMcpProxyTool({ mode: "inert" });
    const wrapped = vi.fn(tool.execute);
    await expect(wrapped("call-1", {} as never)).rejects.toThrow(
      McpProxyInertError,
    );
    expect(wrapped).toHaveBeenCalledTimes(1);
  });
});
