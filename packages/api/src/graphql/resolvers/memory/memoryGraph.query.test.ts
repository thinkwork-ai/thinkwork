/**
 * memoryGraph per-bank fairness — regression test for the Bank facet bug:
 * a global `ORDER BY mention_count DESC LIMIT 200` let mature user banks
 * (12k+ entities, mention counts in the thousands) crowd out young space/
 * tenant banks (a handful of entities, single-digit mentions), so those
 * banks never appeared in the graph or its Bank filter. The query now ranks
 * entities per bank and fills the node budget round-robin by rank.
 *
 * Runs the resolver's real SQL against an in-memory PGlite database:
 * `HINDSIGHT_DATABASE_NAME` is unset, so `resolveHindsightDb` returns the
 * (mocked) primary handle and `hindsightSql()` yields the `hindsight.`
 * schema prefix — which the test schema provides.
 */

import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireTenantAdmin } from "../core/authz.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { memoryGraph } from "./memoryGraph.query.js";

const harness = vi.hoisted(() => ({
  execute: undefined as undefined | ((query: unknown) => Promise<unknown>),
}));

vi.mock("../../utils.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    sql,
    db: { execute: (query: unknown) => harness.execute!(query) },
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

const TENANT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const SPACE_ID = "cccccccc-0000-4000-8000-000000000001";
const USER_BANK = `user_${USER_ID}`;
const SPACE_BANK = `space_${SPACE_ID}`;
const TENANT_BANK = `tenant_${TENANT_ID}`;

const entityId = (n: number) =>
  `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;

type GraphNode = {
  id: string;
  label: string;
  bankId: string | null;
  bankName: string | null;
  latestThreadId: string | null;
};
type GraphEdge = { source: string; target: string };

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dialect = new PgDialect();
  harness.execute = async (query) => {
    const { sql: text, params } = dialect.sqlToQuery(query as never);
    // node-postgres serializes JS array params to Postgres array literals;
    // PGlite does not, so mirror that here for the `= ANY($n::uuid[])` params.
    const wireParams = (params as unknown[]).map((p) =>
      Array.isArray(p)
        ? `{${p.map((v) => JSON.stringify(String(v))).join(",")}}`
        : p,
    );
    return pg.query(text, wireParams);
  };

  await pg.exec(`
    CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL, slug text);
    CREATE TABLE users (id uuid PRIMARY KEY, name text, email text);
    CREATE TABLE tenant_members (
      tenant_id uuid, principal_id uuid, principal_type text, status text
    );
    CREATE TABLE spaces (id uuid PRIMARY KEY, tenant_id uuid, name text, slug text);
    CREATE TABLE agents (id uuid PRIMARY KEY, tenant_id uuid, name text, slug text);

    CREATE SCHEMA hindsight;
    CREATE TABLE hindsight.entities (
      id uuid PRIMARY KEY,
      bank_id text NOT NULL,
      canonical_name text NOT NULL,
      mention_count integer NOT NULL,
      metadata jsonb
    );
    CREATE TABLE hindsight.entity_cooccurrences (
      entity_id_1 uuid, entity_id_2 uuid, cooccurrence_count integer
    );
    CREATE TABLE hindsight.unit_entities (entity_id uuid, unit_id uuid);
    CREATE TABLE hindsight.memory_units (
      id uuid PRIMARY KEY, metadata jsonb, created_at timestamptz
    );
  `);

  await pg.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Acme', 'acme')`,
    [TENANT_ID],
  );
  await pg.query(
    `INSERT INTO users (id, name, email) VALUES ($1, 'Eve', 'eve@acme.test')`,
    [USER_ID],
  );
  await pg.query(
    `INSERT INTO tenant_members (tenant_id, principal_id, principal_type, status)
     VALUES ($1, $2, 'user', 'active')`,
    [TENANT_ID, USER_ID],
  );
  await pg.query(
    `INSERT INTO spaces (id, tenant_id, name, slug) VALUES ($1, $2, 'Design', 'design')`,
    [SPACE_ID, TENANT_ID],
  );

  // Mature user bank: 250 entities, mention counts 100..349 — every one of
  // them out-mentions every space/tenant entity, and there are more of them
  // than the 200-node budget.
  for (let i = 0; i < 250; i++) {
    await pg.query(
      `INSERT INTO hindsight.entities (id, bank_id, canonical_name, mention_count, metadata)
       VALUES ($1, $2, $3, $4, '{}')`,
      [entityId(i), USER_BANK, `user-entity-${i}`, 100 + i],
    );
  }
  // Young space bank: 3 entities with single-digit mentions.
  for (let i = 0; i < 3; i++) {
    await pg.query(
      `INSERT INTO hindsight.entities (id, bank_id, canonical_name, mention_count, metadata)
       VALUES ($1, $2, $3, $4, '{}')`,
      [entityId(500 + i), SPACE_BANK, `space-entity-${i}`, 3 - i],
    );
  }
  // Young tenant (company-brain) bank: 2 entities.
  for (let i = 0; i < 2; i++) {
    await pg.query(
      `INSERT INTO hindsight.entities (id, bank_id, canonical_name, mention_count, metadata)
       VALUES ($1, $2, $3, $4, '{}')`,
      [entityId(600 + i), TENANT_BANK, `tenant-entity-${i}`, 2 - i],
    );
  }

  // One edge inside the selected set (top user entities), one inside the
  // space bank, and one dangling out to a user entity the per-bank cap
  // drops (rank > 200 — entityId(0) has the lowest mention count).
  await pg.query(
    `INSERT INTO hindsight.entity_cooccurrences VALUES
       ($1, $2, 9), ($3, $4, 2), ($5, $6, 5)`,
    [
      entityId(249),
      entityId(248),
      entityId(500),
      entityId(501),
      entityId(249),
      entityId(0),
    ],
  );

  // Source memory unit carrying a thread_id — exercises the latestThreadId
  // lookup (previously dead in production: drizzle rendered its array param
  // as a record, the query always threw, and the catch swallowed it).
  await pg.query(
    `INSERT INTO hindsight.memory_units (id, metadata, created_at)
     VALUES ($1, '{"thread_id": "thread-42"}', now())`,
    [entityId(700)],
  );
  await pg.query(`INSERT INTO hindsight.unit_entities VALUES ($1, $2)`, [
    entityId(249),
    entityId(700),
  ]);

  vi.mocked(requireTenantAdmin).mockResolvedValue("admin" as never);
  vi.mocked(getMemoryServices).mockReturnValue({
    inspect: { capabilities: async () => ({ inspectGraph: true }) },
  } as never);
});

