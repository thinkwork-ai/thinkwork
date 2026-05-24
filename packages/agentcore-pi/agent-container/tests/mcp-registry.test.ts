/**
 * Plan §006 U2 — tests for McpToolRegistry + validateDirectTools.
 */

import { describe, expect, it } from "vitest";
import {
  McpToolRegistry,
  validateDirectTools,
} from "../src/mcp-registry.js";

function exampleSchema(): unknown {
  return {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };
}

describe("McpToolRegistry", () => {
  it("starts empty", () => {
    const r = new McpToolRegistry();
    expect(r.entries()).toEqual([]);
    expect(r.size).toBe(0);
    expect(r.get("slack", "search")).toBeUndefined();
    expect(r.hasServer("slack")).toBe(false);
    expect(r.toolsForServer("slack")).toEqual([]);
    expect(r.search("anything")).toEqual([]);
  });

  it("registers tools across two servers and returns them sorted", () => {
    const r = new McpToolRegistry();
    r.register("slack", {
      tool: "search",
      description: "Search Slack messages",
      inputSchema: exampleSchema(),
    });
    r.register("github", {
      tool: "list_repos",
      description: "List GitHub repos",
      inputSchema: exampleSchema(),
    });
    r.register("slack", {
      tool: "chat_post",
      description: "Post a Slack message",
      inputSchema: exampleSchema(),
    });
    const sorted = r.entries().map((e) => `${e.server}/${e.tool}`);
    expect(sorted).toEqual([
      "github/list_repos",
      "slack/chat_post",
      "slack/search",
    ]);
    expect(r.size).toBe(3);
  });

  it("get returns the registered metadata for a known tool", () => {
    const r = new McpToolRegistry();
    r.register("slack", {
      tool: "search",
      description: "Search messages",
      inputSchema: exampleSchema(),
    });
    const entry = r.get("slack", "search");
    expect(entry).toEqual({
      server: "slack",
      tool: "search",
      description: "Search messages",
      inputSchema: exampleSchema(),
    });
  });

  it("get returns undefined for an unknown server", () => {
    const r = new McpToolRegistry();
    r.register("slack", {
      tool: "search",
      description: "",
      inputSchema: {},
    });
    expect(r.get("github", "search")).toBeUndefined();
  });

  it("get returns undefined for an unknown tool on a known server", () => {
    const r = new McpToolRegistry();
    r.register("slack", {
      tool: "search",
      description: "",
      inputSchema: {},
    });
    expect(r.get("slack", "missing")).toBeUndefined();
  });

  it("registering a duplicate tool overwrites the prior entry", () => {
    const r = new McpToolRegistry();
    r.register("slack", {
      tool: "search",
      description: "first",
      inputSchema: { v: 1 },
    });
    r.register("slack", {
      tool: "search",
      description: "second",
      inputSchema: { v: 2 },
    });
    expect(r.get("slack", "search")?.description).toBe("second");
    expect(r.size).toBe(1);
  });

  describe("search", () => {
    it("matches by substring against tool name", () => {
      const r = new McpToolRegistry();
      r.register("slack", { tool: "search", description: "", inputSchema: {} });
      r.register("slack", {
        tool: "chat_post",
        description: "",
        inputSchema: {},
      });
      const results = r.search("post").map((e) => e.tool);
      expect(results).toEqual(["chat_post"]);
    });

    it("matches by substring against description", () => {
      const r = new McpToolRegistry();
      r.register("slack", {
        tool: "alpha",
        description: "post to channel",
        inputSchema: {},
      });
      r.register("github", {
        tool: "beta",
        description: "list repositories",
        inputSchema: {},
      });
      const results = r.search("repositor").map((e) => e.tool);
      expect(results).toEqual(["beta"]);
    });

    it("is case-insensitive", () => {
      const r = new McpToolRegistry();
      r.register("slack", { tool: "SEARCH", description: "", inputSchema: {} });
      expect(r.search("search").map((e) => e.tool)).toEqual(["SEARCH"]);
    });

    it("returns matches sorted by (server, tool)", () => {
      const r = new McpToolRegistry();
      r.register("slack", { tool: "search", description: "", inputSchema: {} });
      r.register("github", {
        tool: "search",
        description: "",
        inputSchema: {},
      });
      const results = r.search("search").map((e) => `${e.server}/${e.tool}`);
      expect(results).toEqual(["github/search", "slack/search"]);
    });

    it("returns empty array when no matches", () => {
      const r = new McpToolRegistry();
      r.register("slack", { tool: "search", description: "", inputSchema: {} });
      expect(r.search("nothing")).toEqual([]);
    });

    it("empty query returns all entries", () => {
      const r = new McpToolRegistry();
      r.register("slack", { tool: "search", description: "", inputSchema: {} });
      r.register("github", {
        tool: "list_repos",
        description: "",
        inputSchema: {},
      });
      expect(r.search("").length).toBe(2);
    });

    it("omits inputSchema when includeSchemas is false (default)", () => {
      const r = new McpToolRegistry();
      r.register("slack", {
        tool: "search",
        description: "",
        inputSchema: exampleSchema(),
      });
      const result = r.search("search")[0];
      expect(result?.inputSchema).toBeUndefined();
    });

    it("returns inputSchema when includeSchemas is true", () => {
      const r = new McpToolRegistry();
      r.register("slack", {
        tool: "search",
        description: "",
        inputSchema: exampleSchema(),
      });
      const result = r.search("search", { includeSchemas: true })[0];
      expect(result?.inputSchema).toEqual(exampleSchema());
    });

    it("includeSchemas does not mutate the stored entry", () => {
      const r = new McpToolRegistry();
      r.register("slack", {
        tool: "search",
        description: "",
        inputSchema: exampleSchema(),
      });
      r.search("search");
      // After a no-schemas search, the stored entry must still carry the schema
      // so a follow-up `get` returns it unchanged.
      expect(r.get("slack", "search")?.inputSchema).toEqual(exampleSchema());
    });
  });

  it("toolsForServer returns a sorted list", () => {
    const r = new McpToolRegistry();
    r.register("slack", { tool: "search", description: "", inputSchema: {} });
    r.register("slack", {
      tool: "chat_post",
      description: "",
      inputSchema: {},
    });
    r.register("slack", {
      tool: "alpha",
      description: "",
      inputSchema: {},
    });
    expect(r.toolsForServer("slack")).toEqual([
      "alpha",
      "chat_post",
      "search",
    ]);
  });
});

