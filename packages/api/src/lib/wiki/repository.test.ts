import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";

import {
  archiveOntologyNonTriplePages,
  archivePagesByIds,
  buildCompileDedupeKey,
  buildGraphCompileDedupeKey,
  countSourceMemoriesForPage,
  enqueueGraphCompileJob,
  listSourceMemoryIdsForPage,
  findPageBySlug,
  findReadablePageBySlug,
  isOwnerScopedCompileJob,
  listActivePagesForReadScope,
  listGraphMaterializedTenantPages,
  normalizeSectionBody,
  normalizeSectionHeading,
  ownerScopeWhere,
  parseCompileDedupeBucket,
  renderBodyMarkdown,
  wikiReadScopeWhere,
  type WikiCompileJobRow,
} from "./repository.js";

const dialect = new PgDialect();

function renderSql(chunk: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(chunk);
  return { sql: query.sql, params: query.params };
}

/**
 * Minimal chainable drizzle-shaped fake. Records the `where` SQL handed to
 * SELECT chains and resolves to the supplied rows, so tests can assert the
 * exact predicates a repository read emits without a live database.
 */
function fakeSelectDb(rows: unknown[] = []) {
  const captured: { where: SQL | null; limit: number | null } = {
    where: null,
    limit: null,
  };
  const chain: any = {
    from: () => chain,
    where: (condition: SQL) => {
      captured.where = condition;
      return chain;
    },
    orderBy: () => chain,
    limit: (n: number) => {
      captured.limit = n;
      return chain;
    },
    then: (resolve: (value: unknown[]) => unknown, reject?: any) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const db = { select: () => chain };
  return { db, captured };
}

describe("normalizeSectionHeading", () => {
  it("keeps a non-empty planner heading", () => {
    expect(normalizeSectionHeading("  Places to revisit  ", "overview")).toBe(
      "Places to revisit",
    );
  });

  it("falls back to a readable heading from the section slug", () => {
    expect(normalizeSectionHeading(null, "favorite_places")).toBe(
      "Favorite Places",
    );
    expect(normalizeSectionHeading("", "trip-notes")).toBe("Trip Notes");
  });

  it("uses Overview when both heading and slug are empty", () => {
    expect(normalizeSectionHeading(undefined, "")).toBe("Overview");
  });
});

describe("normalizeSectionBody", () => {
  it("returns an empty body for nullish or malformed planner values", () => {
    expect(normalizeSectionBody(null)).toBe("");
    expect(normalizeSectionBody(undefined)).toBe("");
    expect(normalizeSectionBody({ body: "not markdown" })).toBe("");
  });

  it("strips wikilink bracket syntax before persistence", () => {
    expect(normalizeSectionBody("Visit [[Paris|the city]] soon.")).toBe(
      "Visit the city soon.",
    );
  });
});

describe("renderBodyMarkdown", () => {
  it("normalizes missing headings and bodies while rendering sections", () => {
    const out = renderBodyMarkdown([
      {
        section_slug: "trip-notes",
        heading: "",
        body_md: null,
        position: 1,
      },
    ]);

    expect(out).toBe("## Trip Notes");
  });
});

describe("archiveOntologyNonTriplePages", () => {
  it("returns the number of archived derived pages", async () => {
    const db = {
      execute: async () => ({ rows: [{ id: "p1" }, { id: "p2" }] }),
    };

    const archived = await archiveOntologyNonTriplePages(
      { tenantId: "tenant-1", ownerId: "owner-1" },
      db as never,
    );

    expect(archived).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tenant scope (plan 2026-06-09-004 U9/U10)
// ---------------------------------------------------------------------------

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("ownerScopeWhere", () => {
  it("emits a parameterized equality for a non-null owner (v1 behavior)", () => {
    const { sql, params } = renderSql(
      ownerScopeWhere(wikiPages.owner_id, USER),
    );
    expect(sql).toMatch(/"owner_id" = \$1/);
    expect(params).toEqual([USER]);
  });

  it("emits IS NULL for tenant scope — never `= NULL`", () => {
    const { sql, params } = renderSql(
      ownerScopeWhere(wikiPages.owner_id, null),
    );
    expect(sql).toMatch(/"owner_id" is null/i);
    expect(sql).not.toMatch(/= \$/);
    expect(params).toEqual([]);
  });
});

describe("wikiReadScopeWhere", () => {
  it("owner scope delegates to ownerScopeWhere", () => {
    const { sql } = renderSql(
      wikiReadScopeWhere(wikiPages.owner_id, { kind: "owner", ownerId: null }),
    );
    expect(sql).toMatch(/"owner_id" is null/i);
  });

  it("tenantUnion with a userId returns tenant pages OR the caller's own pages", () => {
    const { sql, params } = renderSql(
      wikiReadScopeWhere(wikiPages.owner_id, {
        kind: "tenantUnion",
        userId: USER,
      }),
    );
    expect(sql).toMatch(/"owner_id" is null or .*"owner_id" = \$1/i);
    expect(params).toEqual([USER]);
  });

  it("tenantUnion without a userId narrows to tenant pages only", () => {
    const { sql, params } = renderSql(
      wikiReadScopeWhere(wikiPages.owner_id, {
        kind: "tenantUnion",
        userId: null,
      }),
    );
    expect(sql).toMatch(/"owner_id" is null/i);
    expect(sql).not.toMatch(/ or /i);
    expect(params).toEqual([]);
  });
});

describe("findPageBySlug — tenant scope", () => {
  it("uses an IS NULL owner branch so the find-then-insert upsert can see tenant pages", async () => {
    const { db, captured } = fakeSelectDb([]);
    await findPageBySlug(
      { tenantId: TENANT, ownerId: null, type: "entity", slug: "acme" },
      db as never,
    );
    const { sql, params } = renderSql(captured.where!);
    expect(sql).toMatch(/"owner_id" is null/i);
    expect(params).toEqual([TENANT, "entity", "acme"]);
  });

  it("keeps the parameterized owner equality for user scope (unchanged)", async () => {
    const { db, captured } = fakeSelectDb([]);
    await findPageBySlug(
      { tenantId: TENANT, ownerId: USER, type: "entity", slug: "acme" },
      db as never,
    );
    const { sql, params } = renderSql(captured.where!);
    expect(sql).toMatch(/"owner_id" = \$2/);
    expect(params).toEqual([TENANT, USER, "entity", "acme"]);
  });
});

describe("listActivePagesForReadScope — union read", () => {
  it("tenantUnion returns tenant pages plus the caller's own, active only", async () => {
    const rows = [{ id: "page-1" }, { id: "page-2" }];
    const { db, captured } = fakeSelectDb(rows);
    const result = await listActivePagesForReadScope(
      {
        tenantId: TENANT,
        scope: { kind: "tenantUnion", userId: USER },
      },
      db as never,
    );
    expect(result).toEqual(rows);
    const { sql, params } = renderSql(captured.where!);
    expect(sql).toMatch(/"owner_id" is null or .*"owner_id" = \$2/i);
    // Archived pages excluded.
    expect(sql).toMatch(/"status" = \$3/);
    expect(params).toEqual([TENANT, USER, "active"]);
  });

  it("owner scope stays single-scope (no union)", async () => {
    const { db, captured } = fakeSelectDb([]);
    await listActivePagesForReadScope(
      { tenantId: TENANT, scope: { kind: "owner", ownerId: USER } },
      db as never,
    );
    const { sql } = renderSql(captured.where!);
    expect(sql).not.toMatch(/is null/i);
    expect(sql).toMatch(/"owner_id" = \$2/);
  });
});

describe("findReadablePageBySlug — union read", () => {
  it("filters to active pages in the union scope and prefers the caller's own page", async () => {
    const own = { id: "user-page", owner_id: USER };
    const { db, captured } = fakeSelectDb([own]);
    const result = await findReadablePageBySlug(
      {
        tenantId: TENANT,
        scope: { kind: "tenantUnion", userId: USER },
        type: "entity",
        slug: "acme",
      },
      db as never,
    );
    expect(result).toEqual(own);
    expect(captured.limit).toBe(1);
    const { sql, params } = renderSql(captured.where!);
    expect(sql).toMatch(/"owner_id" is null or .*"owner_id" = \$2/i);
    expect(params).toEqual([TENANT, USER, "entity", "acme", "active"]);
  });
});

describe("graph compile dedupe key", () => {
  it("is four-part with the graph:obs prefix", () => {
    const key = buildGraphCompileDedupeKey({
      tenantId: TENANT,
      nowEpochSeconds: 1_700_000_000,
    });
    expect(key.split(":")).toHaveLength(4);
    expect(key).toBe(`graph:obs:${TENANT}:${Math.floor(1_700_000_000 / 300)}`);
  });

  it("never parses as a planner continuation bucket", () => {
    const key = buildGraphCompileDedupeKey({
      tenantId: TENANT,
      nowEpochSeconds: 1_700_000_000,
    });
    expect(parseCompileDedupeBucket(key)).toBeNull();
    // Sanity: the planner's own 3-part key still parses.
    const plannerKey = buildCompileDedupeKey({
      tenantId: TENANT,
      ownerId: USER,
      nowEpochSeconds: 1_700_000_000,
    });
    expect(parseCompileDedupeBucket(plannerKey)).toBe(
      Math.floor(1_700_000_000 / 300),
    );
  });
});

describe("enqueueGraphCompileJob", () => {
  it("inserts a tenant-keyed job with owner_id null and the 4-part dedupe key", async () => {
    let insertedValues: Record<string, unknown> | null = null;
    const insertChain: any = {
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return insertChain;
      },
      onConflictDoNothing: () => insertChain,
      returning: async () => [
        { id: "job-1", tenant_id: TENANT, owner_id: null },
      ],
    };
    const db = { insert: () => insertChain };

    const { inserted, job } = await enqueueGraphCompileJob(
      {
        tenantId: TENANT,
        trigger: "graph_materialize",
        nowEpochSeconds: 1_700_000_000,
      },
      db as never,
    );
    expect(inserted).toBe(true);
    expect(job.id).toBe("job-1");
    expect(insertedValues).toMatchObject({
      tenant_id: TENANT,
      owner_id: null,
      trigger: "graph_materialize",
      dedupe_key: `graph:obs:${TENANT}:${Math.floor(1_700_000_000 / 300)}`,
    });
  });
});

describe("enqueueGraphCompileJob — forceNew discriminator", () => {
  it("appends a fifth key part that still never parses as a planner bucket", async () => {
    let insertedValues: Record<string, unknown> | null = null;
    const insertChain: any = {
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return insertChain;
      },
      onConflictDoNothing: () => insertChain,
      returning: async () => [
        { id: "job-2", tenant_id: TENANT, owner_id: null },
      ],
    };
    const db = { insert: () => insertChain };

    await enqueueGraphCompileJob(
      {
        tenantId: TENANT,
        trigger: "admin",
        nowEpochSeconds: 1_700_000_000,
        dedupeDiscriminator: "rebuild-42",
      },
      db as never,
    );
    const key = (insertedValues as unknown as { dedupe_key: string })
      .dedupe_key;
    expect(key).toBe(
      `graph:obs:${TENANT}:${Math.floor(1_700_000_000 / 300)}:rebuild-42`,
    );
    expect(parseCompileDedupeBucket(key)).toBeNull();
  });
});

describe("source-memory drill-in kinds (U14)", () => {
  const PAGE_ID = "44444444-4444-4444-8444-444444444444";

  it("countSourceMemoriesForPage counts memory_unit AND hindsight_observation refs", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const db = {
      execute: async (chunk: SQL) => {
        const rendered = renderSql(chunk);
        capturedSql = rendered.sql;
        capturedParams = rendered.params;
        return { rows: [{ n: 3 }] };
      },
    };
    const n = await countSourceMemoriesForPage(PAGE_ID, db as never);
    expect(n).toBe(3);
    expect(capturedSql).toMatch(/source_kind.*IN/i);
    expect(capturedParams).toContain("memory_unit");
    expect(capturedParams).toContain("hindsight_observation");
  });

  it("listSourceMemoryIdsForPage returns refs for both kinds, IDs only", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const db = {
      execute: async (chunk: SQL) => {
        const rendered = renderSql(chunk);
        capturedSql = rendered.sql;
        capturedParams = rendered.params;
        return {
          rows: [
            { sourceRef: "obs-1", firstSeenAt: "2026-06-09T00:00:00Z" },
            { sourceRef: "mem-1", firstSeenAt: "2026-06-08T00:00:00Z" },
          ],
        };
      },
    };
    const ids = await listSourceMemoryIdsForPage(PAGE_ID, 10, db as never);
    // IDs only — no content fields leak through this surface (R17).
    expect(ids).toEqual(["obs-1", "mem-1"]);
    expect(capturedSql).toMatch(/source_kind.*IN/i);
    expect(capturedParams).toContain("memory_unit");
    expect(capturedParams).toContain("hindsight_observation");
  });
});

describe("isOwnerScopedCompileJob", () => {
  it("narrows on owner_id nullability", () => {
    const base = { id: "j", tenant_id: TENANT } as WikiCompileJobRow;
    expect(isOwnerScopedCompileJob({ ...base, owner_id: USER })).toBe(true);
    expect(isOwnerScopedCompileJob({ ...base, owner_id: null })).toBe(false);
  });
});

describe("listGraphMaterializedTenantPages / archivePagesByIds", () => {
  it("lists active null-owner pages carrying hindsight_observation provenance", async () => {
    let capturedSql = "";
    const db = {
      execute: async (chunk: SQL) => {
        capturedSql = renderSql(chunk).sql;
        return { rows: [{ id: "p1", type: "entity", slug: "acme" }] };
      },
    };
    const rows = await listGraphMaterializedTenantPages(
      { tenantId: TENANT },
      db as never,
    );
    expect(rows).toEqual([{ id: "p1", type: "entity", slug: "acme" }]);
    expect(capturedSql).toMatch(/owner_id IS NULL/i);
    expect(capturedSql).toMatch(/'hindsight_observation'/);
    expect(capturedSql).toMatch(/'active'/);
  });

  it("archives only valid uuid ids and reports the flipped count", async () => {
    const updateChain: any = {
      set: () => updateChain,
      where: () => updateChain,
      returning: async () => [{ id: "p1" }],
    };
    const db = { update: () => updateChain };
    const flipped = await archivePagesByIds(
      {
        pageIds: ["33333333-3333-4333-8333-333333333333", "not-a-uuid"],
      },
      db as never,
    );
    expect(flipped).toBe(1);

    // No valid ids → no DB touch.
    const untouched = await archivePagesByIds({ pageIds: ["nope"] }, {
      update: () => {
        throw new Error("should not be called");
      },
    } as never);
    expect(untouched).toBe(0);
  });
});
