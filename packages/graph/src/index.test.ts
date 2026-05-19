import { describe, it, expect } from "vitest";
import {
  MemoryGraph,
  WikiGraph,
  MemoryGraphQuery,
  WikiGraphQuery,
  buildConnectedWikiGraphData,
  MEMORY_COLOR,
  ENTITY_COLOR,
  MEMORY_TYPE_COLORS,
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_FORCE_COLORS,
  pageTypeLabel,
} from "./index.js";

describe("@thinkwork/graph public API", () => {
  it("exports the two ForceGraph components", () => {
    expect(MemoryGraph).toBeDefined();
    expect(WikiGraph).toBeDefined();
  });

  it("exports gql query documents with the right operation names", () => {
    const memOp = (MemoryGraphQuery as any).definitions[0];
    const wikiOp = (WikiGraphQuery as any).definitions[0];
    expect(memOp.operation).toBe("query");
    expect(memOp.name.value).toBe("MemoryGraph");
    expect(wikiOp.operation).toBe("query");
    expect(wikiOp.name.value).toBe("WikiGraph");
  });

  it("exposes the memory palette", () => {
    expect(MEMORY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ENTITY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(MEMORY_TYPE_COLORS).length).toBeGreaterThan(0);
  });

  it("exposes the wiki palette with three page types", () => {
    expect(PAGE_TYPES).toEqual(["ENTITY", "TOPIC", "DECISION"]);
    expect(PAGE_TYPE_LABELS.ENTITY).toBe("Entity");
    expect(PAGE_TYPE_FORCE_COLORS.DECISION).toMatch(/^#[0-9a-f]{6}$/i);
    expect(pageTypeLabel("TOPIC")).toBe("Topic");
    expect(pageTypeLabel(undefined)).toBe("Page");
  });

  it("builds wiki graph data from connected triples only", () => {
    const nodes = [
      {
        id: "u1:a",
        pageId: "a",
        agentId: "u1",
        label: "A",
        nodeType: "page",
        entityType: "ENTITY",
        slug: "a",
        edgeCount: 1,
      },
      {
        id: "u1:b",
        pageId: "b",
        agentId: "u1",
        label: "B",
        nodeType: "page",
        entityType: "ENTITY",
        slug: "b",
        edgeCount: 1,
      },
      {
        id: "u1:orphan",
        pageId: "orphan",
        agentId: "u1",
        label: "Orphan",
        nodeType: "page",
        entityType: "ENTITY",
        slug: "orphan",
        edgeCount: 0,
      },
    ] as const;

    const graph = buildConnectedWikiGraphData(nodes as any, [
      [
        "u1",
        {
          edges: [
            { source: "a", target: "b", label: "has task", weight: 0.7 },
            { source: "a", target: "missing", label: "ignored" },
          ],
        },
      ],
    ]);

    expect(graph.nodes.map((n) => n.id)).toEqual(["u1:a", "u1:b"]);
    expect(graph.links).toEqual([
      { source: "u1:a", target: "u1:b", label: "has task", weight: 0.7 },
    ]);
  });
});
