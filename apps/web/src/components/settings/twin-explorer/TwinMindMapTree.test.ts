import { describe, expect, it } from "vitest";
import type { TwinGraphLink, TwinGraphNode } from "@thinkwork/graph";
import {
  addMembers,
  addRoot,
  createTraversal,
  groupKey,
  setGroupExpanded,
  setSummary,
} from "./TwinTraversal";
import {
  buildMindMap,
  layoutMindMap,
  PILL_H,
  type MindMapNode,
} from "./TwinMindMapTree";

function entity(id: string, label = id, typeLabel = "customer"): TwinGraphNode {
  return {
    id: `t#ten-1#e#${id}`,
    canonicalId: id,
    label,
    typeLabel,
    isSystem: false,
    isCenter: false,
    properties: {},
  };
}

function link(rel: string, sourceId: string, targetId: string): TwinGraphLink {
  return {
    id: `${rel}:${sourceId}->${targetId}`,
    source: sourceId,
    target: targetId,
    label: rel,
    properties: {},
  };
}

const PAUL = entity("paul", "Paul Whisman", "sales_rep");

function ringState() {
  const state = createTraversal();
  addRoot(state, PAUL);
  setSummary(state, PAUL.id, [
    {
      relationship: "serves",
      direction: "out",
      targetType: "customer",
      count: 20,
    },
    {
      relationship: "reports_to",
      direction: "in",
      targetType: "person",
      count: 2,
    },
  ]);
  return state;
}

describe("buildMindMap", () => {
  it("splits root children by direction: out → right, in → left", () => {
    const model = buildMindMap(ringState());
    expect(model.roots).toHaveLength(1);
    const tree = model.roots[0]!;
    expect(tree.right.map((n) => n.relationship)).toEqual(["serves"]);
    expect(tree.left.map((n) => n.relationship)).toEqual(["reports_to"]);
    expect(tree.right[0]!.kind).toBe("summary");
    expect(tree.right[0]!.count).toBe(20);
    expect(tree.right[0]!.expanded).toBe(false);
  });

  it("labels resolve through the display-name accessors", () => {
    const model = buildMindMap(ringState(), {
      relationshipLabel: () => "Serves",
      typeLabel: (slug) => (slug === "customer" ? "Customers" : slug),
    });
    expect(model.roots[0]!.right[0]!.label).toBe("Customers");
    expect(model.roots[0]!.right[0]!.relationship).toBe("Serves");
  });

  it("expanded groups list loaded members plus a '+N more…' child", () => {
    const state = ringState();
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 20,
    };
    const key = groupKey(PAUL.id, row);
    const members = [entity("a", "ACME"), entity("b", "Beta LLC")];
    addMembers(
      state,
      key,
      members,
      members.map((m) => link("serves", PAUL.id, m.id)),
    );
    setGroupExpanded(state, key, true);

    // Loaded members REPLACE the hub: they attach directly to the focal
    // (customer feedback 2026-07-23 — no collapse for now).
    const right = buildMindMap(state).roots[0]!.right;
    expect(right.map((n) => n.kind)).toEqual(["entity", "entity", "more"]);
    expect(right[2]!.label).toBe("+18 more…");
    // Member entities carry the real edge for the sheet; only the first
    // branch of the group carries the relationship label.
    expect(right[0]!.edge?.label).toBe("serves");
    expect(right[0]!.relationship).toBe("serves");
    expect(right[1]!.relationship).toBeUndefined();
  });

  it("members stay attached directly to the focal regardless of the expanded flag", () => {
    const state = ringState();
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 20,
    };
    const key = groupKey(PAUL.id, row);
    addMembers(
      state,
      key,
      [entity("a")],
      [link("serves", PAUL.id, entity("a").id)],
    );
    setGroupExpanded(state, key, true);
    expect(buildMindMap(state).roots[0]!.right.map((n) => n.kind)).toEqual([
      "entity",
      "more",
    ]);
    // The hub never comes back once members are loaded — no collapse.
    setGroupExpanded(state, key, false);
    expect(buildMindMap(state).roots[0]!.right.map((n) => n.kind)).toEqual([
      "entity",
      "more",
    ]);
  });

  it("a singleton group inlines its member with the relationship on the branch", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 1,
    };
    setSummary(state, PAUL.id, [row]);
    const solo = entity("solo", "Solo Corp");
    addMembers(
      state,
      groupKey(PAUL.id, row),
      [solo],
      [link("serves", PAUL.id, solo.id)],
    );
    const tree = buildMindMap(state).roots[0]!;
    expect(tree.right).toHaveLength(1);
    expect(tree.right[0]!.kind).toBe("entity");
    expect(tree.right[0]!.label).toBe("Solo Corp");
    expect(tree.right[0]!.relationship).toBe("serves");
  });

  it("an already-placed entity becomes a cross-link, never a duplicate", () => {
    const state = createTraversal();
    const jane = entity("jane", "Jane", "sales_rep");
    addRoot(state, PAUL);
    addRoot(state, jane);
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 1,
    };
    setSummary(state, PAUL.id, [row]);
    setSummary(state, jane.id, [row]);
    const shared = entity("acme", "ACME");
    addMembers(
      state,
      groupKey(PAUL.id, row),
      [shared],
      [link("serves", PAUL.id, shared.id)],
    );
    addMembers(
      state,
      groupKey(jane.id, row),
      [shared],
      [link("serves", jane.id, shared.id)],
    );
    const model = buildMindMap(state);
    const countPlacements = (nodes: MindMapNode[]): number =>
      nodes.reduce(
        (sum, n) =>
          sum + (n.id === shared.id ? 1 : 0) + countPlacements(n.children),
        0,
      );
    const placements = model.roots.reduce(
      (sum, tree) =>
        sum + countPlacements(tree.left) + countPlacements(tree.right),
      0,
    );
    expect(placements).toBe(1);
    expect(model.crossLinks).toHaveLength(1);
    expect(model.crossLinks[0]!.toId).toBe(shared.id);
  });

  it("an empty ring yields a 'no relations' child", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    setSummary(state, PAUL.id, []);
    const tree = buildMindMap(state).roots[0]!;
    expect(tree.right.map((n) => n.kind)).toEqual(["none"]);
  });
});