describe("validateDirectTools", () => {
  it("returns ok=true on an empty allowlist", () => {
    const r = new McpToolRegistry();
    expect(validateDirectTools([], r)).toEqual({ ok: true });
  });

  it("returns ok=true when every directTool is registered", () => {
    const r = new McpToolRegistry();
    r.register("slack", { tool: "search", description: "", inputSchema: {} });
    r.register("github", {
      tool: "list_repos",
      description: "",
      inputSchema: {},
    });
    const result = validateDirectTools(
      [
        { server: "slack", tool: "search" },
        { server: "github", tool: "list_repos" },
      ],
      r,
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns ok=false when the server is unknown", () => {
    const r = new McpToolRegistry();
    const result = validateDirectTools(
      [{ server: "slack", tool: "search" }],
      r,
    );
    expect(result).toEqual({
      ok: false,
      missing: [
        {
          server: "slack",
          tool: "search",
          availableTools: [],
          reason: "server_not_configured",
        },
      ],
    });
  });

  it("returns ok=false naming available tools when the server is known but the tool is not", () => {
    const r = new McpToolRegistry();
    r.register("slack", { tool: "search", description: "", inputSchema: {} });
    r.register("slack", {
      tool: "chat_post",
      description: "",
      inputSchema: {},
    });
    const result = validateDirectTools(
      [{ server: "slack", tool: "saerch" }], // typo
      r,
    );
    expect(result).toEqual({
      ok: false,
      missing: [
        {
          server: "slack",
          tool: "saerch",
          availableTools: ["chat_post", "search"],
          reason: "tool_not_listed",
        },
      ],
    });
  });

  it("returns ALL missing entries, not just the first", () => {
    const r = new McpToolRegistry();
    r.register("slack", { tool: "search", description: "", inputSchema: {} });
    const result = validateDirectTools(
      [
        { server: "slack", tool: "missing_a" },
        { server: "slack", tool: "search" }, // valid
        { server: "github", tool: "missing_b" },
      ],
      r,
    );
    if (result.ok) throw new Error("expected mismatch");
    expect(result.missing.map((m) => `${m.server}/${m.tool}`)).toEqual([
      "slack/missing_a",
      "github/missing_b",
    ]);
  });
});
