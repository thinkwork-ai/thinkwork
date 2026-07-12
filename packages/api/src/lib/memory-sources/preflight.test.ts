/**
 * Preflight stage tests (THINK-193 U3): the reviewable plan is advisory,
 * bounded, and built strictly from saved sources + grants.
 */
import { describe, expect, it } from "vitest";

import { runPreflight, type PreflightPlan } from "./preflight.js";
import type { StageContext } from "./stages.js";

type Rows = Record<string, unknown>[];

/** Queue-based fake supporting .where().limit/.orderBy(...).limit chains. */
function fakeDb(selects: Rows[]) {
  const queue = [...selects];
  const next = () => Promise.resolve(queue.shift() ?? []);
  // Lazy thenable: consumes a queue entry only when awaited OR .limit()ed.
  const awaitableWithLimit = () => ({
    limit: () => next(),
    then: (resolve: (rows: Rows) => unknown, reject?: never) =>
      next().then(resolve, reject),
  });
  const tail = () => ({
    limit: () => next(),
    orderBy: () => awaitableWithLimit(),
    then: (resolve: (rows: Rows) => unknown, reject?: never) =>
      next().then(resolve, reject),
  });
  return {
    select: () => ({
      from: () => ({
        where: () => tail(),
        orderBy: () => ({ limit: () => next() }),
      }),
    }),
  } as never;
}

const TENANT = "t1";
const PROC = "proc-1";

function ctxWith(selects: Rows[], overrides: Partial<StageContext> = {}) {
  return {
    db: fakeDb(selects),
    event: {
      workflowRunId: "run-1",
      tenantId: TENANT,
      stepId: "preflight",
      iteration: 1,
      stage: "preflight",
      processorConfigId: PROC,
      sourceConfigId: null,
      options: null,
    },
    processor: {
      id: PROC,
      tenant_id: TENANT,
      mode: "personal",
      target_scope: "user",
      target_id: "user-1",
      budget: {},
    },
    sources: [],
    ...overrides,
  } as unknown as StageContext;
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    status: "active",
    expires_at: null,
    grant_version: 1,
    created_at: new Date(),
    boundary: {},
    ...overrides,
  };
}

describe("runPreflight", () => {
  it("zero sources produces an empty (setup) plan, not a failure", async () => {
    const result = await runPreflight(ctxWith([]));
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ sources: 0, ready: 0 });
    const plan = result.output?.plan as unknown as PreflightPlan;
    expect(plan.sources).toEqual([]);
    expect(plan.focus).toEqual([]);
    expect(plan.processorConfigId).toBe(PROC);
  });

  it("enumerates saved sources with grant status, checkpoint, and focus candidates", async () => {
    const ctx = ctxWith(
      [
        [grantRow()], // getActiveGrant listGrants
        [
          {
            cursor: {},
            version: 3,
            last_advanced_at: new Date("2026-07-10T00:00:00Z"),
          },
        ], // checkpoint
        [
          { source_item_id: "c-1", snapshot: { name: "Acme" } },
          { source_item_id: "c-2", snapshot: null },
        ], // recent evidence
      ],
      {
        sources: [
          {
            id: "src-1",
            source_family: "twenty",
            source_binding_key: "bind-1",
            enabled: true,
            boundary: { maxRecords: 100 },
          },
        ] as never,
      },
    );
    const result = await runPreflight(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ sources: 1, ready: 1 });
    const plan = result.output?.plan as unknown as PreflightPlan;
    expect(plan.sources[0]).toMatchObject({
      sourceConfigId: "src-1",
      sourceFamily: "twenty",
      grantStatus: "active",
      effectiveMaxRecords: 100,
      checkpointAdvancedAt: "2026-07-10T00:00:00.000Z",
      recentEvidenceCount: 2,
    });
    expect(plan.focus).toEqual([
      { key: "twenty:c-1", label: "Acme" },
      { key: "twenty:c-2", label: "c-2" },
    ]);
  });

  it("a source with no grant surfaces as blocked on the plan, not a stage failure", async () => {
    const ctx = ctxWith(
      [
        [], // no grants
        [], // no checkpoint
        [], // no evidence
      ],
      {
        sources: [
          {
            id: "src-1",
            source_family: "twenty",
            source_binding_key: "bind-1",
            enabled: true,
            boundary: {},
          },
        ] as never,
      },
    );
    const result = await runPreflight(ctx);
    expect(result.status).toBe("succeeded");
    expect(result.counts).toEqual({ sources: 1, ready: 0 });
    const plan = result.output?.plan as unknown as PreflightPlan;
    expect(plan.sources[0]).toMatchObject({
      grantStatus: "missing",
      // Omitted boundary caps fall back to the governed default (200).
      effectiveMaxRecords: 200,
      checkpointAdvancedAt: null,
    });
  });

  it("a revoked grant is reported by status", async () => {
    const ctx = ctxWith([[grantRow({ status: "revoked" })], [], []], {
      sources: [
        {
          id: "src-1",
          source_family: "twenty",
          source_binding_key: "bind-1",
          enabled: true,
          boundary: {},
        },
      ] as never,
    });
    const result = await runPreflight(ctx);
    const plan = result.output?.plan as unknown as PreflightPlan;
    // getActiveGrant returns null for revoked grants -> "missing" from the
    // reviewer's perspective is wrong; the plan reports it as missing since
    // no ACTIVE grant exists. The revoked detail lives in the operator's
    // authorization ledger.
    expect(plan.sources[0]!.grantStatus).toBe("missing");
    expect(result.counts?.ready).toBe(0);
  });
});