afterAll(async () => {
  await pg?.close();
});

describe("memoryGraph (allTenantBanks)", () => {
  it("surfaces small space/tenant banks alongside a large user bank", async () => {
    const graph = await memoryGraph(
      null,
      { tenantId: TENANT_ID, allTenantBanks: true },
      { auth: { tenantId: TENANT_ID } } as never,
    );
    const nodes = graph.nodes as GraphNode[];

    expect(nodes).toHaveLength(200);

    const byBank = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const list = byBank.get(node.bankId!) ?? [];
      list.push(node);
      byBank.set(node.bankId!, list);
    }

    // Every non-empty bank contributes all (small banks) or its top-K (large
    // bank) — the old global top-200 returned user-bank nodes only.
    expect(byBank.get(SPACE_BANK)).toHaveLength(3);
    expect(byBank.get(TENANT_BANK)).toHaveLength(2);
    expect(byBank.get(USER_BANK)).toHaveLength(195);

    // The large bank's slots go to its highest-mention entities.
    const userNames = new Set(byBank.get(USER_BANK)!.map((n) => n.label));
    expect(userNames.has("user-entity-249")).toBe(true);
    expect(userNames.has("user-entity-0")).toBe(false);

    // Bank labels feed the UI's Bank facet.
    expect(byBank.get(SPACE_BANK)![0].bankName).toBe("Design");
    expect(byBank.get(TENANT_BANK)![0].bankName).toBe("Acme (Company Brain)");
    expect(byBank.get(USER_BANK)![0].bankName).toBe("Eve");

    // Originating-thread lookup resolves through unit_entities/memory_units.
    const linked = nodes.find((n) => n.id === entityId(249));
    expect(linked?.latestThreadId).toBe("thread-42");
  });

  it("returns only edges whose endpoints are both in the selected node set", async () => {
    const graph = await memoryGraph(
      null,
      { tenantId: TENANT_ID, allTenantBanks: true },
      { auth: { tenantId: TENANT_ID } } as never,
    );

    const nodeIds = new Set((graph.nodes as GraphNode[]).map((n) => n.id));
    const edges = graph.edges as GraphEdge[];
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    // The edge out to the dropped user-entity-0 must not survive.
    expect(
      edges.some((e) => e.source === entityId(0) || e.target === entityId(0)),
    ).toBe(false);
    // The space-bank edge does.
    expect(
      edges.some(
        (e) => e.source === entityId(500) && e.target === entityId(501),
      ),
    ).toBe(true);
  });
});
