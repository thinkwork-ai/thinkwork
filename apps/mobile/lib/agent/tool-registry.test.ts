import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tool-registry";
import type { Tool } from "./types";

function tool(name: string, handler: Tool["execute"]): Tool {
  return {
    spec: { name, description: `${name} tool`, parameters: { type: "object" } },
    execute: handler,
  };
}

describe("ToolRegistry", () => {
  it("advertises registered specs in registration order", () => {
    const registry = new ToolRegistry([
      tool("a", async () => ({ content: "a" })),
      tool("b", async () => ({ content: "b" })),
    ]);
    expect(registry.specs().map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry([tool("dup", async () => ({ content: "" }))]);
    expect(() => registry.register(tool("dup", async () => ({ content: "" })))).toThrow(/already registered/);
  });

  it("executes a tool by name and returns its result", async () => {
    const registry = new ToolRegistry([
      tool("greet", async (args) => ({ content: `hi ${String(args.who)}` })),
    ]);
    const result = await registry.execute("greet", { who: "sam" }, {});
    expect(result).toEqual({ content: "hi sam" });
  });

  it("returns an error result for an unknown tool rather than throwing", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("nope", {}, {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool: nope");
  });

  it("converts a thrown handler into an error result", async () => {
    const registry = new ToolRegistry([
      tool("boom", async () => {
        throw new Error("nope");
      }),
    ]);
    const result = await registry.execute("boom", {}, {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("nope");
  });

  it("refuses to run a tool when the signal is already aborted", async () => {
    let ran = false;
    const registry = new ToolRegistry([
      tool("t", async () => {
        ran = true;
        return { content: "ran" };
      }),
    ]);
    const result = await registry.execute("t", {}, { signal: AbortSignal.abort() });
    expect(ran).toBe(false);
    expect(result.isError).toBe(true);
  });
});
