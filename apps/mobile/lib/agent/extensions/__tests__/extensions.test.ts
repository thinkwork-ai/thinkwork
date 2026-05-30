import { describe, expect, it, vi } from "vitest";
import { defineExtension } from "../define-extension";
import { loadExtensions } from "../load-extensions";
import type { ExtensionAPI } from "../types";
import { defineTool } from "../../session";
import type { Tool } from "../../types";

function tool(name: string): Tool {
  return defineTool({
    name,
    description: `tool ${name}`,
    parameters: { type: "object" },
    execute: async () => ({ content: name }),
  });
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("defineExtension", () => {
  it("returns the extension when valid", () => {
    const ext = defineExtension({ name: "x", register: () => {} });
    expect(ext.name).toBe("x");
  });

  it("rejects a missing name", () => {
    expect(() => defineExtension({ name: "", register: () => {} })).toThrow(
      /non-empty `name`/,
    );
  });

  it("rejects a missing register fn", () => {
    expect(() =>
      // @ts-expect-error intentionally malformed
      defineExtension({ name: "x" }),
    ).toThrow(/`register` function/);
  });
});

describe("loadExtensions", () => {
  it("collects registered tools across extensions in order", async () => {
    const a = defineExtension({
      name: "a",
      register: (pi) => {
        pi.registerTool(tool("a1"));
      },
    });
    const b = defineExtension({
      name: "b",
      register: (pi) => {
        pi.registerTool(tool("b1"));
      },
    });
    const loaded = await loadExtensions([a, b], { logger: silentLogger });
    expect(loaded.tools.map((t) => t.name)).toEqual(["a1", "b1"]);
  });

  it("registerTool returns an unregister fn", async () => {
    let off: () => void = () => {};
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        off = pi.registerTool(tool("t1"));
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    expect(loaded.tools.map((t) => t.name)).toEqual(["t1"]);
    off();
    expect(loaded.tools).toEqual([]);
  });

  it("chains before_agent_start handlers to compose the system prompt", async () => {
    const a = defineExtension({
      name: "a",
      register: (pi) => {
        pi.on("before_agent_start", (e) => ({
          systemPrompt: `${e.systemPrompt}\n\n[a]`,
        }));
      },
    });
    const b = defineExtension({
      name: "b",
      register: (pi) => {
        pi.on("before_agent_start", (e) => ({
          systemPrompt: `${e.systemPrompt}\n\n[b]`,
        }));
      },
    });
    const loaded = await loadExtensions([a, b], { logger: silentLogger });
    const result = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
      agentName: "Agent",
    });
    expect(result.systemPrompt).toBe("base\n\n[a]\n\n[b]");
  });

  it("passes the event payload (agentName) to handlers", async () => {
    let seen: string | undefined;
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        pi.on("before_agent_start", (e) => {
          seen = e.agentName;
        });
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    await loaded.dispatch("before_agent_start", {
      systemPrompt: "",
      agentName: "Scout",
    });
    expect(seen).toBe("Scout");
  });

  it("dispatches non-prompt events to stored handlers (the bus is real)", async () => {
    const calls: string[] = [];
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        pi.on("tool_call", (e) => {
          calls.push(e.name);
        });
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    await loaded.dispatch("tool_call", { name: "echo", arguments: {} });
    expect(calls).toEqual(["echo"]);
  });

  it("on() returns a handler-removal fn", async () => {
    const calls: string[] = [];
    let off: () => void = () => {};
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        off = pi.on("tool_call", (e) => {
          calls.push(e.name);
        });
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    off();
    await loaded.dispatch("tool_call", { name: "echo", arguments: {} });
    expect(calls).toEqual([]);
  });

  it("awaits an async register before the tools are available", async () => {
    const ext = defineExtension({
      name: "async",
      register: async (pi) => {
        await new Promise((r) => setTimeout(r, 5));
        pi.registerTool(tool("late"));
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    expect(loaded.tools.map((t) => t.name)).toEqual(["late"]);
  });

  it("skips an extension whose register throws and loads the rest", async () => {
    const error = vi.fn();
    const bad = defineExtension({
      name: "bad",
      register: () => {
        throw new Error("boom");
      },
    });
    const good = defineExtension({
      name: "good",
      register: (pi) => {
        pi.registerTool(tool("g1"));
      },
    });
    const loaded = await loadExtensions([bad, good], {
      logger: { ...silentLogger, error },
    });
    expect(loaded.tools.map((t) => t.name)).toEqual(["g1"]);
    expect(error).toHaveBeenCalledOnce();
  });

  it("a throwing event handler does not break the dispatch chain", async () => {
    const calls: string[] = [];
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        pi.on("before_agent_start", () => {
          throw new Error("handler boom");
        });
        pi.on("before_agent_start", (e) => {
          calls.push("second");
          return { systemPrompt: `${e.systemPrompt}!` };
        });
      },
    });
    const loaded = await loadExtensions([ext], { logger: silentLogger });
    const result = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });
    expect(calls).toEqual(["second"]);
    expect(result.systemPrompt).toBe("base!");
  });

  it("exposes the logger to extensions", async () => {
    const info = vi.fn();
    let api: ExtensionAPI | undefined;
    const ext = defineExtension({
      name: "x",
      register: (pi) => {
        api = pi;
        pi.logger.info("hi");
      },
    });
    await loadExtensions([ext], { logger: { ...silentLogger, info } });
    expect(api).toBeDefined();
    expect(info).toHaveBeenCalledWith("hi");
  });
});
