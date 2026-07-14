/**
 * memoryGraph regression coverage for tenant-wide bank enumeration and
 * per-bank entity selection.
 *
 * These tests verify SQL shape and resolver row mapping. They intentionally
 * render Drizzle SQL without requiring a live Postgres database.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireTenantAdmin } from "../core/authz.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
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
// HINDSIGHT_DATABASE_NAME is unset, so every query routes through this mock.
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
  harness.executed.find((text) => text.includes(needle)) ?? "";

function setInspectGraph(inspectGraph: boolean) {
  vi.mocked(getMemoryServices).mockReturnValue({
    inspect: { capabilities: async () => ({ inspectGraph }) },
  } as never);
}

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
  vi.mocked(requireMemoryUserScope).mockResolvedValue({
    tenantId: TENANT_ID,
    userId: "user-1",
  } as never);
  setInspectGraph(true);
});

const run = () =>
  memoryGraph(null, { tenantId: TENANT_ID, allTenantBanks: true }, {
    auth: { tenantId: TENANT_ID },
  } as never);

describe("memoryGraph (allTenantBanks)", () => {
  it("ranks entities per bank instead of a global top-N", async () => {
    await run();
    const entitySql = sqlFor("ROW_NUMBER");
    expect(entitySql).toMatch(/PARTITION BY\s+e\.bank_id/i);
    expect(entitySql).toMatch(/ROW_NUMBER\(\)\s+OVER/i);
    expect(entitySql).toMatch(/WHERE\s+bank_rank <= 25/i);
    expect(entitySql).toMatch(/ORDER BY\s+bank_rank/i);
    expect(entitySql).toMatch(/LIMIT 300/i);
  });

  it("enumerates the tenant company-brain bank", async () => {
    await run();
    expect(sqlFor("tenant_members")).toContain("'tenant_' ||");
  });

  it("returns the authoritative bank list when a bank has no selected entities", async () => {
    harness.entityRows = [
      {
        id: "e-user",
        canonical_name: "User entity",
        mention_count: 9,
        bank_id: USER_BANK,
        metadata: {},
      },
    ];

    const graph = await run();

    expect(graph.banks).toEqual([
      { id: TENANT_BANK, name: "Acme (Company Brain)" },
      { id: SPACE_BANK, name: "Design" },
      { id: USER_BANK, name: "Eve" },
    ]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({
      bankId: USER_BANK,
      bankName: "Eve",
    });
  });

  it("builds array params as ARRAY[...] rather than a record cast", async () => {
    harness.entityRows = [
      { id: "e1", canonical_name: "A", mention_count: 5, bank_id: USER_BANK },
    ];
    await run();
    const edgeSql = sqlFor("entity_cooccurrences");
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
      bankName: string | null;
      latestThreadId: string | null;
    }>;
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get("e-user")?.bankName).toBe("Eve");
    expect(byId.get("e-space")?.bankName).toBe("Design");
    expect(byId.get("e-tenant")?.bankName).toBe("Acme (Company Brain)");
    expect(byId.get("e-user")?.latestThreadId).toBe("thread-42");
    expect(byId.get("e-space")?.latestThreadId).toBe(null);
  });

  it("returns banks with an empty graph and skips edge and thread queries", async () => {
    const graph = await run();

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.banks).toHaveLength(3);
    expect(
      harness.executed.some((text) => text.includes("entity_cooccurrences")),
    ).toBe(false);
    expect(
      harness.executed.some((text) => text.includes("unit_entities")),
    ).toBe(false);
  });

  it("returns banks when the engine lacks graph inspection", async () => {
    setInspectGraph(false);

    const graph = await run();

    expect(graph).toEqual({
      nodes: [],
      edges: [],
      banks: [
        { id: TENANT_BANK, name: "Acme (Company Brain)" },
        { id: SPACE_BANK, name: "Design" },
        { id: USER_BANK, name: "Eve" },
      ],
    });
  });
});

describe("memoryGraph (requester scope)", () => {
  it("reports the requester's own bank when inspection is unavailable", async () => {
    setInspectGraph(false);

    const graph = await memoryGraph(undefined, {}, {
      auth: { tenantId: TENANT_ID },
    } as never);

    expect(graph.banks).toEqual([{ id: "user_user-1", name: "You" }]);
  });
});
