import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  upsertPage: vi.fn(),
  upsertPageLink: vi.fn(),
  listGraphMaterializedTenantPages: vi.fn(),
  archivePagesByIds: vi.fn(),
  claimCompileJobById: vi.fn(),
  claimNextCompileJob: vi.fn(),
  completeCompileJob: vi.fn(),
}));

vi.mock("./repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository.js")>()),
  upsertPage: mocks.upsertPage,
  upsertPageLink: mocks.upsertPageLink,
  listGraphMaterializedTenantPages: mocks.listGraphMaterializedTenantPages,
  archivePagesByIds: mocks.archivePagesByIds,
  claimCompileJobById: mocks.claimCompileJobById,
  claimNextCompileJob: mocks.claimNextCompileJob,
  completeCompileJob: mocks.completeCompileJob,
}));

import { parseCompileDedupeBucket } from "./repository.js";
import {
  materializeTenantWikiFromGraph,
  runGraphCompileJobById,
} from "./graph-materializer.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const dialect = new PgDialect();

const acmeEntity = {
  id: "ent-acme",
  label: "Acme Corp",
  normalized_label: "acme corp",
  ontology_type_slug: "company",
  summary: "Key customer in the manufacturing vertical.",
  aliases: ["acme"],
};
const janeEntity = {
  id: "ent-jane",
  label: "Jane Doe",
  normalized_label: "jane doe",
  ontology_type_slug: "person",
  summary: null,
  aliases: [],
};
const dealEntity = {
  id: "ent-deal",
  label: "Q3 Renewal",
  normalized_label: "q3 renewal",
  ontology_type_slug: "opportunity",
  summary: "Renewal opportunity.",
  aliases: [],
};

const relationships = [
  {
    id: "rel-1",
    label: "works_at",
    source_entity_id: "ent-jane",
    target_entity_id: "ent-acme",
    from_label: "Jane Doe",
    to_label: "Acme Corp",
  },
  {
    id: "rel-2",
    label: "tied_to",
    source_entity_id: "ent-acme",
    target_entity_id: "ent-deal",
    from_label: "Acme Corp",
    to_label: "Q3 Renewal",
  },
];

const evidence = [
  {
    entity_id: "ent-acme",
    relationship_id: null,
    evidence_source_ref: "obs-100",
  },
  {
    entity_id: "ent-acme",
    relationship_id: null,
    evidence_source_ref: "obs-101",
  },
  { entity_id: null, relationship_id: "rel-1", evidence_source_ref: "obs-200" },
  { entity_id: null, relationship_id: "rel-2", evidence_source_ref: "obs-201" },
];

/** db stub that replays entity → relationship → evidence reads in order,
 * capturing the rendered SQL of every execute call. */
