import { describe, expect, it, vi } from "vitest";
import { analyzeOntologyReprocessImpact } from "./impact.js";
import {
  buildOntologyReprocessDedupeKey,
  dispatchObservationsReingestForOntologyApproval,
  enqueueObservationsReingestForOntologyApproval,
} from "./reprocess.js";
import { rejectOntologyChangeSet } from "./repository.js";

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
