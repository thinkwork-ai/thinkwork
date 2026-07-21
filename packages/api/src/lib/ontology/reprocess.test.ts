import { describe, expect, it, vi } from "vitest";
import { analyzeOntologyReprocessImpact } from "./impact.js";
import {
  applyOntologyChangeSetItems,
  buildOntologyReprocessDedupeKey,
  dispatchObservationsReingestForOntologyApproval,
  enqueueObservationsReingestForOntologyApproval,
  refreshRoutingMapProjectionForApply,
  regenerateTwinExportForApply,
} from "./reprocess.js";
import { rejectOntologyChangeSet } from "./repository.js";
import { ontologyEntityTypes } from "@thinkwork/database-pg/schema";

class FakeImpactDb {
  constructor(private rows: unknown[][]) {}

  select() {
    const rows = this.rows.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
          limit: () => Promise.resolve(rows),
        }),
      }),
    };
  }
}

class FakeJobDb {
  inserts: unknown[] = [];
  updates: Record<string, unknown>[] = [];

  constructor(private selectRows: unknown[][] = []) {}

  select() {
    const rows = this.selectRows.shift() ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
    };
    return chain;
  }

  insert() {
    return {
      values: (values: unknown) => {
        this.inserts.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
          returning: () => Promise.resolve([]),
        };
      },
    };
  }

  update() {
    return {
      set: (patch: Record<string, unknown>) => {
        this.updates.push(patch);
        return { where: () => Promise.resolve([]) };
      },
    };
  }
}

const changeSetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "change-set-1",
  tenant_id: "tenant-1",
  title: "Review vendor entity type",
  summary: "Suggested ontology update.",
  status: "pending_review",
  confidence: "0.7",
  observed_frequency: 2,
  expected_impact: {},
  proposed_by: "suggestion_engine",
  proposed_by_user_id: null,
  approved_by_user_id: null,
  approved_at: null,
  rejected_by_user_id: null,
  rejected_at: null,
  applied_version_id: null,
  created_at: new Date("2026-06-08T12:00:00.000Z"),
  updated_at: new Date("2026-06-08T12:00:00.000Z"),
  ...overrides,
});