function mirrorDb(args: {
  entities?: unknown[];
  relationships?: unknown[];
  evidence?: unknown[];
}) {
  const sqlSeen: string[] = [];
  const responses = [
    args.entities ?? [],
    args.relationships ?? [],
    args.evidence ?? [],
  ];
  let call = 0;
  return {
    sqlSeen,
    db: {
      execute: async (chunk: SQL) => {
        sqlSeen.push(dialect.sqlToQuery(chunk).sql);
        return { rows: responses[call++] ?? [] };
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  let pageSeq = 0;
  mocks.upsertPage.mockImplementation(async (input: { slug: string }) => ({
    id: `page-${input.slug}-${++pageSeq && ""}${input.slug}`,
    ...input,
  }));
  mocks.upsertPageLink.mockResolvedValue(true);
  mocks.listGraphMaterializedTenantPages.mockResolvedValue([]);
  mocks.archivePagesByIds.mockResolvedValue(0);
  mocks.completeCompileJob.mockResolvedValue(undefined);
});

describe("materializeTenantWikiFromGraph", () => {
  it("materializes a grounded entity with two relationships into a tenant page with sections, links, and observation provenance", async () => {
    const { db } = mirrorDb({
      entities: [acmeEntity, janeEntity, dealEntity],
      relationships,
      evidence,
    });

    const { metrics } = await materializeTenantWikiFromGraph(
      { tenantId: TENANT },
      db as never,
    );

    expect(metrics.entities_seen).toBe(3);
    expect(metrics.pages_upserted).toBe(3);
    expect(mocks.upsertPage).toHaveBeenCalledTimes(3);

    const acmeCall = mocks.upsertPage.mock.calls.find(
      ([input]) => input.slug === "acme-corp",
    )![0];
    // Tenant scope: owner_id NULL, entity shape, ontology subtype carried.
    expect(acmeCall).toMatchObject({
      tenant_id: TENANT,
      owner_id: null,
      type: "entity",
      entity_subtype: "company",
      slug: "acme-corp",
      title: "Acme Corp",
      summary: "Key customer in the manufacturing vertical.",
      markCompiled: true,
    });
    // Deterministic sections: overview + relationships.
    const sectionSlugs = acmeCall.sections.map(
      (s: { section_slug: string }) => s.section_slug,
    );
    expect(sectionSlugs).toEqual(["overview", "relationships"]);
    // Provenance: hindsight_observation kind, observation ids as refs.
    expect(acmeCall.sections[0].sources).toEqual([
      { kind: "hindsight_observation", ref: "obs-100" },
      { kind: "hindsight_observation", ref: "obs-101" },
    ]);
    expect(acmeCall.sections[1].sources).toEqual([
      { kind: "hindsight_observation", ref: "obs-200" },
      { kind: "hindsight_observation", ref: "obs-201" },
    ]);
    // Both edges listed in the relationships section body.
    expect(acmeCall.sections[1].body_md).toContain(
      "Jane Doe — works_at — Acme Corp",
    );
    expect(acmeCall.sections[1].body_md).toContain(
      "Acme Corp — tied_to — Q3 Renewal",
    );

    // Links between co-materialized pages — one per relationship.
    expect(mocks.upsertPageLink).toHaveBeenCalledTimes(2);
    expect(metrics.links_written).toBe(2);
  });

  it("reads only grounded observations-sourced mirror rows (ungrounded/unapproved excluded by predicate)", async () => {
    const { db, sqlSeen } = mirrorDb({ entities: [], evidence: [] });
    await materializeTenantWikiFromGraph({ tenantId: TENANT }, db as never);

    const [entitySql, relationshipSql, evidenceSql] = sqlSeen;
    expect(entitySql).toMatch(/grounding_status = 'grounded'/);
    expect(relationshipSql).toMatch(/grounding_status = 'grounded'/);
    for (const text of [entitySql, relationshipSql, evidenceSql]) {
      expect(text).toMatch(/source_kind = \$/);
    }
    expect(evidenceSql).toMatch(
      /evidence_source_kind = 'hindsight_observation'/,
    );
    expect(mocks.upsertPage).not.toHaveBeenCalled();
  });

  it("is idempotent: an unchanged mirror produces identical slug-keyed upserts and no archives", async () => {
    const run = async () => {
      const { db } = mirrorDb({
        entities: [acmeEntity, janeEntity, dealEntity],
        relationships,
        evidence,
      });
      mocks.listGraphMaterializedTenantPages.mockResolvedValue([
        { id: "p1", type: "entity", slug: "acme-corp" },
        { id: "p2", type: "entity", slug: "jane-doe" },
        { id: "p3", type: "entity", slug: "q3-renewal" },
      ]);
      return materializeTenantWikiFromGraph({ tenantId: TENANT }, db as never);
    };

    await run();
    const firstCalls = structuredClone(
      mocks.upsertPage.mock.calls.map(([input]) => input),
    );
    mocks.upsertPage.mockClear();

    const { metrics } = await run();
    const secondCalls = mocks.upsertPage.mock.calls.map(([input]) => input);
    expect(secondCalls).toEqual(firstCalls);
    expect(metrics.pages_archived).toBe(0);
    expect(mocks.archivePagesByIds).not.toHaveBeenCalled();
  });

  it("archives previously materialized pages whose backing entity vanished from the mirror", async () => {
    const { db } = mirrorDb({
      entities: [acmeEntity],
      relationships: [],
      evidence,
    });
    mocks.listGraphMaterializedTenantPages.mockResolvedValue([
      { id: "page-live", type: "entity", slug: "acme-corp" },
      { id: "page-stale", type: "entity", slug: "departed-vendor" },
    ]);
    mocks.archivePagesByIds.mockResolvedValue(1);

    const { metrics } = await materializeTenantWikiFromGraph(
      { tenantId: TENANT },
      db as never,
    );

    expect(mocks.archivePagesByIds).toHaveBeenCalledWith(
      { pageIds: ["page-stale"] },
      expect.anything(),
    );
    expect(metrics.pages_archived).toBe(1);
  });

  it("skips entities whose label slugifies to nothing", async () => {
    const { db } = mirrorDb({
      entities: [{ ...acmeEntity, id: "ent-x", label: "???" }],
      relationships: [],
      evidence: [],
    });
    const { metrics } = await materializeTenantWikiFromGraph(
      { tenantId: TENANT },
      db as never,
    );
    expect(metrics.pages_skipped).toBe(1);
    expect(mocks.upsertPage).not.toHaveBeenCalled();
  });
});

describe("graph compile job runner", () => {
  const tenantJob = {
    id: "job-1",
    tenant_id: TENANT,
    owner_id: null,
    dedupe_key: `graph:obs:${TENANT}:123`,
    status: "running",
    trigger: "graph_materialize",
  };

  it("graph-mode dedupe keys never enter planner continuation chaining", () => {
    expect(parseCompileDedupeBucket(tenantJob.dedupe_key)).toBeNull();
  });

  it("skips residual owner-scoped jobs instead of materializing under them", async () => {
    mocks.claimCompileJobById.mockResolvedValue({
      ...tenantJob,
      owner_id: "33333333-3333-4333-8333-333333333333",
    });
    const result = await runGraphCompileJobById("job-1");
    expect(result).toMatchObject({ jobId: "job-1", status: "skipped" });
    expect(mocks.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", status: "skipped" }),
      expect.anything(),
    );
    expect(mocks.upsertPage).not.toHaveBeenCalled();
  });

  it("returns null when the CAS claim loses", async () => {
    mocks.claimCompileJobById.mockResolvedValue(null);
    expect(await runGraphCompileJobById("job-1")).toBeNull();
  });

  it("marks the job failed when materialization throws", async () => {
    mocks.claimCompileJobById.mockResolvedValue(tenantJob);
    const failingDb = {
      execute: async () => {
        throw new Error("mirror unavailable");
      },
    };
    const result = await runGraphCompileJobById("job-1", failingDb as never);
    expect(result).toMatchObject({
      jobId: "job-1",
      status: "failed",
      error: "mirror unavailable",
    });
    expect(mocks.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", status: "failed" }),
      expect.anything(),
    );
  });

  it("runs a tenant-keyed job end-to-end and records metrics", async () => {
    mocks.claimCompileJobById.mockResolvedValue(tenantJob);
    const { db } = mirrorDb({
      entities: [acmeEntity],
      relationships: [],
      evidence,
    });
    const result = await runGraphCompileJobById("job-1", db as never);
    expect(result).toMatchObject({ jobId: "job-1", status: "succeeded" });
    expect(mocks.completeCompileJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "succeeded",
        metrics: expect.objectContaining({ pages_upserted: 1 }),
      }),
      expect.anything(),
    );
  });
});
