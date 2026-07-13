import { beforeEach, describe, expect, it, vi } from "vitest";

const recallMock = vi.hoisted(() => vi.fn());
const searchKgMock = vi.hoisted(() => vi.fn());
const findPageMock = vi.hoisted(() => vi.fn());

vi.mock("../memory/index.js", () => ({
  getMemoryServices: () => ({ recall: { recall: recallMock } }),
}));

vi.mock("../knowledge-graph/graph-search.js", () => ({
  searchKnowledgeGraph: searchKgMock,
}));

vi.mock("../wiki/repository.js", () => ({
  findReadablePageByCanonicalEntity: findPageMock,
}));

import { assembleEntityDossier } from "./entity-dossier.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WIKI_SCOPE = { kind: "tenantUnion", userId: USER } as never;

/** A drizzle `.select().from().where()` chain that resolves to `rows`. */
function selectReturning(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

/** A fake db whose `execute` yields the queued row-sets in call order. */
function makeDb(executeRowsSeq: unknown[][]) {
  const execute = vi.fn();
  for (const rows of executeRowsSeq) execute.mockResolvedValueOnce({ rows });
  const select = vi.fn();
  return { db: { execute, select }, execute, select };
}

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    label: "Acme Corp",
    typeSlug: "organization",
    summary: "A supplier.",
    aliases: ["ACME"],
    relationshipCount: 3,
    evidenceCount: 5,
    observationIds: [],
    ...overrides,
  };
}

function pageRow() {
  return {
    id: "page-1",
    tenant_id: TENANT,
    owner_id: null,
    type: "entity",
    slug: "acme_corp",
    title: "Acme Corp",
    summary: "A supplier.",
    body_md: "## Overview",
    status: "active",
    last_compiled_at: new Date("2026-07-01T00:00:00Z"),
    created_at: new Date("2026-06-01T00:00:00Z"),
    updated_at: new Date("2026-07-01T00:00:00Z"),
    canonical_entity_id: "canon-1",
    parent_page_id: null,
  };
}

function baseArgs(db: unknown, extra: Record<string, unknown> = {}) {
  return {
    db: db as never,
    tenantId: TENANT,
    query: "acme",
    entityId: null,
    callerUserId: USER,
    wikiScope: WIKI_SCOPE,
    limit: 10,
    ...extra,
  };
}

