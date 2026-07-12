/**
 * runGraph / runWiki stage tests (THINK-193 U4 run-orchestration stitch).
 *
 * The graph stage RequestResponse-invokes the targeted observations ingest
 * (injected seam) and fails visibly when the ingest fails OR when a
 * succeeded ingest lacks a usable wiki-compile enqueue outcome (the dead
 * handoff U4 closed). The wiki stage settles the enqueued compile job to a
 * terminal state — bounded, continuation-aware, and idempotent on re-runs.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../memory/index.js", () => ({
  getMemoryServices: vi.fn(() => ({
    adapter: {},
    config: { engine: "hindsight" },
  })),
}));
vi.mock("../brain/dream/runner.js", () => ({
  runBrainDreamState: vi.fn(),
}));

import {
  runGraph,
  runWiki,
  type GraphIngestInvokeResult,
  type StageContext,
} from "./stages.js";
import type { WikiCompileJobRow } from "../wiki/repository.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const RUN_ID = "9b1f74a2-40c5-4b34-9a49-27f1b7f9a111";
const PROC_ID = "11111111-1111-4111-8111-111111111111";
const SRC_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const BANK_ID = `tenant_${TENANT_ID}`;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Minimal drizzle-shaped fake: select rows pop from a queue; inserts are
 * captured (recordRunItem's onConflictDoNothing/returning chain). */
function fakeDb(
  opts: { selectRows?: unknown[][]; insertReturning?: unknown[][] } = {},
) {
  const selectQueue = [...(opts.selectRows ?? [])];
  const insertReturning = [...(opts.insertReturning ?? [])];
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.shift() ?? [];
          return {
            orderBy: () => ({ limit: async () => rows }),
            limit: async () => rows,
          };
        },
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return {
          onConflictDoNothing: () => ({
            returning: async () =>
              insertReturning.length > 0
                ? insertReturning.shift()!
                : [{ id: inserts.length }],
          }),
        };
      },
    }),
  };
  return { db: db as never, inserts };
}

function processor(overrides: Record<string, unknown> = {}) {
  return {
    id: PROC_ID,
    tenant_id: TENANT_ID,
    mode: "shared",
    target_scope: "tenant",
    target_id: TENANT_ID,
    enabled: true,
    status: "active",
    budget: {},
    ...overrides,
  } as never;
}

function ctxFor(overrides: Partial<StageContext> = {}): StageContext {
  const { db } = fakeDb();
  return {
    db,
    event: {
      workflowRunId: RUN_ID,
      tenantId: TENANT_ID,
      stepId: "graph",
      iteration: 1,
      stage: "graph",
      processorConfigId: PROC_ID,
      sourceConfigId: null,
      options: null,
    },
    processor: processor(),
    sources: [{ id: SRC_ID } as never],
    ...overrides,
  };
}

function succeededIngest(
  overrides: Partial<GraphIngestInvokeResult> = {},
): GraphIngestInvokeResult {
  return {
    ok: true,
    status: "succeeded",
    runId: "ingest-run-1",
    tenantId: TENANT_ID,
    metrics: {
      candidateCount: 5,
      promotedIds: ["obs-1", "obs-2"],
      entityCount: 3,
      identityDeferredCount: 1,
      identityDeferrals: [
        { label: "Acme", ontologyTypeSlug: "company", caseId: "case-1" },
      ],
      wikiCompileEnqueue: { status: "enqueued", jobId: JOB_ID },
    },
    ...overrides,
  };
}

function compileJob(overrides: Partial<WikiCompileJobRow> = {}) {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    owner_id: null,
    dedupe_key: `graph:obs:${TENANT_ID}:123`,
    status: "succeeded",
    trigger: "graph_materialize",
    attempt: 1,
    claimed_at: null,
    started_at: null,
    finished_at: null,
    error: null,
    metrics: null,
    input: null,
    created_at: new Date(),
    ...overrides,
  } as WikiCompileJobRow & Record<string, unknown>;
}

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Shared-only guard (AE7): personal runs stop after compounding
// ---------------------------------------------------------------------------

describe("graph/wiki shared-only guard (AE7)", () => {
  it.each([
    ["graph", runGraph],
    ["wiki", runWiki],
  ])("%s hard-rejects a user_* target bank", async (stage, run) => {
    const ctx = ctxFor({
      processor: processor({ mode: "personal", target_scope: "user" }),
      event: { ...ctxFor().event, stage },
    });
    const result = await run(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/user_\*/);
    expect(result.error).toMatch(/shared/i);
  });

  it.each([
    ["graph", runGraph],
    ["wiki", runWiki],
  ])(
    "%s rejects a shared-mode processor mis-targeting a user scope",
    async (stage, run) => {
      const ctx = ctxFor({
        processor: processor({ mode: "shared", target_scope: "user" }),
        event: { ...ctxFor().event, stage },
      });
      const result = await run(ctx);
      expect(result.status).toBe("failed");
    },
  );
});

// ---------------------------------------------------------------------------
// runGraph
// ---------------------------------------------------------------------------

