import { describe, expect, it } from "vitest";
import { buildTurnContext } from "./turn-context";
import { defineTool } from "./session";
import type { Tool } from "./types";

function tool(name: string): Tool {
  return defineTool({
    name,
    description: `${name} tool`,
    parameters: { type: "object" },
    execute: async () => ({ content: "" }),
  });
}

describe("buildTurnContext", () => {
  it("produces a non-empty system prompt naming the agent", () => {
    const ctx = buildTurnContext({ agentName: "Scout" });
    expect(ctx.system).toContain("Scout");
    expect(ctx.system).toContain("mobile");
    expect(ctx.system).not.toContain("{agentName}");
  });

  it("falls back to a generic agent name", () => {
    const ctx = buildTurnContext();
    expect(ctx.system).toContain("your ThinkWork agent");
  });

  it("returns exactly the tools provided", () => {
    const ctx = buildTurnContext({ tools: [tool("a"), tool("b")] });
    expect(ctx.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("yields no tools when none are provided (model answers directly)", () => {
    const ctx = buildTurnContext({ agentName: "Scout" });
    expect(ctx.tools).toEqual([]);
  });

  it("does not contradict connected MCP code or shell tools", () => {
    const ctx = buildTurnContext({ agentName: "Scout" });
    expect(ctx.system).toContain("code/shell sandboxes");
    expect(ctx.system).not.toContain("no shell");
    expect(ctx.system).not.toContain("no ability to run code");
    expect(ctx.system).toContain("unless that fact came from a tool result");
  });

  it("appends extra guidance after the base prompt", () => {
    const ctx = buildTurnContext({
      extraGuidance: "Prefer the CRM tool for leads.",
    });
    expect(ctx.system).toContain("Prefer the CRM tool for leads.");
    expect(ctx.system.indexOf("Prefer the CRM")).toBeGreaterThan(
      ctx.system.indexOf("mobile"),
    );
  });

  it("honors a platform systemPrompt override with agentName substitution", () => {
    const ctx = buildTurnContext({
      agentName: "Scout",
      platformConfig: {
        systemPrompt: "I am {agentName}, configured by the platform.",
      },
    });
    expect(ctx.system).toContain("I am Scout, configured by the platform.");
  });
});
