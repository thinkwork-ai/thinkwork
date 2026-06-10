import { describe, expect, it, vi } from "vitest";

import {
  MAX_ENTITY_LIMIT,
  MAX_RELATIONSHIP_LIMIT,
  searchKnowledgeGraph,
} from "./graph-search.js";

const TENANT_A = "0015953e-aa13-4cab-8398-2e70f73dda63";
const TENANT_B = "84381488-f071-7073-6bc7-d6238c147538";

function entityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    source_kind: "observations",
    label: "Acme Corp",
    ontology_type_slug: "company",
    summary: "Important customer account.",
    aliases: ["Acme"],
    relationship_count: 2,
    evidence_count: 3,
    ...overrides,
  };
}

function relationshipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    source_kind: "observations",
    label: "serves",
    ontology_type_slug: "serves",
    from_label: "Acme Corp",
    to_label: "Project Phoenix",
    ...overrides,
  };
}

/** Routes db.execute by SQL substring so multi-query flows stay readable. */
function routeDb(routes: Array<{ match: string; rows: unknown[] }>) {
  const calls: unknown[] = [];
  const execute = vi.fn(async (query: unknown) => {
    calls.push(query);
    const text = JSON.stringify(
      (query as { queryChunks?: unknown })?.queryChunks ?? query,
    );
    for (const route of routes) {
      if (text.includes(route.match)) {
        return { rows: route.rows };
      }
    }
    return { rows: [] };
  });
  return { db: { execute } as any, execute, calls };
}

function renderedQueries(calls: unknown[]): string[] {
  return calls.map((query) =>
    JSON.stringify((query as { queryChunks?: unknown })?.queryChunks ?? query),
  );
}

/** Recursively assert no `snippet` key exists anywhere in the value. */
function assertNoSnippetKey(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSnippetKey(item, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      expect(
        key.toLowerCase(),
        `unexpected snippet-ish key at ${path}`,
      ).not.toContain("snippet");
      assertNoSnippetKey(child, `${path}.${key}`);
    }
  }
}

