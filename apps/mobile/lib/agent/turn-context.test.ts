import { describe, expect, it } from "vitest";
import { buildTurnContext } from "./turn-context";
import type { Tool } from "./types";

function tool(name: string): Tool {
  return {
    spec: { name, description: `${name} tool`, parameters: { type: "object" } },
    execute: async () => ({ content: "" }),
  };
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

  it("registers exactly the tools provided", () => {
    const ctx = buildTurnContext({ tools: [tool("a"), tool("b")] });
    expect(ctx.registry.specs().map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("yields a tools-less registry when none are provided (model answers directly)", () => {
    const ctx = buildTurnContext({ agentName: "Scout" });
    expect(ctx.registry.specs()).toEqual([]);
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
