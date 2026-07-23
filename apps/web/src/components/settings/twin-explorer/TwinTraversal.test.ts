import { describe, expect, it } from "vitest";
import type { TwinGraphLink, TwinGraphNode } from "@thinkwork/graph";
import {
  addMembers,
  addRoot,
  buildTraversalGraphData,
  createTraversal,
  groupKey,
  groupKeyFromSyntheticId,
  removeRoot,
  setGroupExpanded,
  setSummary,
} from "./TwinTraversal";

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

describe("buildTraversalGraphData — summary ring (AE1, R5)", () => {
  it("renders one summary node per (relationship, type) with counts and edge labels", () => {
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
        relationship: "ships_to",
        direction: "out",
        targetType: "customer",
        count: 18,
      },
    ]);

    const data = buildTraversalGraphData(state);
    const summaries = data.nodes.filter((n) => n.kind === "summary");
    expect(summaries.map((n) => n.label).sort()).toEqual([
      "customer (18)",
      "customer (20)",
    ]);
    expect(data.links.map((l) => l.label).sort()).toEqual([
      "serves",
      "ships_to",
    ]);
    expect(data.nodes.find((n) => n.id === PAUL.id)?.isCenter).toBe(true);
  });

  it("labels resolve through the display-name accessors", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    setSummary(state, PAUL.id, [
      {
        relationship: "serves",
        direction: "out",
        targetType: "customer",
        count: 2,
      },
    ]);
    const data = buildTraversalGraphData(state, {
      relationshipLabel: () => "Serves",
      typeLabel: () => "Customers",
    });
    expect(data.nodes.find((n) => n.kind === "summary")?.label).toBe(
      "Customers (2)",
    );
    expect(data.links[0]?.label).toBe("Serves");
  });

  it("an empty ring renders the focal with a '(no relations)' affordance", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    setSummary(state, PAUL.id, []);
    const data = buildTraversalGraphData(state);
    expect(data.nodes.map((n) => n.id)).toContain(`none:${PAUL.id}`);
    expect(data.nodes.find((n) => n.kind === "none")?.label).toBe(
      "(no relations)",
    );
  });

  it("an unfetched ring renders the focal alone", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    const data = buildTraversalGraphData(state);
    expect(data.nodes).toHaveLength(1);
    expect(data.links).toHaveLength(0);
  });
});

describe("expansion batches (AE2, R11)", () => {
  function bigGroupState(count: number) {
    const state = createTraversal();
    addRoot(state, PAUL);
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count,
    };
    setSummary(state, PAUL.id, [row]);
    return { state, key: groupKey(PAUL.id, row) };
  }

  it("first batch renders 20 members plus a '+N more…' node; next batch decrements", () => {
    const { state, key } = bigGroupState(2000);
    const batch1 = Array.from({ length: 20 }, (_, i) =>
      entity(`c${String(i).padStart(2, "0")}`),
    );
    addMembers(
      state,
      key,
      batch1,
      batch1.map((m) => link("serves", PAUL.id, m.id)),
    );
    setGroupExpanded(state, key, true);

    let data = buildTraversalGraphData(state);
    expect(data.nodes.filter((n) => !n.kind && n.id !== PAUL.id)).toHaveLength(
      20,
    );
    const more = data.nodes.find((n) => n.kind === "more");
    expect(more?.label).toBe("+1980 more…");

    const batch2 = Array.from({ length: 20 }, (_, i) => entity(`d${i}`));
    addMembers(
      state,
      key,
      batch2,
      batch2.map((m) => link("serves", PAUL.id, m.id)),
    );
    data = buildTraversalGraphData(state);
    expect(data.nodes.filter((n) => !n.kind && n.id !== PAUL.id)).toHaveLength(
      40,
    );
    expect(data.nodes.find((n) => n.kind === "more")?.label).toBe(
      "+1960 more…",
    );
  });

  it("a fully loaded group renders no more-node", () => {
    const { state, key } = bigGroupState(3);
    const members = [entity("a"), entity("b"), entity("c")];
    addMembers(
      state,
      key,
      members,
      members.map((m) => link("serves", PAUL.id, m.id)),
    );
    setGroupExpanded(state, key, true);
    const data = buildTraversalGraphData(state);
    expect(data.nodes.find((n) => n.kind === "more")).toBeUndefined();
  });

  it("synthetic node identity is stable across rebuilds (camera discipline)", () => {
    const { state } = bigGroupState(5);
    const first = buildTraversalGraphData(state);
    const second = buildTraversalGraphData(state);
    const a = first.nodes.find((n) => n.kind === "summary");
    const b = second.nodes.find((n) => n.kind === "summary");
    expect(a).toBe(b);
  });
});

