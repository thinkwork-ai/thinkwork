/**
 * runGraph stage tests (THINK-193 U4 run-orchestration stitch).
 *
 * The graph stage RequestResponse-invokes the targeted observations ingest
 * (injected seam) and fails visibly when the ingest fails.
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
  type GraphIngestInvokeResult,
  type StageContext,
} from "./stages.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const RUN_ID = "9b1f74a2-40c5-4b34-9a49-27f1b7f9a111";
const PROC_ID = "11111111-1111-4111-8111-111111111111";
const SRC_ID = "22222222-2222-4222-8222-222222222222";
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
    },
    ...overrides,
  };
}

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Shared-only guard (AE7): personal runs stop after compounding
// ---------------------------------------------------------------------------

describe("graph shared-only guard (AE7)", () => {
  it("graph hard-rejects a user_* target bank", async () => {
    const ctx = ctxFor({
      processor: processor({ mode: "personal", target_scope: "user" }),
      event: { ...ctxFor().event, stage: "graph" },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/user_\*/);
    expect(result.error).toMatch(/shared/i);
  });

  it("graph rejects a shared-mode processor mis-targeting a user scope", async () => {
    const ctx = ctxFor({
      processor: processor({ mode: "shared", target_scope: "user" }),
      event: { ...ctxFor().event, stage: "graph" },
    });
    const result = await runGraph(ctx);
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// runGraph
// ---------------------------------------------------------------------------

describe("runGraph", () => {
  it("invokes the targeted ingest for the processor's bank and surfaces counts", async () => {
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
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      workflow_run_id: RUN_ID,
      stage: "graph",
      source_item_id: BANK_ID,
      result: "changed",
    });
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