describe("layoutMindMap", () => {
  function expandedState(memberCount: number) {
    const state = ringState();
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 20,
    };
    const key = groupKey(PAUL.id, row);
    const members = Array.from({ length: memberCount }, (_, i) =>
      entity(`m${i}`, `Member ${i}`),
    );
    addMembers(
      state,
      key,
      members,
      members.map((m) => link("serves", PAUL.id, m.id)),
    );
    setGroupExpanded(state, key, true);
    return state;
  }

  it("places out-summaries right of the root and in-summaries left", () => {
    const layout = layoutMindMap(buildMindMap(ringState()));
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const right = layout.nodes.find((n) => n.node?.relationship === "serves")!;
    const left = layout.nodes.find(
      (n) => n.node?.relationship === "reports_to",
    )!;
    expect(right.x).toBeGreaterThan(root.x + root.width);
    expect(left.x + left.width).toBeLessThan(root.x);
  });

  it("sibling pills never overlap vertically", () => {
    const layout = layoutMindMap(buildMindMap(expandedState(8)));
    const members = layout.nodes.filter((n) => n.node?.kind === "entity");
    expect(members.length).toBe(8);
    const sorted = [...members].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + PILL_H);
    }
  });

  it("parents are vertically centered on their children's span", () => {
    const layout = layoutMindMap(buildMindMap(expandedState(5)));
    // Loaded members attach directly to the focal root (hub replaced).
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const children = layout.nodes.filter(
      (n) => n.parentId === root.id && n.side === "right",
    );
    expect(children.length).toBeGreaterThanOrEqual(5);
    const minY = Math.min(...children.map((n) => n.y));
    const maxY = Math.max(...children.map((n) => n.y + n.height));
    const mid = (minY + maxY) / 2;
    expect(Math.abs(root.y + root.height / 2 - mid)).toBeLessThan(1);
  });

  it("every edge references placed nodes and layout box covers them", () => {
    const layout = layoutMindMap(buildMindMap(expandedState(3)));
    const ids = new Set(layout.nodes.map((n) => n.id));
    for (const edge of layout.edges) {
      expect(ids.has(edge.fromId)).toBe(true);
      expect(ids.has(edge.toId)).toBe(true);
    }
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });
});
