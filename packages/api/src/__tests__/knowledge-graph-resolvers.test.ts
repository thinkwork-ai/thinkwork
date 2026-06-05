import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertCanReadKnowledgeGraphThreadMock,
  resolveKnowledgeGraphScopeMock,
  threadVisibilityWhereSqlMock,
} = vi.hoisted(() => ({
  assertCanReadKnowledgeGraphThreadMock: vi.fn(),
  resolveKnowledgeGraphScopeMock: vi.fn(),
  threadVisibilityWhereSqlMock: vi.fn(),
}));

vi.mock("../graphql/resolvers/knowledge-graph/auth.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    assertCanReadKnowledgeGraphThread: assertCanReadKnowledgeGraphThreadMock,
    resolveKnowledgeGraphScope: resolveKnowledgeGraphScopeMock,
    threadVisibilityWhereSql: threadVisibilityWhereSqlMock.mockResolvedValue(
      sql`TRUE`,
    ),
  };
});

import { knowledgeGraphQueries } from "../graphql/resolvers/knowledge-graph/index.js";

const now = new Date("2026-06-04T12:00:00.000Z");

function ctxWithRows(rowSets: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowSets) {
    execute.mockResolvedValueOnce({ rows });
  }
  return {
    auth: { authType: "cognito", tenantId: "tenant-1" },
    db: { execute },
  } as any;
}

function renderSql(query: unknown) {
  return (
    query as {
      toQuery(args: {
        escapeName(name: string): string;
        escapeParam(index: number): string;
        escapeString(value: string): string;
      }): { sql: string };
    }
  ).toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value}'`,
  }).sql;
}

function ingestRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    requested_by_user_id: "user-1",
    status: "succeeded",
    trigger: "manual",
    cognee_dataset_name: "thinkwork:tenant-1:thread:thread-1",
    cognee_dataset_id: "dataset-1",
    started_at: now,
    finished_at: now,
    duration_ms: 1200,
    error: null,
    entity_count: 1,
    relationship_count: 1,
    evidence_count: 2,
    diagnostic_count: 0,
    message_count: 3,
    input: { threadId: "thread-1" },
    metrics: { cogneeMs: 900 },
    metadata: { mode: "remember" },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    ingest_run_id: "run-1",
    cognee_node_id: "node-1",
    label: "Acme Corp",
    normalized_label: "acme corp",
    type_label: "Company",
    ontology_entity_type_id: "ontology-entity-1",
    ontology_type_slug: "company",
    grounding_status: "grounded",
    provenance_status: "strong",
    summary: "Important customer account.",
    aliases: ["Acme"],
    properties: { sector: "manufacturing" },
    diagnostics: {},
    relationship_count: 1,
    evidence_count: 2,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    id: "relationship-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    ingest_run_id: "run-1",
    cognee_edge_id: "edge-1",
    source_entity_id: "entity-1",
    target_entity_id: "entity-2",
    label: "serves",
    ontology_relationship_type_id: "ontology-rel-1",
    ontology_type_slug: "serves",
    grounding_status: "grounded",
    provenance_status: "weak",
    confidence: "0.7500",
    properties: {},
    diagnostics: { warning: "single mention" },
    evidence_count: 1,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    ingest_run_id: "run-1",
    entity_id: "entity-1",
    relationship_id: null,
    message_id: "message-1",
    message_role: "user",
    message_created_at: now,
    speaker_label: "Eric",
    snippet: "Acme Corp needs a migration plan.",
    char_start: 0,
    char_end: 9,
    source_kind: "thread_message",
    source_ref: "message-1",
    metadata: { confidence: "source" },
    observed_at: now,
    created_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  resolveKnowledgeGraphScopeMock.mockReset();
  resolveKnowledgeGraphScopeMock.mockResolvedValue({
    tenantId: "tenant-1",
    callerUserId: "user-1",
    requiresUserThreadVisibility: true,
  });
  assertCanReadKnowledgeGraphThreadMock.mockReset();
  assertCanReadKnowledgeGraphThreadMock.mockResolvedValue(true);
  threadVisibilityWhereSqlMock.mockClear();
});