describe("ontology reprocess", () => {
  it("builds stable dedupe keys with explicit continuation suffixes", () => {
    expect(
      buildOntologyReprocessDedupeKey({
        tenantId: "tenant-1",
        changeSetId: "change-set-1",
        ontologyVersionId: "version-1",
      }),
    ).toBe("ontology:tenant-1:change-set-1:version-1");
    expect(
      buildOntologyReprocessDedupeKey({
        tenantId: "tenant-1",
        changeSetId: "change-set-1",
        ontologyVersionId: "version-1",
        continuation: 2,
      }),
    ).toBe("ontology:tenant-1:change-set-1:version-1:continuation:2");
  });

  it("reports affected Brain pages, external refs, and visible cap continuation", async () => {
    const db = new FakeImpactDb([
      [{ id: "page-1" }, { id: "page-2" }, { id: "page-3" }],
      [{ id: "external-1" }],
    ]);

    const impact = await analyzeOntologyReprocessImpact({
      tenantId: "tenant-1",
      pageCap: 2,
      db: db as any,
      items: [
        {
          item_type: "relationship_type",
          action: "create",
          target_slug: "customer_has_risk",
          proposed_value: {
            slug: "customer_has_risk",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["risk"],
          },
        },
        {
          item_type: "facet_template",
          action: "create",
          target_slug: "risk_register",
          proposed_value: {
            entityTypeSlug: "customer",
            slug: "risk_register",
            sourcePriority: ["support_case"],
          },
        },
      ],
    });

    expect(impact).toMatchObject({
      affectedEntityTypeSlugs: ["customer", "risk"],
      affectedPageIds: ["page-1", "page-2"],
      affectedPageCount: 3,
      affectedExternalRefCount: 1,
      impactedFacetSlugs: ["risk_register"],
      impactedRelationshipSlugs: ["customer_has_risk"],
      capHit: true,
      continuation: {
        pageOffset: 2,
        remainingPageCount: 1,
      },
    });
  });

  it("enqueues a full-rebuild observations re-ingest after approval apply", async () => {
    const createRun = vi
      .fn()
      .mockResolvedValue({ run: { id: "run-1" }, inserted: true });
    const invokeWorker = vi.fn().mockResolvedValue(undefined);
    const markRunInvokeFailed = vi.fn();

    const outcome = await enqueueObservationsReingestForOntologyApproval({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      reprocessJobId: "job-1",
      db: new FakeJobDb() as any,
      deps: { createRun, invokeWorker, markRunInvokeFailed },
    });

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        trigger: "manual",
        fullRebuild: true,
        requestedByUserId: null,
        metadata: expect.objectContaining({
          reason: "ontology_approval",
          changeSetId: "change-set-1",
          reprocessJobId: "job-1",
        }),
      }),
    );
    expect(invokeWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        tenantId: "tenant-1",
        fullRebuild: true,
        trigger: "manual",
      }),
    );
    expect(markRunInvokeFailed).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ state: "invoked", runId: "run-1" });
  });

  it("skips the invoke when an observations run is already active", async () => {
    const createRun = vi
      .fn()
      .mockResolvedValue({ run: { id: "run-active" }, inserted: false });
    const invokeWorker = vi.fn();

    const outcome = await enqueueObservationsReingestForOntologyApproval({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      reprocessJobId: "job-1",
      db: new FakeJobDb() as any,
      deps: { createRun, invokeWorker, markRunInvokeFailed: vi.fn() },
    });

    expect(invokeWorker).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      state: "active_run_exists",
      runId: "run-active",
    });
  });

  it("records an enqueue failure on the reprocess job without failing the approval", async () => {
    const db = new FakeJobDb();
    const createRun = vi.fn().mockRejectedValue(new Error("aurora down"));
    const invokeWorker = vi.fn();

    const metrics = await dispatchObservationsReingestForOntologyApproval({
      job: { id: "job-1", tenant_id: "tenant-1", change_set_id: "cs-1" },
      baseMetrics: { approvedItems: 2 },
      db: db as any,
      deps: { createRun, invokeWorker, markRunInvokeFailed: vi.fn() },
    });

    expect(invokeWorker).not.toHaveBeenCalled();
    expect(metrics).toMatchObject({
      approvedItems: 2,
      observationsReingest: {
        state: "error",
        phase: "enqueue",
        error: "aurora down",
      },
    });
    // Recorded on the reprocess job's metrics only — the job's status (and
    // thus the applied approval) is untouched.
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      metrics: expect.objectContaining({
        observationsReingest: expect.objectContaining({ state: "error" }),
      }),
    });
    expect(db.updates[0]).not.toHaveProperty("status");
  });

  it("marks the run failed when the worker invoke errors and keeps the approval", async () => {
    const db = new FakeJobDb();
    const createRun = vi
      .fn()
      .mockResolvedValue({ run: { id: "run-1" }, inserted: true });
    const invokeWorker = vi.fn().mockRejectedValue(new Error("invoke boom"));
    const markRunInvokeFailed = vi.fn().mockResolvedValue(null);

    const metrics = await dispatchObservationsReingestForOntologyApproval({
      job: { id: "job-1", tenant_id: "tenant-1", change_set_id: "cs-1" },
      db: db as any,
      deps: { createRun, invokeWorker, markRunInvokeFailed },
    });

    expect(markRunInvokeFailed).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "invoke boom" }),
    );
    expect(metrics).toMatchObject({
      observationsReingest: {
        state: "error",
        phase: "invoke",
        runId: "run-1",
        error: "invoke boom",
      },
    });
    expect(db.updates[0]).not.toHaveProperty("status");
  });

  it("rejecting a change set enqueues nothing — no reprocess job, no re-ingest run", async () => {
    const db = new FakeJobDb([
      [changeSetRow()],
      // Items of the rejected set (fingerprint sweep, THINK-320 U2) — none.
      [],
      [changeSetRow({ status: "rejected" })],
      [],
      [],
    ]);

    const result = await rejectOntologyChangeSet({
      tenantId: "tenant-1",
      changeSetId: "change-set-1",
      actorUserId: null,
      db: db as any,
    });

    expect(result?.status).toBe("REJECTED");
    // No rows inserted anywhere: no ontology reprocess job and no
    // knowledge-graph observations run were enqueued by the rejection.
    expect(db.inserts).toEqual([]);
  });
});

