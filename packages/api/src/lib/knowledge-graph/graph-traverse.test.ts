import { describe, expect, it, vi } from "vitest";

import {
  getKnowledgeGraphEntityDetail,
  getKnowledgeGraphNeighbors,
  MAX_NEIGHBOR_DEPTH,
  MAX_NEIGHBOR_EDGES,
} from "./graph-traverse.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const ENTITY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function entityRow(id: string, label: string) {
  return {
    id,
    source_kind: "observations",
    label,
    ontology_type_slug: null,
    summary: null,
    aliases: [],
    relationship_count: 1,
    evidence_count: 1,
  };
}

function edgeRow(id: string, from: string, to: string) {
  return {
    id,
    source_kind: "observations",
    label: "linked_to",
    ontology_type_slug: null,
    source_entity_id: from,
    target_entity_id: to,
    from_label: `label-${from.slice(0, 4)}`,
    to_label: `label-${to.slice(0, 4)}`,
  };
}

function routeDb(routes: Array<{ match: string; rows: unknown[][] }>) {
  const counters = new Map<string, number>();
  const execute = vi.fn(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query) ?? "";
    for (const route of routes) {
      if (text.includes(route.match)) {
        const n = counters.get(route.match) ?? 0;
        counters.set(route.match, n + 1);
        return { rows: route.rows[Math.min(n, route.rows.length - 1)] ?? [] };
      }
    }
    return { rows: [] };
  });
  return { db: { execute } as any, execute };
}

describe("getKnowledgeGraphEntityDetail", () => {
  it("returns the entity with its edges and observation refs, never snippets", async () => {
    const { db, execute } = routeDb([
      {
        match: "FROM knowledge_graph_entities",
        rows: [[entityRow(ENTITY, "Acme Corp")]],
      },
      {
        match: "FROM knowledge_graph_relationships",
        rows: [[edgeRow("r1", ENTITY, "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee")]],
      },
      {
        match: "knowledge_graph_evidence",
        rows: [[{ entity_id: ENTITY, evidence_source_ref: "obs-1" }]],
      },
    ]);

    const result = await getKnowledgeGraphEntityDetail({
      db,
      tenantId: TENANT,
      entityId: ENTITY,
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      id: ENTITY,
      label: "Acme Corp",
      observationIds: ["obs-1"],
    });
    expect(result.relationships).toHaveLength(1);
    // R17: no query ever selects the snippet column.
    for (const call of execute.mock.calls) {
      const text = JSON.stringify(call[0]?.queryChunks ?? call[0]);
      expect(text).not.toMatch(/snippet/);
    }
  });

  it("returns empty for unknown/out-of-scope entities without erroring", async () => {
    const { db } = routeDb([]);
    const result = await getKnowledgeGraphEntityDetail({
      db,
      tenantId: TENANT,
      entityId: ENTITY,
    });
    expect(result).toEqual({ entities: [], relationships: [] });
  });
});

describe("getKnowledgeGraphNeighbors", () => {
  it("expands via a depth-bounded recursive CTE with hard edge caps", async () => {
    const neighborId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const { db, execute } = routeDb([
      {
        match: "WITH RECURSIVE",
        rows: [[edgeRow("r1", ENTITY, neighborId)]],
      },
      {
        match: "FROM knowledge_graph_entities",
        rows: [
          [entityRow(ENTITY, "Acme Corp"), entityRow(neighborId, "Phoenix")],
        ],
      },
    ]);

    const result = await getKnowledgeGraphNeighbors({
      db,
      tenantId: TENANT,
      entityId: ENTITY,
      depth: 99, // clamped
    });

    const walkQuery = execute.mock.calls
      .map((call) => JSON.stringify(call[0]?.queryChunks ?? call[0]))
      .find((text) => text.includes("WITH RECURSIVE"));
    expect(walkQuery).toBeDefined();
    // Depth clamps to the bound; the raw 99 never reaches SQL.
    expect(walkQuery).toContain(String(MAX_NEIGHBOR_DEPTH));
    expect(walkQuery).not.toContain("99");
    expect(walkQuery).toContain(String(MAX_NEIGHBOR_EDGES));

    expect(result.entities.map((entity) => entity.label).sort()).toEqual([
      "Acme Corp",
      "Phoenix",
    ]);
    expect(result.relationships).toHaveLength(1);
  });

  it("caps returned edges in JS even if SQL over-returns (defense in depth)", async () => {
    const edges = Array.from({ length: MAX_NEIGHBOR_EDGES + 10 }, (_, i) =>
      edgeRow(`r${i}`, ENTITY, `cccccccc-bbbb-4ccc-8ddd-${String(i).padStart(12, "0")}`),
    );
    const { db } = routeDb([
      { match: "WITH RECURSIVE", rows: [edges] as never },
    ]);
    const result = await getKnowledgeGraphNeighbors({
      db,
      tenantId: TENANT,
      entityId: ENTITY,
    });
    expect(result.relationships.length).toBeLessThanOrEqual(MAX_NEIGHBOR_EDGES);
  });
});
