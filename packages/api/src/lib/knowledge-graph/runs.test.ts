import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCogneeDatasetName,
  buildObservationsDatasetName,
  buildObservationsSourceRef,
  createKnowledgeGraphObservationsIngestRun,
  observationsRunCeilingMinutes,
  reapStaleObservationIngestRuns,
} from "./runs.js";

describe("buildCogneeDatasetName", () => {
  it("can scope Cognee datasets to a specific ingest run", () => {
    expect(
      buildCogneeDatasetName("tenant-1", "thread", "thread-1", "run-1"),
    ).toBe("thinkwork:tenant-1:thread:thread-1:run:run-1");
  });

  it("scopes non-thread datasets by source kind and source ref", () => {
    expect(buildCogneeDatasetName("tenant-1", "wiki", "owner:abc:recent")).toBe(
      "thinkwork:tenant-1:wiki:owner:abc:recent",
    );
  });

  it("preserves the thread-scoped form when no run id is provided", () => {
    expect(buildCogneeDatasetName("tenant-1", "thread", "thread-1")).toBe(
      "thinkwork:tenant-1:thread:thread-1",
    );
  });
});

describe("observations stable identities", () => {
  it("mints one stable dataset and source ref per tenant — no per-run suffix", () => {
    expect(buildObservationsDatasetName("tenant-1")).toBe(
      "thinkwork:tenant-1:observations",
    );
    expect(buildObservationsSourceRef("tenant-1")).toBe(
      "tenant:tenant-1:observations",
    );
  });
});

describe("observationsRunCeilingMinutes", () => {
  afterEach(() => {
    delete process.env.KG_OBS_RUN_CEILING_MINUTES;
  });

  it("defaults to 20 minutes", () => {
    expect(observationsRunCeilingMinutes()).toBe(20);
  });

  it("is env-tunable and rejects non-positive values", () => {
    process.env.KG_OBS_RUN_CEILING_MINUTES = "45";
    expect(observationsRunCeilingMinutes()).toBe(45);
    process.env.KG_OBS_RUN_CEILING_MINUTES = "-3";
    expect(observationsRunCeilingMinutes()).toBe(20);
  });
});

/** Chainable mock db covering the drizzle calls runs.ts makes. */
function mockRunsDb(opts: {
  reapReturning?: Array<{ id: string }>;
  insertReturning?: unknown[];
  activeRuns?: unknown[];
}) {
  const updateSet = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => opts.reapReturning ?? []),
    })),
  }));
  const insertOnConflict = vi.fn(() => ({
    returning: vi.fn(async () => opts.insertReturning ?? []),
  }));
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: insertOnConflict,
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(async () => opts.activeRuns ?? []),
        })),
      })),
    })),
  }));
  const db = {
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: insertValues })),
    select,
  } as any;
  return { db, updateSet, insertValues, insertOnConflict };
}

describe("reapStaleObservationIngestRuns", () => {
  it("fails stranded queued/running observation runs past the ceiling", async () => {
    const { db, updateSet } = mockRunsDb({
      reapReturning: [{ id: "stale-1" }],
    });

    const reaped = await reapStaleObservationIngestRuns({
      db,
      tenantId: "tenant-1",
    });

    expect(reaped).toBe(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "reaped: exceeded run ceiling",
      }),
    );
  });

  it("returns 0 when nothing is stranded", async () => {
    const { db } = mockRunsDb({ reapReturning: [] });
    expect(await reapStaleObservationIngestRuns({ db })).toBe(0);
  });
});

describe("createKnowledgeGraphObservationsIngestRun", () => {
  it("reaps before claiming and inserts a stable-identity queued run", async () => {
    const insertedRun = { id: "run-1", status: "queued" };
    const { db, updateSet, insertValues } = mockRunsDb({
      insertReturning: [insertedRun],
    });

    const result = await createKnowledgeGraphObservationsIngestRun({
      db,
      tenantId: "tenant-1",
      requestedByUserId: "user-1",
      trigger: "scheduled",
      fullRebuild: true,
    });

    expect(result).toEqual({ run: insertedRun, inserted: true });
    // The reaper UPDATE runs before the claim INSERT.
    expect((db.update as any).mock.invocationCallOrder[0]).toBeLessThan(
      (db.insert as any).mock.invocationCallOrder[0]!,
    );
    expect(updateSet).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        source_kind: "observations",
        source_ref: "tenant:tenant-1:observations",
        cognee_dataset_name: "thinkwork:tenant-1:observations",
        trigger: "scheduled",
        status: "queued",
        input: expect.objectContaining({ fullRebuild: true }),
      }),
    );
  });

  it("returns the active run un-inserted when the dedupe index drops the claim", async () => {
    const activeRun = { id: "run-existing", status: "running" };
    const { db } = mockRunsDb({
      insertReturning: [],
      activeRuns: [activeRun],
    });

    const result = await createKnowledgeGraphObservationsIngestRun({
      db,
      tenantId: "tenant-1",
      requestedByUserId: null,
    });

    expect(result).toEqual({ run: activeRun, inserted: false });
  });
});