// Table-aware capture for the change-set apply dispatch (THINK-321 U3).
class FakeApplyDb {
  inserts: Array<{ table: unknown; values: unknown }> = [];
  updates: Array<{ table: unknown; patch: Record<string, unknown> }> = [];

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        this.inserts.push({ table, values });
        const ret: any = {
          onConflictDoUpdate: () => Promise.resolve([]),
          onConflictDoNothing: () => ret,
          returning: () => Promise.resolve([]),
          then: (resolve: any, reject: any) =>
            Promise.resolve([]).then(resolve, reject),
        };
        return ret;
      },
    };
  }

  update(table: unknown) {
    return {
      set: (patch: Record<string, unknown>) => {
        this.updates.push({ table, patch });
        return { where: () => Promise.resolve([]) };
      },
    };
  }
}

describe("applyOntologyChangeSetItems (THINK-321 U3)", () => {
  it("applies an approved identity_map item onto the target entity type with a version bump", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "identity_map",
          action: "update",
          status: "approved",
          target_slug: "customer",
          proposed_value: {
            entityTypeSlug: "customer",
            systemMap: [
              { facet: "invoices", sourceSystem: "lastmile" },
              { facet: "touchpoints", sourceSystem: "twenty", note: "CRM" },
            ],
          },
        },
      ],
      db: db as any,
    });

    expect(db.inserts).toEqual([]);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe(ontologyEntityTypes);
    expect(db.updates[0].patch.system_map).toEqual([
      { facet: "invoices", sourceSystem: "lastmile" },
      { facet: "touchpoints", sourceSystem: "twenty", note: "CRM" },
    ]);
    // Version bump is a SQL expression (system_map_version + 1), not a
    // literal — assert it is present without depending on drizzle internals.
    expect(db.updates[0].patch.system_map_version).toBeDefined();
    expect(typeof db.updates[0].patch.system_map_version).not.toBe("number");
  });

  it("dispatches a mixed change set: entity_type upsert plus identity_map map write", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "identity_map",
          action: "update",
          status: "approved",
          // No entityTypeSlug in the value — target_slug is the fallback,
          // mirroring applyEntityTypeItem's target resolution.
          target_slug: "shipment",
          proposed_value: {
            systemMap: [{ facet: "orders", sourceSystem: "lastmile" }],
          },
        },
        {
          item_type: "entity_type",
          action: "create",
          status: "approved",
          target_slug: "shipment",
          proposed_value: { slug: "shipment", name: "Shipment" },
        },
      ],
      db: db as any,
    });

    // The entity type upsert lands as an insert, the identity_map as an
    // update — and the map write runs after the type item so a same-set
    // freshly minted type is a valid target.
    const entityInsert = db.inserts.find(
      (entry) => entry.table === ontologyEntityTypes,
    );
    expect(entityInsert).toBeDefined();
    expect(entityInsert!.values).toMatchObject({ slug: "shipment" });
    const mapUpdate = db.updates.find(
      (entry) => entry.table === ontologyEntityTypes,
    );
    expect(mapUpdate).toBeDefined();
    expect(mapUpdate!.patch.system_map).toEqual([
      { facet: "orders", sourceSystem: "lastmile" },
    ]);
  });

  it("skips an identity_map item with no resolvable target slug", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: null,
      items: [
        {
          item_type: "identity_map",
          action: "update",
          status: "approved",
          target_slug: null,
          proposed_value: { systemMap: [] },
        },
      ],
      db: db as any,
    });

    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
  });
});

