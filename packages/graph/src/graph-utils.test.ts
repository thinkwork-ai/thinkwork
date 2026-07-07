import { describe, expect, it } from "vitest";
import {
  endpointId,
  normalizeGraphSearch,
  classifyNode,
  deriveGraphClassification,
  connectedGraphEdges,
  detectCommunities,
  expandNeighborhood,
  composeGraphClassification,
  computeCommunityAnchors,
  carryNodePositions,
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

describe("detectCommunities", () => {
  // Two dense triangles joined by one bridge edge.
  const clusteredNodes = ["a1", "a2", "a3", "b1", "b2", "b3"].map((id) => ({
    id,
  }));
  const clusteredLinks = [
    { source: "a1", target: "a2" },
    { source: "a2", target: "a3" },
    { source: "a3", target: "a1" },
    { source: "b1", target: "b2" },
    { source: "b2", target: "b3" },
    { source: "b3", target: "b1" },
    { source: "a1", target: "b1" },
  ];

  it("assigns every node exactly one community", () => {
    const communities = detectCommunities(clusteredNodes, clusteredLinks);
    expect(communities.size).toBe(6);
    for (const node of clusteredNodes) {
      expect(communities.has(node.id)).toBe(true);
    }
  });

  it("groups dense clusters together and separates them across the bridge", () => {
    const communities = detectCommunities(clusteredNodes, clusteredLinks);
    expect(communities.get("a1")).toBe(communities.get("a2"));
    expect(communities.get("a2")).toBe(communities.get("a3"));
    expect(communities.get("b1")).toBe(communities.get("b2"));
    expect(communities.get("b2")).toBe(communities.get("b3"));
    expect(communities.get("a1")).not.toBe(communities.get("b1"));
  });

  it("is deterministic: same seed produces identical partitions", () => {
    const first = detectCommunities(clusteredNodes, clusteredLinks, {
      seed: 7,
    });
    const second = detectCommunities(clusteredNodes, clusteredLinks, {
      seed: 7,
    });
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("handles an edgeless graph with singleton communities", () => {
    const communities = detectCommunities(
      [{ id: "x" }, { id: "y" }],
      [],
    );
    expect(communities.get("x")).not.toBe(communities.get("y"));
    expect(communities.size).toBe(2);
  });

  it("returns empty for an empty graph without throwing", () => {
    expect(detectCommunities([], []).size).toBe(0);
  });

  it("tolerates parallel edges, self-loops, and dangling endpoints", () => {
    const communities = detectCommunities(
      [{ id: "a" }, { id: "b" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "b" },
        { source: "a", target: "a" },
        { source: "a", target: "ghost" },
      ],
    );
    expect(communities.size).toBe(2);
  });

  it("handles object-style endpoints", () => {
    const communities = detectCommunities(
      [{ id: "a" }, { id: "b" }],
      [{ source: { id: "a" }, target: { id: "b" } }],
    );
    expect(communities.get("a")).toBe(communities.get("b"));
  });
});

describe("expandNeighborhood", () => {
  // Chain: seed - n1 - n2 - n3, plus a direct neighbor n4.
  const chainLinks = [
    { source: "seed", target: "n1" },
    { source: "n1", target: "n2" },
    { source: "n2", target: "n3" },
    { source: "seed", target: "n4" },
  ];

  it("expands 2 degrees: seed + neighbors + neighbors-of-neighbors", () => {
    const result = expandNeighborhood(["seed"], chainLinks, 2, 100);
    expect([...result.ids].sort()).toEqual(["n1", "n2", "n4", "seed"]);
    expect(result.degreeUsed).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("isolated node expands to itself without truncation", () => {
    const result = expandNeighborhood(["lone"], chainLinks, 2, 100);
    expect([...result.ids]).toEqual(["lone"]);
    expect(result.truncated).toBe(false);
  });

  it("empty seed set returns empty without throwing", () => {
    const result = expandNeighborhood([], chainLinks, 2, 100);
    expect(result.ids.size).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("empty graph returns just the seed", () => {
    const result = expandNeighborhood(["seed"], [], 2, 100);
    expect([...result.ids]).toEqual(["seed"]);
    expect(result.truncated).toBe(false);
  });

  it("size exactly at cap does not truncate", () => {
    // 2-degree set is exactly 4 nodes.
    const result = expandNeighborhood(["seed"], chainLinks, 2, 4);
    expect(result.degreeUsed).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("size one over cap falls back to 1 degree with truncated flag", () => {
    const result = expandNeighborhood(["seed"], chainLinks, 2, 3);
    expect(result.degreeUsed).toBe(1);
    expect(result.truncated).toBe(true);
    expect([...result.ids].sort()).toEqual(["n1", "n4", "seed"]);
  });

  it("degree 1 is accepted even when it exceeds the cap (hub node)", () => {
    const hubLinks = Array.from({ length: 10 }, (_, i) => ({
      source: "hub",
      target: `leaf-${i}`,
    }));
    const result = expandNeighborhood(["hub"], hubLinks, 2, 5);
    expect(result.degreeUsed).toBe(1);
    expect(result.ids.size).toBe(11);
    expect(result.truncated).toBe(true);
  });

  it("multi-agent prefixed ids traverse without crossing subgraphs", () => {
    const links = [
      { source: "u1:p1", target: "u1:p2" },
      { source: "u1:p2", target: "u1:p3" },
      { source: "u2:p1", target: "u2:p2" },
    ];
    const result = expandNeighborhood(["u1:p1"], links, 2, 100);
    expect([...result.ids].sort()).toEqual(["u1:p1", "u1:p2", "u1:p3"]);
  });

  it("handles object-style endpoints", () => {
    const result = expandNeighborhood(
      ["a"],
      [{ source: { id: "a" }, target: { id: "b" } }],
      2,
      100,
    );
    expect([...result.ids].sort()).toEqual(["a", "b"]);
  });
});

describe("composeGraphClassification", () => {
  const search = {
    matchedIds: new Set(["s1"]),
    neighborIds: new Set(["s2"]),
  };
  const focus = {
    focusedId: "f1",
    litIds: new Set(["f1", "f2"]),
    degreeUsed: 2,
    truncated: false,
  };

  it("returns focus classification when focus is active", () => {
    const result = composeGraphClassification(search, focus);
    expect(result!.matchedIds).toBe(focus.litIds);
    expect(result!.neighborIds.size).toBe(0);
  });

  it("focus wins even when search is null", () => {
    const result = composeGraphClassification(null, focus);
    expect(result!.matchedIds).toBe(focus.litIds);
  });

  it("returns search classification untouched once focus clears", () => {
    expect(composeGraphClassification(search, null)).toBe(search);
  });

  it("returns null when neither is active", () => {
    expect(composeGraphClassification(null, null)).toBeNull();
  });
});

describe("computeCommunityAnchors", () => {
  it("places a single community at the origin without NaN", () => {
    const communityByNode = new Map([
      ["a", 0],
      ["b", 0],
      ["c", 0],
    ]);
    const anchors = computeCommunityAnchors(communityByNode);
    expect(anchors.size).toBe(1);
    expect(anchors.get(0)).toEqual({ x: 0, y: 0 });
  });

  it("gives every community a distinct finite anchor", () => {
    const communityByNode = new Map<string, number>();
    for (let c = 0; c < 5; c += 1) {
      for (let n = 0; n < (5 - c) * 3; n += 1) {
        communityByNode.set(`c${c}-n${n}`, c);
      }
    }
    const anchors = computeCommunityAnchors(communityByNode);
    expect(anchors.size).toBe(5);
    const seen = new Set<string>();
    for (const anchor of anchors.values()) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
      seen.add(`${anchor.x.toFixed(3)},${anchor.y.toFixed(3)}`);
    }
    expect(seen.size).toBe(5);
  });

  it("puts the largest community at the origin", () => {
    const communityByNode = new Map([
      ["a", 7],
      ["b", 3],
      ["c", 3],
      ["d", 3],
    ]);
    const anchors = computeCommunityAnchors(communityByNode);
    expect(anchors.get(3)).toEqual({ x: 0, y: 0 });
    expect(anchors.get(7)).not.toEqual({ x: 0, y: 0 });
  });

  it("returns empty for an empty map", () => {
    expect(computeCommunityAnchors(new Map()).size).toBe(0);
  });

  it("spreads anchors farther apart with a larger gap", () => {
    const communityByNode = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const near = computeCommunityAnchors(communityByNode, { gap: 1 });
    const far = computeCommunityAnchors(communityByNode, { gap: 2 });
    const dist = (m: Map<number, { x: number; y: number }>) =>
      Math.hypot(m.get(1)!.x - m.get(0)!.x, m.get(1)!.y - m.get(0)!.y);
    expect(dist(far)).toBeGreaterThan(dist(near));
  });
});

describe("carryNodePositions", () => {
  it("copies positions and pins from previous nodes by id", () => {
    const prev = [
      { id: "a", x: 10, y: 20, vx: 1, vy: 2, fx: 10, fy: 20 },
      { id: "b", x: -5, y: 3 },
    ];
    const next = [{ id: "a" }, { id: "b" }, { id: "c" }] as any[];
    carryNodePositions(prev, next);
    expect(next[0]).toMatchObject({ x: 10, y: 20, fx: 10, fy: 20 });
    expect(next[1]).toMatchObject({ x: -5, y: 3 });
    expect(next[1].fx).toBeUndefined();
    expect(next[2].x).toBeUndefined();
  });

  it("is a no-op with null or empty previous", () => {
    const next = [{ id: "a" }] as any[];
    expect(carryNodePositions(null, next)).toBe(next);
    expect(carryNodePositions([], next)).toBe(next);
    expect((next[0] as any).x).toBeUndefined();
  });
});