describe("runGraph", () => {
  it("invokes the targeted ingest for the processor's bank and surfaces counts + enqueue outcome", async () => {
    const invoke = vi.fn().mockResolvedValue(succeededIngest());
    const { db, inserts } = fakeDb();
    const ctx = ctxFor({
      db,
      graphWiki: { invokeObservationsIngest: invoke },
    });

    const result = await runGraph(ctx);

    expect(invoke).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      bankIds: [BANK_ID],
      trigger: "manual",
    });
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({
      candidates: 5,
      gated: 2,
      merged: 3,
      deferred: 1,
    });
    expect(result.output?.deferredCaseIds).toEqual(["case-1"]);
    expect(result.output?.wikiCompileEnqueue).toEqual({
      status: "enqueued",
      jobId: JOB_ID,
    });
    // Durable graph run item: runWiki reads the jobId back from it.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workflow_run_id: RUN_ID,
      stage: "graph",
      source_item_id: BANK_ID,
      result: "changed",
    });
    expect(
      (inserts[0].detail as Record<string, unknown>).wikiCompileEnqueue,
    ).toEqual({ status: "enqueued", jobId: JOB_ID });
  });

  it("fails the stage when the ingest reports failure", async () => {
    const ctx = ctxFor({
      graphWiki: {
        invokeObservationsIngest: vi.fn().mockResolvedValue({
          ok: false,
          status: "failed",
          runId: "ingest-run-9",
          error: "extraction dropped 2/4 batches",
        }),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("extraction dropped 2/4 batches");
  });

  it("fails the stage when the ingest invoke itself throws", async () => {
    const ctx = ctxFor({
      graphWiki: {
        invokeObservationsIngest: vi
          .fn()
          .mockRejectedValue(new Error("AccessDeniedException")),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("AccessDeniedException");
  });

  it("fails the stage when a SUCCEEDED ingest lacks a usable enqueue outcome (dead handoff)", async () => {
    const metrics = succeededIngest().metrics!;
    delete (metrics as Record<string, unknown>).wikiCompileEnqueue;
    const ctx = ctxFor({
      graphWiki: {
        invokeObservationsIngest: vi
          .fn()
          .mockResolvedValue(succeededIngest({ metrics })),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/enqueue outcome/i);
  });

  it("fails on an error_not_attempted enqueue outcome", async () => {
    const ingest = succeededIngest();
    (ingest.metrics as Record<string, unknown>).wikiCompileEnqueue = {
      status: "error_not_attempted",
    };
    const ctx = ctxFor({
      graphWiki: {
        invokeObservationsIngest: vi.fn().mockResolvedValue(ingest),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("error_not_attempted");
  });

  it("treats a stale_noop ingest (zero candidates) as a visible no-op success", async () => {
    const { db, inserts } = fakeDb();
    const ctx = ctxFor({
      db,
      graphWiki: {
        invokeObservationsIngest: vi.fn().mockResolvedValue({
          ok: true,
          status: "stale_noop",
          runId: "ingest-run-2",
        }),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.counts?.noop).toBe(1);
    expect(result.output?.wikiCompileEnqueue).toBeNull();
    expect(inserts[0]).toMatchObject({ stage: "graph", result: "noop" });
  });

  it("fails resumably when another ingest run is already active (skipped)", async () => {
    const ctx = ctxFor({
      graphWiki: {
        invokeObservationsIngest: vi.fn().mockResolvedValue({
          ok: true,
          status: "skipped",
          runId: "other-run",
        }),
      },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/re-run/i);
  });

  it("returns a continuation instead of starting an ingest without lease headroom", async () => {
    const invoke = vi.fn();
    const ctx = ctxFor({
      graphWiki: { invokeObservationsIngest: invoke },
      lease: { renew: async () => true, remainingMs: () => 10_000 },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.output?.continuation).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runWiki
// ---------------------------------------------------------------------------

function wikiCtx(overrides: Partial<StageContext> = {}): StageContext {
  const base = ctxFor(overrides);
  return {
    ...base,
    event: {
      ...base.event,
      stepId: "wiki",
      stage: "wiki",
      options: { wikiCompileJobId: JOB_ID },
      ...(overrides.event ?? {}),
    },
  };
}

describe("runWiki", () => {
  it("settles a terminal-success compile job", async () => {
    const { db, inserts } = fakeDb();
    const ctx = wikiCtx({
      db,
      graphWiki: {
        getCompileJob: vi.fn().mockResolvedValue(compileJob()),
        invokeCompile: vi.fn(),
        sleep: noSleep,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ compiled: 1 });
    expect(result.output?.jobId).toBe(JOB_ID);
    expect(inserts[0]).toMatchObject({
      stage: "wiki",
      source_item_id: JOB_ID,
      result: "changed",
    });
  });

  it("polls a running job until it reaches terminal success", async () => {
    const getCompileJob = vi
      .fn()
      .mockResolvedValueOnce(compileJob({ status: "running" }))
      .mockResolvedValueOnce(compileJob({ status: "running" }))
      .mockResolvedValue(compileJob({ status: "succeeded" }));
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob,
        invokeCompile: vi.fn(),
        sleep: noSleep,
        pollIntervalMs: 1,
        settleBudgetMs: 60_000,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("succeeded");
    expect(getCompileJob).toHaveBeenCalledTimes(3);
  });

  it("fails resumably (job id in the error) when the compile job failed after graph succeeded", async () => {
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob: vi
          .fn()
          .mockResolvedValue(
            compileJob({ status: "failed", error: "materializer crashed" }),
          ),
        invokeCompile: vi.fn(),
        sleep: noSleep,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toContain(JOB_ID);
    expect(result.error).toContain("materializer crashed");
  });

  it("kicks a pending job once (deduped/invoke-failed handoffs) and fails visibly if it never starts", async () => {
    const invokeCompile = vi.fn().mockResolvedValue(undefined);
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob: vi
          .fn()
          .mockResolvedValue(compileJob({ status: "pending" })),
        invokeCompile,
        sleep: noSleep,
        pollIntervalMs: 1,
        settleBudgetMs: 0, // budget exhausts on the first check
      },
    });
    const result = await runWiki(ctx);
    expect(invokeCompile).toHaveBeenCalledTimes(1);
    expect(invokeCompile).toHaveBeenCalledWith(JOB_ID);
    expect(result.status).toBe("failed");
    expect(result.error).toContain(JOB_ID);
    expect(result.error).toMatch(/re-run/i);
  });

  it("returns a continuation when the budget/lease exhausts on a still-RUNNING job", async () => {
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob: vi
          .fn()
          .mockResolvedValue(compileJob({ status: "running" })),
        invokeCompile: vi.fn(),
        sleep: noSleep,
        pollIntervalMs: 1,
        settleBudgetMs: 0,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.output?.continuation).toBe(true);
    expect(result.output?.jobId).toBe(JOB_ID);
  });

  it("returns a continuation on lease exhaustion even with budget remaining", async () => {
    const ctx = wikiCtx({
      lease: { renew: async () => true, remainingMs: () => 0 },
      graphWiki: {
        getCompileJob: vi
          .fn()
          .mockResolvedValue(compileJob({ status: "running" })),
        invokeCompile: vi.fn(),
        sleep: noSleep,
        pollIntervalMs: 1,
        settleBudgetMs: 60_000,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.output?.continuation).toBe(true);
  });

  it("re-settling an already-settled job is idempotent", async () => {
    const deps = {
      getCompileJob: vi.fn().mockResolvedValue(compileJob()),
      invokeCompile: vi.fn(),
      sleep: noSleep,
    };
    // Second settle's run-item insert hits the unique index (returns []).
    const { db } = fakeDb({ insertReturning: [[{ id: 1 }], []] });
    const first = await runWiki(wikiCtx({ db, graphWiki: deps }));
    const second = await runWiki(wikiCtx({ db, graphWiki: deps }));
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(second.counts).toEqual({ compiled: 1 });
  });

  it("resolves the job id from the graph stage's durable run-item record", async () => {
    const { db } = fakeDb({
      selectRows: [
        [
          {
            detail: {
              ingestRunId: "ingest-run-1",
              wikiCompileEnqueue: { status: "enqueued", jobId: JOB_ID },
            },
          },
        ],
      ],
    });
    const getCompileJob = vi.fn().mockResolvedValue(compileJob());
    const ctx = wikiCtx({
      db,
      graphWiki: { getCompileJob, invokeCompile: vi.fn(), sleep: noSleep },
      event: { ...ctxFor().event, stage: "wiki", options: null },
    });
    const result = await runWiki(ctx);
    expect(getCompileJob).toHaveBeenCalledWith(JOB_ID);
    expect(result.status).toBe("succeeded");
  });

  it("records a visible no-op when the graph stage enqueued nothing (stale ingest / kill switch)", async () => {
    const { db, inserts } = fakeDb({
      selectRows: [
        [{ detail: { ingestStatus: "stale_noop", wikiCompileEnqueue: null } }],
      ],
    });
    const ctx = wikiCtx({
      db,
      graphWiki: { getCompileJob: vi.fn(), sleep: noSleep },
      event: { ...ctxFor().event, stage: "wiki", options: null },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.counts?.noop).toBe(1);
    expect(inserts[0]).toMatchObject({ stage: "wiki", result: "noop" });
  });

  it("fails when no graph-stage record exists for the run", async () => {
    const { db } = fakeDb({ selectRows: [[]] });
    const ctx = wikiCtx({
      db,
      graphWiki: { getCompileJob: vi.fn(), sleep: noSleep },
      event: { ...ctxFor().event, stage: "wiki", options: null },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/graph/i);
  });

  it("fails when the compile job row cannot be found", async () => {
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob: vi.fn().mockResolvedValue(null),
        sleep: noSleep,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toContain(JOB_ID);
  });

  it("refuses to settle another tenant's compile job", async () => {
    const ctx = wikiCtx({
      graphWiki: {
        getCompileJob: vi
          .fn()
          .mockResolvedValue(
            compileJob({ tenant_id: "99999999-9999-4999-8999-999999999999" }),
          ),
        sleep: noSleep,
      },
    });
    const result = await runWiki(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/tenant/i);
  });
});