describe("refreshRoutingMapProjectionForApply (THINK-321 U4)", () => {
  const identityMapItem = {
    item_type: "identity_map",
    action: "update",
    status: "approved",
    target_slug: "customer",
    proposed_value: {
      entityTypeSlug: "customer",
      systemMap: [{ facet: "invoices", sourceSystem: "lastmile" }],
    },
  } as any;

  it("refreshes the routing map after an apply containing identity_map items", async () => {
    const refresh = vi.fn().mockResolvedValue({
      content: "# Entity Routing Map",
      agents: 2,
      written: 2,
      skipped: [],
    });

    const metrics = await refreshRoutingMapProjectionForApply({
      tenantId: "tenant-1",
      items: [identityMapItem],
      baseMetrics: { approvedItems: 1 },
      db: {} as any,
      refresh,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(expect.anything(), "tenant-1");
    expect(metrics).toEqual({
      approvedItems: 1,
      routingMapProjection: { agents: 2, written: 2, skipped: 0 },
    });
  });

  it("no-ops for change sets without identity_map items", async () => {
    const refresh = vi.fn();

    const metrics = await refreshRoutingMapProjectionForApply({
      tenantId: "tenant-1",
      items: [
        {
          item_type: "entity_type",
          action: "create",
          status: "approved",
          target_slug: "shipment",
          proposed_value: { slug: "shipment", name: "Shipment" },
        } as any,
      ],
      baseMetrics: { approvedItems: 1 },
      db: {} as any,
      refresh,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(metrics).toEqual({ approvedItems: 1 });
  });

  it("swallows refresh failures onto metrics — the applied change set never fails", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("s3 unavailable"));

    const metrics = await refreshRoutingMapProjectionForApply({
      tenantId: "tenant-1",
      items: [identityMapItem],
      baseMetrics: { approvedItems: 1 },
      db: {} as any,
      refresh,
    });

    expect(metrics).toEqual({
      approvedItems: 1,
      routingMapProjection: { error: "s3 unavailable" },
    });
  });
});

describe("applyOntologyChangeSetItems (Company Brain U3 twin declarations)", () => {
  it("applies a facet_declaration item onto the entity type with a version bump", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "facet_declaration",
          action: "update",
          status: "approved",
          target_slug: "customer",
          proposed_value: {
            entityTypeSlug: "customer",
            facets: [
              {
                slug: "aging",
                clonePolicy: "deep_clone",
                sourceSystem: "lastmile",
                attributes: [
                  {
                    sourceField: "days_past_due",
                    attribute: "daysPastDue",
                    filterType: "number",
                  },
                ],
              },
              // Malformed entry (no sourceSystem) drops on tolerant parse.
              { slug: "broken" },
            ],
          },
        },
      ],
      db: db as any,
    });

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe(ontologyEntityTypes);
    const facets = db.updates[0].patch.twin_facets as Array<
      Record<string, unknown>
    >;
    expect(facets).toHaveLength(1);
    expect(facets[0]).toMatchObject({
      slug: "aging",
      clonePolicy: "deep_clone",
      sourceSystem: "lastmile",
    });
    expect(db.updates[0].patch.twin_facets_version).toBeDefined();
    expect(typeof db.updates[0].patch.twin_facets_version).not.toBe("number");
  });

  it("applies a page_section item, dropping facet-backed sections without a facet ref", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "page_section",
          action: "update",
          status: "approved",
          target_slug: "customer",
          proposed_value: {
            entityTypeSlug: "customer",
            sections: [
              {
                slug: "aging",
                heading: "Aging",
                kind: "facet_backed",
                facetSlug: "aging",
                visibility: "all_members",
                position: 0,
              },
              {
                slug: "activity",
                heading: "Activity",
                kind: "live_routed",
                sourceSystem: "twenty",
                visibility: "operators_only",
                position: 1,
              },
              // facet_backed with no facetSlug renders nothing — dropped.
              { slug: "ghost", heading: "Ghost", kind: "facet_backed" },
            ],
          },
        },
      ],
      db: db as any,
    });

    const sections = db.updates[0].patch.page_sections as Array<
      Record<string, unknown>
    >;
    expect(sections.map((s) => s.slug)).toEqual(["aging", "activity"]);
    expect(sections[1]).toMatchObject({ visibility: "operators_only" });
  });

  it("applies a relationship_binding item; an incomplete binding clears to {}", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "relationship_binding",
          action: "update",
          status: "approved",
          target_slug: "customer_has_ship_to",
          proposed_value: {
            relationshipTypeSlug: "customer_has_ship_to",
            binding: {
              sourceSystem: "lastmile",
              sourceDataset: "ship_tos",
              sourceKeyFields: ["customer_id"],
              targetKeyFields: ["ship_to_id"],
            },
          },
        },
        {
          item_type: "relationship_binding",
          action: "update",
          status: "approved",
          target_slug: "ship_to_has_tank",
          proposed_value: {
            relationshipTypeSlug: "ship_to_has_tank",
            // Missing key fields — parses to null, clears the binding.
            binding: { sourceSystem: "xfluid" },
          },
        },
      ],
      db: db as any,
    });

    expect(db.updates).toHaveLength(2);
    expect(db.updates[0].patch.source_binding).toMatchObject({
      sourceSystem: "lastmile",
      sourceDataset: "ship_tos",
    });
    expect(db.updates[1].patch.source_binding).toEqual({});
  });

  it("dispatches a mixed change set with a twin item targeting a same-set minted type", async () => {
    const db = new FakeApplyDb();

    await applyOntologyChangeSetItems({
      tenantId: "tenant-1",
      ontologyVersionId: "version-1",
      items: [
        {
          item_type: "facet_declaration",
          action: "update",
          status: "approved",
          target_slug: "tank",
          proposed_value: {
            facets: [
              {
                slug: "level",
                clonePolicy: "deep_clone",
                sourceSystem: "xfluid",
              },
            ],
          },
        },
        {
          item_type: "entity_type",
          action: "create",
          status: "approved",
          target_slug: "tank",
          proposed_value: { slug: "tank", name: "Tank" },
        },
      ],
      db: db as any,
    });

    // Entity insert happens before the facet declaration update — the
    // declaration can target the freshly minted type.
    expect(db.inserts).toHaveLength(1);
    expect(db.updates).toHaveLength(1);
    expect(
      (db.updates[0].patch.twin_facets as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ slug: "level" });
  });
});