describe("collapse and multi-root semantics (R6, R9, AE3)", () => {
  it("collapsing hides members and their traversed sub-rings recursively", () => {
    const state = createTraversal();
    addRoot(state, PAUL);
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 1,
    };
    setSummary(state, PAUL.id, [row]);
    const key = groupKey(PAUL.id, row);
    const acme = entity("acme", "ACME");
    addMembers(state, key, [acme], [link("serves", PAUL.id, acme.id)]);
    setGroupExpanded(state, key, true);
    // ACME's own traversed ring.
    const orderRow = {
      relationship: "ordered",
      direction: "out" as const,
      targetType: "order",
      count: 4,
    };
    setSummary(state, acme.id, [orderRow]);

    let data = buildTraversalGraphData(state);
    expect(data.nodes.map((n) => n.id)).toContain(
      `sum:${groupKey(acme.id, orderRow)}`,
    );

    setGroupExpanded(state, key, false);
    data = buildTraversalGraphData(state);
    expect(data.nodes.map((n) => n.id)).not.toContain(acme.id);
    expect(data.nodes.map((n) => n.id)).not.toContain(
      `sum:${groupKey(acme.id, orderRow)}`,
    );

    // Re-expand: cached members return instantly, sub-ring included.
    setGroupExpanded(state, key, true);
    data = buildTraversalGraphData(state);
    expect(data.nodes.map((n) => n.id)).toContain(acme.id);
    expect(data.nodes.map((n) => n.id)).toContain(
      `sum:${groupKey(acme.id, orderRow)}`,
    );
  });

  it("two roots render two rings; shared nodes are not duplicated (AE3)", () => {
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
    setGroupExpanded(state, groupKey(PAUL.id, row), true);
    setGroupExpanded(state, groupKey(jane.id, row), true);

    const data = buildTraversalGraphData(state);
    expect(data.nodes.filter((n) => n.id === shared.id)).toHaveLength(1);
    expect(data.nodes.filter((n) => n.kind === "summary")).toHaveLength(2);
  });

  it("removing a root prunes its subtree but keeps nodes another root holds", () => {
    const state = createTraversal();
    const jane = entity("jane", "Jane", "sales_rep");
    addRoot(state, PAUL);
    addRoot(state, jane);
    const row = {
      relationship: "serves",
      direction: "out" as const,
      targetType: "customer",
      count: 2,
    };
    setSummary(state, PAUL.id, [row]);
    setSummary(state, jane.id, [row]);
    const shared = entity("acme", "ACME");
    const own = entity("solo", "Solo Corp");
    addMembers(
      state,
      groupKey(PAUL.id, row),
      [shared, own],
      [link("serves", PAUL.id, shared.id), link("serves", PAUL.id, own.id)],
    );
    addMembers(
      state,
      groupKey(jane.id, row),
      [shared],
      [link("serves", jane.id, shared.id)],
    );
    setGroupExpanded(state, groupKey(PAUL.id, row), true);
    setGroupExpanded(state, groupKey(jane.id, row), true);

    removeRoot(state, PAUL.id);
    const data = buildTraversalGraphData(state);
    const ids = data.nodes.map((n) => n.id);
    expect(ids).not.toContain(PAUL.id);
    expect(ids).not.toContain(own.id);
    expect(ids).toContain(shared.id);
    expect(ids).toContain(jane.id);
  });
});

describe("synthetic id helpers", () => {
  it("round-trips group keys through sum:/more: ids", () => {
    const key = groupKey(PAUL.id, {
      relationship: "serves",
      direction: "out",
      targetType: "customer",
    });
    expect(groupKeyFromSyntheticId(`sum:${key}`)).toBe(key);
    expect(groupKeyFromSyntheticId(`more:${key}`)).toBe(key);
    expect(groupKeyFromSyntheticId(PAUL.id)).toBeNull();
  });
});