describe("assembleEntityDossier", () => {
  beforeEach(() => {
    recallMock.mockReset();
    searchKgMock.mockReset();
    findPageMock.mockReset();
    recallMock.mockResolvedValue([]);
  });

  it("assembles a full dossier for a single grounded match with a wiki page", async () => {
    searchKgMock.mockResolvedValue({ entities: [entity()] });
    // canonical identity → mirror ids → evidence thread ids
    const { db, select } = makeDb([
      [{ canonical_entity_id: "canon-1", resolution_state: "resolved" }],
      [{ id: "e1" }, { id: "e1-mirror" }],
      [{ thread_id: "t1" }],
    ]);
    findPageMock.mockResolvedValue(pageRow());
    select
      .mockReturnValueOnce(
        selectReturning([
          {
            id: "t1",
            title: "Acme SOW",
            identifier: "TH-1",
            space_id: "space-1",
            updated_at: new Date("2026-07-02T00:00:00Z"),
          },
        ]),
      )
      .mockReturnValueOnce(
        selectReturning([
          { id: "a1", title: "Acme report", type: "report", thread_id: "t1" },
        ]),
      );

    const result = await assembleEntityDossier(baseArgs(db));

    expect(result.disambiguation).toEqual([]);
    expect(result.match).not.toBeNull();
    expect(result.match?.entityId).toBe("e1");
    expect(result.match?.wikiPage?.id).toBe("page-1");
    expect(result.match?.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(result.match?.artifacts).toEqual([
      { id: "a1", title: "Acme report", type: "report", threadId: "t1" },
    ]);
    // Evidence fan-out uses the mirror ids sharing the canonical id.
    expect(findPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalEntityId: "canon-1" }),
      db,
    );
  });

  it("degrades to wikiPage: null when the entity has no canonical id, still populating memories and threads", async () => {
    searchKgMock.mockResolvedValue({ entities: [entity()] });
    const { db, select } = makeDb([
      [{ canonical_entity_id: null, resolution_state: "legacy" }],
      [{ thread_id: "t1" }],
    ]);
    select
      .mockReturnValueOnce(
        selectReturning([
          {
            id: "t1",
            title: "Acme SOW",
            identifier: "TH-1",
            space_id: null,
            updated_at: null,
          },
        ]),
      )
      .mockReturnValueOnce(selectReturning([]));
    recallMock.mockResolvedValue([
      {
        score: 0.9,
        record: {
          id: "m1",
          content: { text: "own-bank note" },
          createdAt: "2026-07-01T00:00:00Z",
        },
      },
    ]);

    const result = await assembleEntityDossier(baseArgs(db));

    expect(result.match?.wikiPage).toBeNull();
    expect(findPageMock).not.toHaveBeenCalled();
    expect(result.match?.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(result.match?.memories.map((m) => m.memoryRecordId)).toEqual(["m1"]);
  });

  it("returns a disambiguation list and assembles nothing when >1 grounded match", async () => {
    searchKgMock.mockResolvedValue({
      entities: [entity({ id: "e1" }), entity({ id: "e2", label: "Acme LLC" })],
    });
    const { db, execute, select } = makeDb([]);

    const result = await assembleEntityDossier(baseArgs(db));

    expect(result.match).toBeNull();
    expect(result.disambiguation.map((e) => e.entityId)).toEqual(["e1", "e2"]);
    expect(execute).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(findPageMock).not.toHaveBeenCalled();
  });

  it("drops threads, memories, and artifacts sourced from inaccessible threads; keeps unstamped memory hits", async () => {
    searchKgMock.mockResolvedValue({ entities: [entity()] });
    const { db, select } = makeDb([
      [{ canonical_entity_id: null, resolution_state: "legacy" }],
      [{ thread_id: "t-ok" }, { thread_id: "t-private" }],
    ]);
    // The thread-visibility predicate resolves only t-ok as accessible.
    select
      .mockReturnValueOnce(
        selectReturning([
          {
            id: "t-ok",
            title: "Visible",
            identifier: "TH-9",
            space_id: null,
            updated_at: null,
          },
        ]),
      )
      // Artifacts query keys on the accessible set, so only t-ok's artifact.
      .mockReturnValueOnce(
        selectReturning([
          { id: "a-ok", title: "ok", type: "note", thread_id: "t-ok" },
        ]),
      );
    recallMock.mockResolvedValue([
      {
        score: 0.9,
        record: { id: "m-ok", threadId: "t-ok", content: { text: "seen" } },
      },
      {
        score: 0.8,
        record: {
          id: "m-blocked",
          threadId: "t-private",
          content: { text: "hidden" },
        },
      },
      {
        score: 0.7,
        record: { id: "m-unstamped", content: { text: "own-bank" } },
      },
    ]);

    const result = await assembleEntityDossier(baseArgs(db));

    expect(result.match?.threads.map((t) => t.id)).toEqual(["t-ok"]);
    expect(result.match?.memories.map((m) => m.memoryRecordId)).toEqual([
      "m-ok",
      "m-unstamped",
    ]);
    expect(result.match?.artifacts.map((a) => a.id)).toEqual(["a-ok"]);
  });

  it("returns empty memories/threads/artifacts and never touches the bank for a service caller with no user", async () => {
    searchKgMock.mockResolvedValue({ entities: [entity()] });
    const { db, select } = makeDb([
      [{ canonical_entity_id: null, resolution_state: "legacy" }],
      [{ thread_id: "t1" }],
    ]);

    const result = await assembleEntityDossier(
      baseArgs(db, { callerUserId: null }),
    );

    expect(result.match?.entityId).toBe("e1");
    expect(result.match?.wikiPage).toBeNull();
    expect(result.match?.memories).toEqual([]);
    expect(result.match?.threads).toEqual([]);
    expect(result.match?.artifacts).toEqual([]);
    expect(recallMock).not.toHaveBeenCalled();
    // No accessible threads → no thread/artifact selects at all.
    expect(select).not.toHaveBeenCalled();
  });

  it("selects the requested candidate by entityId out of multiple grounded matches", async () => {
    searchKgMock.mockResolvedValue({
      entities: [entity({ id: "e1" }), entity({ id: "e2", label: "Acme LLC" })],
    });
    const { db } = makeDb([
      [{ canonical_entity_id: null, resolution_state: "legacy" }],
      [], // no evidence threads
    ]);

    const result = await assembleEntityDossier(
      baseArgs(db, { entityId: "e2" }),
    );

    expect(result.disambiguation).toEqual([]);
    expect(result.match?.entityId).toBe("e2");
    expect(result.match?.label).toBe("Acme LLC");
    expect(result.match?.threads).toEqual([]);
  });
});
