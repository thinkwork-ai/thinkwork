import { describe, it, expect } from "vitest";
import {
  MemoryGraph,
  KnowledgeGraph,
  MemoryGraphQuery,
  KnowledgeGraphQuery,
  buildKnowledgeGraphData,
  deriveGraphClassification,
  knowledgeGraphTrustState,
  MEMORY_COLOR,
  ENTITY_COLOR,
  MEMORY_TYPE_COLORS,
} from "./index.js";

describe("@thinkwork/graph public API", () => {
  it("exports the two ForceGraph components", () => {
    expect(MemoryGraph).toBeDefined();
    expect(KnowledgeGraph).toBeDefined();
  });

  it("exports gql query documents with the right operation names", () => {
    const memOp = (MemoryGraphQuery as any).definitions[0];
    const kgOp = (KnowledgeGraphQuery as any).definitions[0];
    expect(memOp.operation).toBe("query");
    expect(memOp.name.value).toBe("MemoryGraph");
    expect(kgOp.operation).toBe("query");
    expect(kgOp.name.value).toBe("KnowledgeGraph");
  });

  it("exposes the memory palette", () => {
    expect(MEMORY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ENTITY_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(MEMORY_TYPE_COLORS).length).toBeGreaterThan(0);
  });

  it("builds knowledge graph data and classifies filter neighbors", () => {
    const graph = buildKnowledgeGraphData({
      nodes: [
        {
          id: "a",
          entityId: "a",
          label: "A",
          groundingStatus: "GROUNDED",
          provenanceStatus: "STRONG",
        },
        {
          id: "b",
          entityId: "b",
          label: "B",
          groundingStatus: "UNGROUNDED",
          provenanceStatus: "STRONG",
        },
        {
          id: "orphan",
          entityId: "orphan",
          label: "Orphan",
          groundingStatus: "GROUNDED",
          provenanceStatus: "WEAK",
        },
      ],
      edges: [
        {
          id: "e1",
          relationshipId: "r1",
          source: "a",
          target: "b",
          label: "mentions",
          groundingStatus: "GROUNDED",
          provenanceStatus: "STRONG",
          evidenceCount: 1,
        },
        {
          id: "missing",
          relationshipId: "missing",
          source: "a",
          target: "missing",
          label: "ignored",
        },
      ],
    });

    expect(graph.links).toHaveLength(1);
    expect(knowledgeGraphTrustState(graph.nodes[0]!)).toBe("trusted");
    expect(knowledgeGraphTrustState(graph.nodes[1]!)).toBe("diagnostic");
    expect(knowledgeGraphTrustState(graph.nodes[2]!)).toBe("weak");

    const classification = deriveGraphClassification(
      new Set(["a"]),
      graph.links,
    );
    expect(classification?.neighborIds.has("b")).toBe(true);
    expect(classification?.neighborIds.has("orphan")).toBe(false);
  });
});
