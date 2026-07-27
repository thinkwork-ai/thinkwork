import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const recallMock = vi.hoisted(() => vi.fn());
const searchKgMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: selectMock,
      insert: insertMock,
      execute: executeMock,
    }),
  };
});

vi.mock("../memory/index.js", () => ({
  getMemoryServices: () => ({ recall: { recall: recallMock } }),
}));

vi.mock("../knowledge-graph/graph-search.js", () => ({
  searchKnowledgeGraph: searchKgMock,
}));

import { searchBroker, type SearchSource } from "./broker.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function threadSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, orderBy, limit };
}

function insertChain() {
  const values = vi.fn().mockResolvedValue(undefined);
  insertMock.mockReturnValue({ values });
  return values;
}

function baseArgs(
  sources: SearchSource[],
  extra: Record<string, unknown> = {},
) {
  return {
    tenantId: TENANT,
    callerUserId: USER,
    query: "acme",
    sources,
    limit: 10,
    ...extra,
  };
}

describe("searchBroker", () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    executeMock.mockReset();
    recallMock.mockReset();
    searchKgMock.mockReset();
    insertChain();
  });

  it("returns tagged results from the requested legs", async () => {
    const chain = threadSelectChain([
      {
        id: "t1",
        title: "Acme SOW",
        identifier: "TH-1",
        space_id: null,
        updated_at: new Date("2026-07-01T00:00:00Z"),
      },
    ]);
    selectMock.mockReturnValue({ from: chain.from });
    searchKgMock.mockResolvedValue({
      entities: [
        {
          id: "e1",
          label: "Acme",
          typeSlug: "organization",
          summary: null,
          aliases: ["ACME Corp"],
          relationshipCount: 3,
          evidenceCount: 5,
          observationIds: [],
        },
      ],
      relationships: [],
    });

    const result = await searchBroker(baseArgs(["THREADS", "ENTITIES"]));

    expect(result.legs.map((l) => [l.source, l.status])).toEqual([
      ["THREADS", "OK"],
      ["ENTITIES", "OK"],
    ]);
    expect(result.legs[0].threadHits?.[0]).toMatchObject({
      id: "t1",
      title: "Acme SOW",
    });
    expect(result.legs[1].entityHits?.[0]).toMatchObject({
      entityId: "e1",
      label: "Acme",
      ontologyTypeSlug: "organization",
    });
    expect(recallMock).not.toHaveBeenCalled();
  });

  it("a timing-out leg yields TIMEOUT for its rail while others return OK", async () => {
    const chain = threadSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });
    searchKgMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ entities: [], relationships: [] }), 250),
        ),
    );

    const result = await searchBroker(
      baseArgs(["THREADS", "ENTITIES"], {
        timeoutMs: { ENTITIES: 20 },
      }),
    );

    const bySource = Object.fromEntries(
      result.legs.map((l) => [l.source, l.status]),
    );
    expect(bySource.ENTITIES).toBe("TIMEOUT");
    expect(bySource.THREADS).toBe("OK");
  });

  it("a throwing leg yields per-leg ERROR, not a query-level failure", async () => {
    const chain = threadSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });
    searchKgMock.mockRejectedValue(new Error("entities exploded"));

    const result = await searchBroker(baseArgs(["THREADS", "ENTITIES"]));

    const entities = result.legs.find((l) => l.source === "ENTITIES");
    expect(entities?.status).toBe("ERROR");
    expect(entities?.error).toContain("entities exploded");
    expect(result.legs.filter((l) => l.status === "OK")).toHaveLength(1);
  });

  it("excludes memory hits whose stamped thread the caller cannot access; keeps unstamped hits", async () => {
    recallMock.mockResolvedValue([
      {
        score: 0.9,
        record: {
          id: "m-accessible",
          threadId: "thread-ok",
          content: { text: "visible" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      },
      {
        score: 0.8,
        record: {
          id: "m-blocked",
          threadId: "thread-private",
          content: { text: "hidden" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      },
      {
        score: 0.7,
        record: {
          id: "m-unstamped",
          content: { text: "own-bank note" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      },
    ]);
    // Access check returns only thread-ok as visible.
    const where = vi.fn().mockResolvedValue([{ id: "thread-ok" }]);
    const from = vi.fn().mockReturnValue({ where });
    selectMock.mockReturnValue({ from });

    const result = await searchBroker(baseArgs(["MEMORY"]));

    const memory = result.legs[0];
    expect(memory.status).toBe("OK");
    expect(memory.memoryHits?.map((m) => m.memoryRecordId)).toEqual([
      "m-accessible",
      "m-unstamped",
    ]);
  });

  it("never invokes the memory adapter when MEMORY is not requested", async () => {
    const chain = threadSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });
    searchKgMock.mockResolvedValue({ entities: [], relationships: [] });

    await searchBroker(baseArgs(["THREADS", "ENTITIES"]));
    expect(recallMock).not.toHaveBeenCalled();
  });

  it("telemetry write failure does not fail the query", async () => {
    const chain = threadSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });
    const values = vi.fn().mockRejectedValue(new Error("insert failed"));
    insertMock.mockReturnValue({ values });

    const result = await searchBroker(baseArgs(["THREADS"]));
    expect(result.legs[0].status).toBe("OK");
    // Let the fire-and-forget rejection settle so vitest doesn't flag it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("records telemetry with per-leg hit counts and statuses", async () => {
    const chain = threadSelectChain([
      {
        id: "t1",
        title: "Acme",
        identifier: null,
        space_id: null,
        updated_at: null,
      },
    ]);
    selectMock.mockReturnValue({ from: chain.from });
    searchKgMock.mockResolvedValue({ entities: [], relationships: [] });
    const values = insertChain();

    await searchBroker(baseArgs(["THREADS", "ENTITIES"]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toMatchObject({
      tenant_id: TENANT,
      user_id: USER,
      query_text: "acme",
      total_hits: 1,
      escalated: false,
      leg_hit_counts: { THREADS: 1, ENTITIES: 0 },
      leg_statuses: { THREADS: "OK", ENTITIES: "OK" },
    });
  });

  it("empty query returns no legs and writes no telemetry", async () => {
    const values = insertChain();
    const result = await searchBroker(baseArgs(["THREADS"], { query: "  " }));
    expect(result.legs).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(values).not.toHaveBeenCalled();
  });
});
