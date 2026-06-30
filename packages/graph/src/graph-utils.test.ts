import { describe, expect, it } from "vitest";
import {
  endpointId,
  normalizeGraphSearch,
  classifyNode,
  deriveGraphClassification,
  connectedGraphEdges,
} from "./graph-utils.js";

describe("endpointId", () => {
  it("returns the string directly for string endpoints", () => {
    expect(endpointId("node-1")).toBe("node-1");
  });

  it("returns the id property for object endpoints", () => {
    expect(endpointId({ id: "node-2" })).toBe("node-2");
  });
});

describe("normalizeGraphSearch", () => {
  it("lowercases the input", () => {
    expect(normalizeGraphSearch("Hello")).toBe("hello");
  });

  it("strips non-alphanumeric characters except spaces", () => {
    expect(normalizeGraphSearch("hello-world!")).toBe("helloworld");
  });

  it("collapses multiple spaces into one", () => {
    expect(normalizeGraphSearch("hello   world")).toBe("hello world");
  });

  it("trims whitespace", () => {
    expect(normalizeGraphSearch("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(normalizeGraphSearch("")).toBe("");
  });

  it("handles complex input", () => {
    expect(normalizeGraphSearch("  Hello, World!  (2026)  ")).toBe(
      "hello world 2026",
    );
  });
});

describe("classifyNode", () => {
  it("returns 'matched' when classification is null", () => {
    expect(classifyNode("any-id", null)).toBe("matched");
  });

  it("returns 'matched' when node is in matchedIds", () => {
    const classification = {
      matchedIds: new Set(["a", "b"]),
      neighborIds: new Set(["c"]),
    };
    expect(classifyNode("a", classification)).toBe("matched");
  });

  it("returns 'neighbor' when node is in neighborIds", () => {
    const classification = {
      matchedIds: new Set(["a"]),
      neighborIds: new Set(["b"]),
    };
    expect(classifyNode("b", classification)).toBe("neighbor");
  });

  it("returns 'other' when node is neither matched nor neighbor", () => {
    const classification = {
      matchedIds: new Set(["a"]),
      neighborIds: new Set(["b"]),
    };
    expect(classifyNode("c", classification)).toBe("other");
  });
});

describe("deriveGraphClassification", () => {
  it("returns null when matchedIds is null", () => {
    expect(
      deriveGraphClassification(null, [{ source: "a", target: "b" }]),
    ).toBeNull();
  });

  it("identifies neighbors connected to matched nodes", () => {
    const links = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const result = deriveGraphClassification(new Set(["a"]), links);
    expect(result).not.toBeNull();
    expect(result!.matchedIds.has("a")).toBe(true);
    expect(result!.neighborIds.has("b")).toBe(true);
    expect(result!.neighborIds.has("c")).toBe(false);
  });

  it("handles object-style endpoints", () => {
    const links = [{ source: { id: "a" }, target: { id: "b" } }];
    const result = deriveGraphClassification(new Set(["a"]), links);
    expect(result!.neighborIds.has("b")).toBe(true);
  });

  it("does not add matched nodes to neighborIds", () => {
    const links = [{ source: "a", target: "b" }];
    const result = deriveGraphClassification(new Set(["a", "b"]), links);
    expect(result!.neighborIds.size).toBe(0);
  });

  it("identifies neighbors from both directions", () => {
    const links = [{ source: "b", target: "a" }];
    const result = deriveGraphClassification(new Set(["a"]), links);
    expect(result!.neighborIds.has("b")).toBe(true);
  });
});

describe("connectedGraphEdges", () => {
  const nodes = [
    { id: "a", label: "Node A", nodeType: "entity" },
    { id: "b", label: "Node B", nodeType: "topic" },
    { id: "c", label: "Node C" },
  ];
  const links = [
    { source: "a", target: "b", label: "references" },
    { source: "c", target: "a", label: null },
    { source: "b", target: "c", label: "depends on" },
  ];

  it("returns edges connected to the specified node", () => {
    const edges = connectedGraphEdges("a", nodes, links);
    expect(edges).toHaveLength(2);
  });

  it("resolves the other node's label and type", () => {
    const edges = connectedGraphEdges("a", nodes, links);
    const refEdge = edges.find((e) => e.label === "references");
    expect(refEdge).toEqual({
      label: "references",
      targetLabel: "Node B",
      targetType: "topic",
      targetId: "b",
    });
  });

  it("uses fallback label 'related to' for null/empty link labels", () => {
    const edges = connectedGraphEdges("a", nodes, links);
    const nullLabelEdge = edges.find((e) => e.targetId === "c");
    expect(nullLabelEdge!.label).toBe("related to");
  });

  it("uses the fallback type when node has no nodeType", () => {
    const edges = connectedGraphEdges("b", nodes, links);
    const cEdge = edges.find((e) => e.targetId === "c");
    expect(cEdge!.targetType).toBe("entity");
  });

  it("uses a custom fallback type", () => {
    const edges = connectedGraphEdges("b", nodes, links, "page");
    const cEdge = edges.find((e) => e.targetId === "c");
    expect(cEdge!.targetType).toBe("page");
  });

  it("uses the id as fallback label when node is not found", () => {
    const edges = connectedGraphEdges("a", [], links);
    expect(edges[0].targetLabel).toBe("b");
  });

  it("returns empty array when no edges connect", () => {
    const edges = connectedGraphEdges("z", nodes, links);
    expect(edges).toEqual([]);
  });

  it("handles object-style endpoints", () => {
    const objLinks = [
      { source: { id: "a" }, target: { id: "b" }, label: "link" },
    ];
    const edges = connectedGraphEdges("a", nodes, objLinks);
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe("b");
  });
});