describe("regenerateTwinExportForApply (Company Brain U3)", () => {
  it("no-ops for change sets without twin-relevant items", async () => {
    const regenerate = vi.fn();
    const metrics = await regenerateTwinExportForApply({
      tenantId: "tenant-1",
      items: [
        {
          item_type: "external_mapping",
          action: "update",
          status: "approved",
          target_slug: "customer",
          proposed_value: {},
        },
      ] as any,
      baseMetrics: { base: true },
      regenerate: regenerate as any,
    });
    expect(regenerate).not.toHaveBeenCalled();
    expect(metrics).toEqual({ base: true });
  });

  it("regenerates for facet_declaration items and records the outcome", async () => {
    const regenerate = vi
      .fn()
      .mockResolvedValue({ state: "uploaded", sequence: 7 });
    const metrics = await regenerateTwinExportForApply({
      tenantId: "tenant-1",
      items: [
        {
          item_type: "facet_declaration",
          action: "update",
          status: "approved",
          target_slug: "customer",
          proposed_value: {},
        },
      ] as any,
      baseMetrics: {},
      regenerate: regenerate as any,
    });
    expect(regenerate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
    expect(metrics.twinExport).toEqual({ state: "uploaded", sequence: 7 });
  });

  it("regenerates for entity_type items too (approval state gates the export)", async () => {
    const regenerate = vi.fn().mockResolvedValue({ state: "skipped_empty" });
    const metrics = await regenerateTwinExportForApply({
      tenantId: "tenant-1",
      items: [
        {
          item_type: "entity_type",
          action: "create",
          status: "approved",
          target_slug: "tank",
          proposed_value: { slug: "tank" },
        },
      ] as any,
      baseMetrics: {},
      regenerate: regenerate as any,
    });
    expect(metrics.twinExport).toEqual({ state: "skipped_empty" });
  });
});
