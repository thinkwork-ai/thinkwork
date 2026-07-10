import { describe, expect, it, vi } from "vitest";

import {
  COMPANY,
  emptyCounters,
  mirrorDeletions,
  upsertRecords,
} from "../load-records";
import { contentHash } from "../mappers";
import type { MappedRecord } from "../mappers";
import type { TwentyClient } from "../twenty-client";

function mapped(
  sourceId: string,
  input: Record<string, unknown>,
): MappedRecord {
  return { sourceId, input: { ...input, sourceId }, warnings: [] };
}

interface FakeExisting {
  id: string;
  sourceId: string;
  sourceHash: string | null;
  deletedAt: string | null;
}

/** Fake client answering the sourceId-lookup queries and recording mutations. */
function fakeClient(existing: FakeExisting[]): {
  client: TwentyClient;
  mutations: Array<{ query: string; variables: Record<string, unknown> }>;
} {
  const mutations: Array<{
    query: string;
    variables: Record<string, unknown>;
  }> = [];
  const client = {
    requestWithRetry: vi.fn(
      async (
        _path: string,
        query: string,
        variables: {
          filter?: { deletedAt?: unknown; sourceId?: { in?: string[] } };
        },
      ) => {
        const wantDeleted = Boolean(variables.filter?.deletedAt);
        const ids = variables.filter?.sourceId?.in ?? [];
        const nodes = existing.filter(
          (record) =>
            ids.includes(record.sourceId) &&
            (wantDeleted ? !!record.deletedAt : !record.deletedAt),
        );
        const key = /companies/.test(query) ? "companies" : "records";
        return { [key]: { edges: nodes.map((node) => ({ node })) } };
      },
    ),
    requestOnce: vi.fn(
      async (
        _path: string,
        query: string,
        variables: Record<string, unknown>,
      ) => {
        mutations.push({ query, variables });
        if (query.includes("createCompanies")) {
          const data = (variables as { data: Array<{ sourceId: string }> })
            .data;
          return {
            createCompanies: data.map((row, index) => ({
              id: `new-${row.sourceId}-${index}`,
              sourceId: row.sourceId,
            })),
          };
        }
        return { ok: true };
      },
    ),
  } as unknown as TwentyClient;
  return { client, mutations };
}

describe("upsertRecords branches (AE1)", () => {
  it("creates missing, updates changed, skips unchanged, restores deleted", async () => {
    const unchanged = mapped("account:a1", { name: "Same" });
    const changed = mapped("account:a2", { name: "New name" });
    const missing = mapped("account:a3", { name: "Brand new" });
    const revived = mapped("account:a4", { name: "Back" });

    const { client, mutations } = fakeClient([
      {
        id: "t1",
        sourceId: "account:a1",
        sourceHash: contentHash(unchanged.input),
        deletedAt: null,
      },
      {
        id: "t2",
        sourceId: "account:a2",
        sourceHash: "stale-hash",
        deletedAt: null,
      },
      {
        id: "t4",
        sourceId: "account:a4",
        sourceHash: contentHash(revived.input),
        deletedAt: "2026-07-01T00:00:00Z",
      },
    ]);

    const counters = emptyCounters();
    const ids = await upsertRecords({
      client,
      entity: COMPANY,
      mapped: [unchanged, changed, missing, revived],
      dryRun: false,
      counters,
    });

    expect(counters).toMatchObject({
      sourceTotal: 4,
      created: 1,
      updated: 1,
      restored: 1,
      skipped: 1,
      failed: 0,
    });
    expect(ids.get("account:a3")).toMatch(/^new-/);
    // Restore fired before the update for the revived record (KTD3 revival).
    const restoreIndex = mutations.findIndex((m) =>
      m.query.includes("restoreCompany"),
    );
    const updateIndexes = mutations
      .map((m, i) => (m.query.includes("updateCompany") ? i : -1))
      .filter((i) => i >= 0);
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(Math.max(...updateIndexes)).toBeGreaterThan(restoreIndex);
  });

  it("dry-run plans mutations without calling any mutation endpoint", async () => {
    const { client, mutations } = fakeClient([]);
    const counters = emptyCounters();
    await upsertRecords({
      client,
      entity: COMPANY,
      mapped: [mapped("account:a1", { name: "X" })],
      dryRun: true,
      counters,
    });
    expect(mutations).toHaveLength(0);
    expect(counters.created).toBe(1);
    expect(counters.plannedMutations).toEqual(["create company account:a1"]);
  });

  it("aborts loudly when two live records share a sourceId", async () => {
    const dupe: FakeExisting[] = [
      { id: "t1", sourceId: "account:a1", sourceHash: null, deletedAt: null },
      { id: "t2", sourceId: "account:a1", sourceHash: null, deletedAt: null },
    ];
    const { client } = fakeClient(dupe);
    const counters = emptyCounters();
    await expect(
      upsertRecords({
        client,
        entity: COMPANY,
        mapped: [mapped("account:a1", { name: "X" })],
        dryRun: false,
        counters,
      }),
    ).rejects.toThrow(/share sourceId/);
  });
});

describe("mirrorDeletions (AE2 / KTD7)", () => {
  function clientWithAll(
    records: Array<{ id: string; sourceId: string | null }>,
  ) {
    const mutations: Array<{ variables: Record<string, unknown> }> = [];
    const client = {
      requestWithRetry: vi.fn(async () => ({
        companies: {
          edges: records.map((node) => ({ node })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })),
      requestOnce: vi.fn(
        async (_p: string, _q: string, variables: Record<string, unknown>) => {
          mutations.push({ variables });
          return { deleteCompanies: [] };
        },
      ),
    } as unknown as TwentyClient;
    return { client, mutations };
  }

  it("soft-deletes only migration-owned records that vanished from the source", async () => {
    const { client, mutations } = clientWithAll([
      { id: "t1", sourceId: "account:alive" },
      { id: "t2", sourceId: "account:gone" },
      { id: "t3", sourceId: null }, // native Twenty record — never a candidate
      { id: "t4", sourceId: "other:thing" }, // not owned by this migration
    ]);
    const counters = emptyCounters();
    await mirrorDeletions({
      client,
      entity: COMPANY,
      liveSourceIds: new Set(["account:alive"]),
      ownedPrefixes: ["account:"],
      dryRun: false,
      counters,
    });
    expect(counters.deleted).toBe(1);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].variables).toEqual({ filter: { id: { in: ["t2"] } } });
  });

  it("dry-run lists the would-be deletions", async () => {
    const { client, mutations } = clientWithAll([
      { id: "t2", sourceId: "account:gone" },
    ]);
    const counters = emptyCounters();
    await mirrorDeletions({
      client,
      entity: COMPANY,
      liveSourceIds: new Set(),
      ownedPrefixes: ["account:"],
      dryRun: true,
      counters,
    });
    expect(mutations).toHaveLength(0);
    expect(counters.plannedMutations).toEqual([
      "soft-delete company account:gone",
    ]);
  });
});
