import { describe, expect, it } from "vitest";
import { TOOLS } from "./mcp-context-engine.js";

/**
 * Regression guard for the wiki-backend removal arc (plan 2026-07-24-002, the
 * U4 follow-up).
 *
 * U4 removed both wiki providers from the core context set, but left
 * `query_wiki_context` advertised on the Context Engine MCP surface. The tool
 * filtered on `families: ["wiki"]`, so it matched nothing and returned an
 * empty result while still describing itself to agents as "Search compiled
 * wiki pages" — a tool that looks available and silently answers nothing is
 * worse than an absent one.
 *
 * These assertions fail if the tool, or the `wiki` provider family it selected
 * on, is ever re-advertised here.
 */
describe("Context Engine MCP tool surface — wiki removal", () => {
  it("advertises no wiki tool", () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(names).not.toContain("query_wiki_context");
    expect(names.filter((name) => name.includes("wiki"))).toEqual([]);
  });

  it("offers no wiki provider family to filter on", () => {
    // TOOLS is a deeply-literal const, so walk it structurally rather than
    // reaching through a union of per-tool schema shapes.
    const families = TOOLS.flatMap((tool) => {
      const schema = tool.inputSchema as {
        properties?: {
          providers?: {
            properties?: { families?: { items?: { enum?: string[] } } };
          };
        };
      };
      return (
        schema.properties?.providers?.properties?.families?.items?.enum ?? []
      );
    });

    expect(families.length).toBeGreaterThan(0);
    expect(families).not.toContain("wiki");
  });

  it("mentions no wiki surface in any tool description", () => {
    // The descriptions are the model's only signal about what a tool reaches.
    // A stale "wiki pages" mention would keep pointing agents at content that
    // no provider can return.
    const descriptions = TOOLS.map((tool) => tool.description.toLowerCase());

    expect(descriptions.filter((text) => text.includes("wiki"))).toEqual([]);
  });

  it("still advertises the surviving context tools", () => {
    const names = TOOLS.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "query_context",
        "query_memory_context",
        "query_brain_context",
        "list_context_providers",
      ]),
    );
  });
});