describe("knowledge graph read resolvers", () => {
  it("lists candidate threads with latest ingest run state", async () => {
    const ctx = ctxWithRows([
      [
        {
          thread_id: "thread-1",
          tenant_id: "tenant-1",
          title: "Acme discovery",
          number: 42,
          requester_user_id: "user-1",
          requester_name: "Eric",
          space_id: "space-1",
          space_name: "Customers",
          message_count: 3,
          last_message_at: now,
          run_id: "run-1",
          run_tenant_id: "tenant-1",
          run_thread_id: "thread-1",
          requested_by_user_id: "user-1",
          status: "succeeded",
          trigger: "manual",
          cognee_dataset_name: "thinkwork:tenant-1:thread:thread-1",
          cognee_dataset_id: "dataset-1",
          started_at: now,
          finished_at: now,
          duration_ms: 1200,
          error: null,
          entity_count: 1,
          relationship_count: 1,
          evidence_count: 2,
          diagnostic_count: 0,
          run_message_count: 3,
          input: {},
          metrics: {},
          metadata: {},
          run_created_at: now,
          run_updated_at: now,
        },
      ],
    ]);

    const rows = await knowledgeGraphQueries.knowledgeGraphThreadCandidates(
      null,
      { tenantId: "tenant-1", query: "Acme" },
      ctx,
    );

    expect(resolveKnowledgeGraphScopeMock).toHaveBeenCalledWith(
      ctx,
      { tenantId: "tenant-1", query: "Acme" },
      "knowledge_graph_thread_candidates",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        title: "Acme discovery",
        messageCount: 3,
        lastIngestRun: expect.objectContaining({
          id: "run-1",
          status: "SUCCEEDED",
          messageCount: 3,
        }),
      }),
    ]);
  });

  it("lists entities with GraphQL enum and AWSJSON serialization", async () => {
    const ctx = ctxWithRows([[entity()]]);

    const rows = await knowledgeGraphQueries.knowledgeGraphEntities(
      null,
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        search: "Acme",
        groundingStatus: "GROUNDED",
      },
      ctx,
    );

    expect(assertCanReadKnowledgeGraphThreadMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ tenantId: "tenant-1" }),
      "thread-1",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: "entity-1",
        groundingStatus: "GROUNDED",
        provenanceStatus: "STRONG",
        aliases: ["Acme"],
        properties: JSON.stringify({ sector: "manufacturing" }),
        relationships: [],
        evidence: [],
      }),
    ]);
  });

  it("builds a graph from the same filtered entity set", async () => {
    const ctx = ctxWithRows([
      [entity(), entity({ id: "entity-2" })],
      [relationship()],
    ]);

    const graph = await knowledgeGraphQueries.knowledgeGraphGraph(
      null,
      { tenantId: "tenant-1", threadId: "thread-1", ontologyType: "company" },
      ctx,
    );

    expect(graph.nodes.map((node: any) => node.entityId)).toEqual([
      "entity-1",
      "entity-2",
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        relationshipId: "relationship-1",
        source: "entity-1",
        target: "entity-2",
        provenanceStatus: "WEAK",
      }),
    ]);
    const relationshipQuery = ctx.db.execute.mock.calls[1]?.[0];
    expect(renderSql(relationshipQuery)).toMatch(
      /source_entity_id IN \(\$\d+::uuid, \$\d+::uuid\)/,
    );
    expect(renderSql(relationshipQuery)).not.toContain("::uuid[]");
  });

  it("returns entity details with relationships and source evidence", async () => {
    const ctx = ctxWithRows([
      [entity()],
      [relationship()],
      [
        evidence(),
        evidence({
          id: "evidence-2",
          entity_id: null,
          relationship_id: "relationship-1",
        }),
      ],
    ]);

    const detail = await knowledgeGraphQueries.knowledgeGraphEntity(
      null,
      { tenantId: "tenant-1", entityId: "entity-1" },
      ctx,
    );

    expect(detail).toEqual(
      expect.objectContaining({
        id: "entity-1",
        evidence: [
          expect.objectContaining({
            messageId: "message-1",
            sourceKind: "THREAD_MESSAGE",
          }),
        ],
        relationships: [
          expect.objectContaining({
            id: "relationship-1",
            confidence: 0.75,
            evidence: [expect.objectContaining({ id: "evidence-2" })],
          }),
        ],
      }),
    );
    const evidenceQuery = ctx.db.execute.mock.calls[2]?.[0];
    expect(renderSql(evidenceQuery)).toMatch(
      /relationship_id IN \(\$\d+::uuid\)/,
    );
    expect(renderSql(evidenceQuery)).not.toContain("::uuid[]");
  });

  it("returns empty graph data when the selected thread is not visible", async () => {
    assertCanReadKnowledgeGraphThreadMock.mockResolvedValueOnce(false);
    const ctx = ctxWithRows([]);

    await expect(
      knowledgeGraphQueries.knowledgeGraphEntities(
        null,
        { tenantId: "tenant-1", threadId: "thread-2" },
        ctx,
      ),
    ).resolves.toEqual([]);
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });

  it("propagates the operator gate before reading rows", async () => {
    resolveKnowledgeGraphScopeMock.mockRejectedValueOnce(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );
    const ctx = ctxWithRows([]);

    await expect(
      knowledgeGraphQueries.knowledgeGraphIngestRuns(
        null,
        { tenantId: "tenant-1" },
        ctx,
      ),
    ).rejects.toThrow(/admin/i);
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });
});