describe("searchKnowledgeGraph", () => {
  it("matches by alias and returns entities, 1-hop relationships, and observation ids", async () => {
    const { db } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: [entityRow()] },
      {
        match: "FROM knowledge_graph_relationships",
        rows: [relationshipRow()],
      },
      {
        match: "FROM knowledge_graph_evidence",
        rows: [
          {
            entity_id: "11111111-1111-1111-1111-111111111111",
            evidence_source_ref: "obs-1",
          },
          {
            entity_id: "11111111-1111-1111-1111-111111111111",
            evidence_source_ref: "obs-2",
          },
        ],
      },
    ]);

    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "Acme",
    });

    expect(result.entities).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        label: "Acme Corp",
        typeSlug: "company",
        summary: "Important customer account.",
        aliases: ["Acme"],
        relationshipCount: 2,
        evidenceCount: 3,
        observationIds: ["obs-1", "obs-2"],
      },
    ]);
    expect(result.relationships).toEqual([
      {
        id: "22222222-2222-2222-2222-222222222222",
        label: "serves",
        typeSlug: "serves",
        fromLabel: "Acme Corp",
        toLabel: "Project Phoenix",
      },
    ]);
  });

  it("returns an empty result (not an error) for an unknown entity and skips expansion", async () => {
    const { db, execute } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: [] },
    ]);

    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "no-such-entity",
    });

    expect(result).toEqual({ entities: [], relationships: [] });
    // No relationship/evidence queries fire when nothing matched.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns an empty result for a blank query without touching the db", async () => {
    const { db, execute } = routeDb([]);
    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "   ",
    });
    expect(result).toEqual({ entities: [], relationships: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it("scopes every query to the caller tenant (tenant A never sees tenant B rows)", async () => {
    const { db, calls } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: [entityRow()] },
      { match: "FROM knowledge_graph_relationships", rows: [] },
      { match: "FROM knowledge_graph_evidence", rows: [] },
    ]);

    await searchKnowledgeGraph({ db, tenantId: TENANT_A, query: "Acme" });

    const queries = renderedQueries(calls);
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query).toContain(TENANT_A);
      expect(query).not.toContain(TENANT_B);
      expect(query).toContain("tenant_id =");
    }
  });

  it("filters to source_kind=observations + grounded in SQL and drops brain/thread/wiki rows defensively", async () => {
    const { db, calls } = routeDb([
      {
        match: "FROM knowledge_graph_entities",
        rows: [
          entityRow(),
          entityRow({
            id: "33333333-3333-3333-3333-333333333333",
            source_kind: "brain",
            label: "Brain Leak",
          }),
          entityRow({
            id: "44444444-4444-4444-4444-444444444444",
            source_kind: "thread",
            label: "Thread Leak",
          }),
          entityRow({
            id: "55555555-5555-5555-5555-555555555555",
            source_kind: "wiki",
            label: "Wiki Leak",
          }),
        ],
      },
      {
        match: "FROM knowledge_graph_relationships",
        rows: [
          relationshipRow(),
          relationshipRow({
            id: "66666666-6666-6666-6666-666666666666",
            source_kind: "brain",
            label: "brain-edge",
          }),
        ],
      },
      { match: "FROM knowledge_graph_evidence", rows: [] },
    ]);

    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "Acme",
    });

    expect(result.entities.map((entity) => entity.label)).toEqual([
      "Acme Corp",
    ]);
    expect(result.relationships.map((rel) => rel.label)).toEqual(["serves"]);

    // The SQL itself carries the agent-visibility filters.
    const queries = renderedQueries(calls);
    expect(queries[0]).toContain("observations");
    expect(queries[0]).toContain("grounded");
    expect(queries[1]).toContain("observations");
    expect(queries[1]).toContain("grounded");
    expect(queries[2]).toContain("observations");
    expect(queries[2]).toContain("hindsight_observation");
  });

  it("enforces the entity and relationship caps even when the db over-returns", async () => {
    const manyEntities = Array.from({ length: 30 }, (_, i) =>
      entityRow({
        id: `aaaaaaa${i.toString().padStart(1, "0")}-0000-0000-0000-00000000000${i % 10}`,
        label: `Entity ${i}`,
      }),
    );
    const manyRelationships = Array.from({ length: 60 }, (_, i) =>
      relationshipRow({
        id: `bbbbbbb${i % 10}-0000-0000-0000-00000000000${i % 10}`,
        label: `rel-${i}`,
      }),
    );
    const { db, calls } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: manyEntities },
      { match: "FROM knowledge_graph_relationships", rows: manyRelationships },
      { match: "FROM knowledge_graph_evidence", rows: [] },
    ]);

    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "Entity",
      limit: 5000,
    });

    expect(result.entities.length).toBeLessThanOrEqual(MAX_ENTITY_LIMIT);
    expect(result.relationships.length).toBeLessThanOrEqual(
      MAX_RELATIONSHIP_LIMIT,
    );
    // The requested limit is clamped before it reaches SQL.
    const queries = renderedQueries(calls);
    expect(queries[0]).not.toContain("5000");
  });

  it("never includes a snippet field anywhere in the result shape", async () => {
    const { db, calls } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: [entityRow()] },
      {
        match: "FROM knowledge_graph_relationships",
        rows: [relationshipRow()],
      },
      {
        match: "FROM knowledge_graph_evidence",
        rows: [
          {
            entity_id: "11111111-1111-1111-1111-111111111111",
            evidence_source_ref: "obs-1",
          },
        ],
      },
    ]);

    const result = await searchKnowledgeGraph({
      db,
      tenantId: TENANT_A,
      query: "Acme",
    });

    assertNoSnippetKey(result);
    // The evidence query never selects the snippet column.
    const evidenceQuery = renderedQueries(calls)[2]!;
    expect(evidenceQuery).not.toContain("snippet");
  });
});
