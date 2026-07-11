/**
 * memoryGraph — regression coverage for the Bank facet bug.
 *
 * The resolver used to select entities with a GLOBAL
 * `ORDER BY mention_count DESC LIMIT 200` across every bank in the tenant,
 * so mature user banks (dev: 12k+ entities, mention counts in the thousands)
 * crowded out young space/tenant banks (a handful of entities, single-digit
 * mentions) — those banks never appeared in the graph, and since the web
 * Bank facet is built from banks present in returned nodes, they vanished
 * from the filter dropdown too.
 *
 * These tests mock `db.execute` (the package's house pattern) and assert on
 * two things the fix depends on:
 *   1. the SQL the resolver emits — per-bank ranking, tenant-bank enumeration,
 *      and array params built as `ARRAY[...]` rather than the `($1, $2)`
 *      record drizzle produces from a bare JS-array interpolation (which
 *      Postgres rejects with "cannot cast type record to uuid[]"); and
 *   2. how it shapes returned rows into nodes/edges — bank labels and the
 *      originating-thread lookup.
 *
 * This is a SQL-shape + row-mapping test, not an execution test: it verifies
 * the query is built correctly, not that Postgres runs it.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireTenantAdmin } from "../core/authz.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { memoryGraph } from "./memoryGraph.query.js";

const dialect = new PgDialect();

const harness = vi.hoisted(() => ({
  executed: [] as string[],
  bankRows: [] as unknown[],
  entityRows: [] as unknown[],
  edgeRows: [] as unknown[],
  threadRows: [] as unknown[],
}));

// `resolveHindsightDb(db)` returns the primary handle while
// HINDSIGHT_DATABASE_NAME is unset, so every query — bank labels, entities,
// edges, threads — routes through this one mock. Dispatch on the rendered
// SQL to return the right fixture for each.
vi.mock("../../utils.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    sql,
    db: {
      execute: (query: unknown) => {
        const { sql: text } = dialect.sqlToQuery(query as never);
        harness.executed.push(text);
        if (text.includes("tenant_members")) return { rows: harness.bankRows };
        if (text.includes("ROW_NUMBER")) return { rows: harness.entityRows };
        if (text.includes("entity_cooccurrences"))
          return { rows: harness.edgeRows };
        if (text.includes("unit_entities")) return { rows: harness.threadRows };
        return { rows: [] };
      },
    },
  };
});

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryUserScope: vi.fn(),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(),
}));

const TENANT_ID = "tenant-1";
const USER_BANK = "user_user-1";
const SPACE_BANK = "space_space-1";
const TENANT_BANK = `tenant_${TENANT_ID}`;

const sqlFor = (needle: string): string =>
  harness.executed.find((t) => t.includes(needle)) ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  harness.executed = [];
  harness.bankRows = [
    { bank_id: USER_BANK, name: "Eve" },
    { bank_id: SPACE_BANK, name: "Design" },
    { bank_id: TENANT_BANK, name: "Acme (Company Brain)" },
  ];
  harness.entityRows = [];
  harness.edgeRows = [];
  harness.threadRows = [];

  vi.mocked(requireTenantAdmin).mockResolvedValue("admin" as never);
  vi.mocked(getMemoryServices).mockReturnValue({
    inspect: { capabilities: async () => ({ inspectGraph: true }) },
  } as never);
});

const run = () =>
  memoryGraph(null, { tenantId: TENANT_ID, allTenantBanks: true }, {
    auth: { tenantId: TENANT_ID },
  } as never);

describe("memoryGraph (allTenantBanks)", () => {
  it("ranks entities per bank instead of a global top-N", async () => {
    await run();
    const entitySql = sqlFor("ROW_NUMBER");
    // Per-bank ranking is what lets young space/tenant banks surface: rank
    // within each bank, then fill the node budget by rank. A global
    // `ORDER BY mention_count DESC LIMIT 200` (the bug) has neither clause.
    expect(entitySql).toMatch(/PARTITION BY\s+bank_id/i);
    expect(entitySql).toMatch(/ROW_NUMBER\(\)\s+OVER/i);
    expect(entitySql).toMatch(/ORDER BY\s+bank_rank/i);
  });

  it("enumerates the tenant (company-brain) bank", async () => {
    await run();
    // tenant_<id> must be in the queried bank set, or the company brain can
    // never surface regardless of the per-bank caps (THINK-261).
    expect(sqlFor("tenant_members")).toContain("'tenant_' ||");
  });

  it("builds array params as ARRAY[...] not a ($1, $2) record", async () => {
    harness.entityRows = [
      { id: "e1", canonical_name: "A", mention_count: 5, bank_id: USER_BANK },
    ];
    await run();
    const edgeSql = sqlFor("entity_cooccurrences");
    // The bug: a bare JS-array interpolation renders as `ANY(($1, $2)::uuid[])`
    // — a record cast, which Postgres rejects. The fix builds `ARRAY[...]`.
    expect(edgeSql).toMatch(/ARRAY\[.*\]::uuid\[\]/i);
    expect(edgeSql).not.toMatch(/ANY\(\(\$/);
  });

  it("labels nodes with their bank and resolves the originating thread", async () => {
    harness.entityRows = [
      {
        id: "e-user",
        canonical_name: "User entity",
        mention_count: 1200,
        bank_id: USER_BANK,
        metadata: {},
      },
      {
        id: "e-space",
        canonical_name: "Space entity",
        mention_count: 4,
        bank_id: SPACE_BANK,
        metadata: {},
      },
      {
        id: "e-tenant",
        canonical_name: "Tenant entity",
        mention_count: 2,
        bank_id: TENANT_BANK,
        metadata: {},
      },
    ];
    harness.threadRows = [{ entity_id: "e-user", thread_id: "thread-42" }];

    const graph = await run();
    const nodes = graph.nodes as Array<{
      id: string;
      bankId: string | null;
      bankName: string | null;
      latestThreadId: string | null;
    }>;

    // All three banks contribute nodes, each carrying its human label — this
    // is what feeds the web Bank facet.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("e-user")?.bankName).toBe("Eve");
    expect(byId.get("e-space")?.bankName).toBe("Design");
    expect(byId.get("e-tenant")?.bankName).toBe("Acme (Company Brain)");

    // Thread lookup resolves (it was silently dead in production: the buggy
    // record-cast param made the query throw and a catch swallowed it).
    expect(byId.get("e-user")?.latestThreadId).toBe("thread-42");
    expect(byId.get("e-space")?.latestThreadId).toBe(null);
  });

  it("skips the edge query when no entities are returned", async () => {
    harness.entityRows = [];
    const graph = await run();
    expect(graph.edges).toEqual([]);
    // No point querying cooccurrences with an empty node set.
    expect(
      harness.executed.some((t) => t.includes("entity_cooccurrences")),
    ).toBe(false);
  });
});
