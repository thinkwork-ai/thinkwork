/**
 * `knowledgeGraphSearch` resolver + turn-bound service auth (plan
 * 2026-06-09-004 U7, R15). The service-bearer path must derive the tenant
 * SERVER-SIDE from the thread-turn reference and reject mismatched
 * assertions — the caller-asserted x-tenant-id pattern from
 * mcp-context-engine is deliberately NOT imported.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveKnowledgeGraphScopeMock } = vi.hoisted(() => ({
  resolveKnowledgeGraphScopeMock: vi.fn(),
}));

vi.mock("../graphql/resolvers/knowledge-graph/auth.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    resolveKnowledgeGraphScope: resolveKnowledgeGraphScopeMock,
    // Sibling resolvers pulled in via the knowledge-graph index import.
    assertCanReadKnowledgeGraphThread: vi.fn().mockResolvedValue(true),
    threadVisibilityWhereSql: vi.fn().mockResolvedValue(sql`TRUE`),
  };
});

import { knowledgeGraphSearch } from "../graphql/resolvers/knowledge-graph/search.query.js";
import { knowledgeGraphQueries } from "../graphql/resolvers/knowledge-graph/index.js";

const TENANT_A = "0015953e-aa13-4cab-8398-2e70f73dda63";
const TENANT_B = "84381488-f071-7073-6bc7-d6238c147538";
const TURN_ID = "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a";
const THREAD_ID = "9d2e7b6c-2d3e-4f5a-8b9c-1d2e3f4a5b6c";

function routeDb(routes: Array<{ match: string; rows: unknown[] }>) {
  const execute = vi.fn(async (query: unknown) => {
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
  return { execute };
}

function serviceCtx(args: {
  routes: Array<{ match: string; rows: unknown[] }>;
  headers?: Record<string, string>;
  assertedTenantId?: string | null;
}) {
  const { execute } = routeDb(args.routes);
  return {
    auth: {
      authType: "service",
      tenantId: args.assertedTenantId ?? null,
      principalId: null,
      agentId: null,
    },
    db: { execute },
    headers: args.headers ?? {},
  } as any;
}

const entityRows = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    source_kind: "observations",
    label: "Acme Corp",
    ontology_type_slug: "company",
    summary: "Customer.",
    aliases: ["Acme"],
    relationship_count: 1,
    evidence_count: 1,
  },
];

beforeEach(() => {
  resolveKnowledgeGraphScopeMock.mockReset();
});

describe("knowledgeGraphSearch — turn-bound service auth (R15)", () => {
  it("resolves the tenant server-side from a live thread turn and returns results", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        { match: "FROM thread_turns", rows: [{ tenant_id: TENANT_A }] },
        { match: "FROM knowledge_graph_entities", rows: entityRows },
        { match: "FROM knowledge_graph_relationships", rows: [] },
        { match: "FROM knowledge_graph_evidence", rows: [] },
      ],
    });

    const result = await knowledgeGraphSearch(null, { query: "Acme" }, ctx);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.label).toBe("Acme Corp");
    // The admin scope path is never consulted for service callers.
    expect(resolveKnowledgeGraphScopeMock).not.toHaveBeenCalled();
  });

  it("rejects a service caller asserting a different tenant via the GraphQL argument", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [{ match: "FROM thread_turns", rows: [{ tenant_id: TENANT_A }] }],
    });

    await expect(
      knowledgeGraphSearch(null, { tenantId: TENANT_B, query: "Acme" }, ctx),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("rejects a service caller whose x-tenant-id header mismatches the turn's tenant", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      assertedTenantId: TENANT_B,
      routes: [{ match: "FROM thread_turns", rows: [{ tenant_id: TENANT_A }] }],
    });

    await expect(
      knowledgeGraphSearch(null, { query: "Acme" }, ctx),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("rejects a service caller with no turn-bound reference at all", async () => {
    const ctx = serviceCtx({ routes: [] });
    await expect(
      knowledgeGraphSearch(null, { query: "Acme" }, ctx),
    ).rejects.toThrow(/turn-bound thread reference/);
  });

  it("rejects a turn reference that is not a live running turn", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      // The status='running' AND finalized_at IS NULL predicate filtered it.
      routes: [{ match: "FROM thread_turns", rows: [] }],
    });
    await expect(
      knowledgeGraphSearch(null, { query: "Acme" }, ctx),
    ).rejects.toThrow(/not an active turn/);
  });

  it("rejects a malformed (non-uuid) turn reference without touching the db", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": "not-a-uuid; DROP TABLE threads" },
      routes: [],
    });
    await expect(
      knowledgeGraphSearch(null, { query: "Acme" }, ctx),
    ).rejects.toThrow(/Invalid thread turn reference/);
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });

  it("falls back to deriving the tenant from x-thread-id when no turn id is supplied", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-id": THREAD_ID },
      routes: [
        { match: "FROM threads", rows: [{ tenant_id: TENANT_A }] },
        { match: "FROM knowledge_graph_entities", rows: [] },
      ],
    });

    const result = await knowledgeGraphSearch(null, { query: "Acme" }, ctx);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  it("includes the turn-bound status predicate in the thread_turns lookup", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        { match: "FROM thread_turns", rows: [{ tenant_id: TENANT_A }] },
        { match: "FROM knowledge_graph_entities", rows: [] },
      ],
    });
    await knowledgeGraphSearch(null, { query: "Acme" }, ctx);

    const turnQuery = JSON.stringify(
      (ctx.db.execute.mock.calls[0]![0] as { queryChunks?: unknown })
        ?.queryChunks,
    );
    expect(turnQuery).toContain("running");
    expect(turnQuery).toContain("finalized_at IS NULL");
  });
});

describe("knowledgeGraphSearch — cognito/apikey callers", () => {
  it("delegates to the existing knowledge-graph admin scope", async () => {
    resolveKnowledgeGraphScopeMock.mockResolvedValue({
      tenantId: TENANT_A,
      callerUserId: "user-1",
      requiresUserThreadVisibility: true,
    });
    const { execute } = routeDb([
      { match: "FROM knowledge_graph_entities", rows: [] },
    ]);
    const ctx = {
      auth: { authType: "cognito", tenantId: TENANT_A },
      db: { execute },
      headers: {},
    } as any;

    const result = await knowledgeGraphSearch(null, { query: "Acme" }, ctx);

    expect(result).toEqual({ entities: [], relationships: [] });
    expect(resolveKnowledgeGraphScopeMock).toHaveBeenCalledWith(
      ctx,
      { query: "Acme" },
      "knowledge_graph_search",
    );
  });
});

describe("resolver registration", () => {
  it("is exported through knowledgeGraphQueries", () => {
    expect(knowledgeGraphQueries.knowledgeGraphSearch).toBe(
      knowledgeGraphSearch,
    );
  });
});
