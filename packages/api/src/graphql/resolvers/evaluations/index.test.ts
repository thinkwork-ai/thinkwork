import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureBaselineDatasetSeeded,
  mockResolveDatasetForLaunch,
  mockDeleteRunSnapshotForTenant,
  selectQueue,
  selectWheres,
  selectFields,
  insertValues,
  insertResults,
  updateSets,
  updateResults,
  deleteWheres,
  executeCalls,
  mockFetchSpansForSession,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockNotifyEvalRunUpdate,
  mockRequireTenantAdmin,
  mockGetTenantModelCatalogEntry,
  mockResolveTenantPlatformAgent,
  mockClaimEvalBaselineForRun,
  mockLambdaSend,
  resetState,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const selectWheres: unknown[] = [];
  const selectFields: unknown[] = [];
  const insertValues: unknown[] = [];
  const insertResults: unknown[][] = [];
  const updateSets: unknown[] = [];
  const updateResults: unknown[][] = [];
  const deleteWheres: unknown[] = [];
  const executeCalls: unknown[] = [];
  return {
    selectQueue,
    selectWheres,
    selectFields,
    insertValues,
    insertResults,
    updateSets,
    updateResults,
    deleteWheres,
    executeCalls,
    mockFetchSpansForSession: vi.fn(),
    mockResolveCallerTenantId: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
    mockNotifyEvalRunUpdate: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    mockGetTenantModelCatalogEntry: vi.fn(),
    mockResolveTenantPlatformAgent: vi.fn(),
    mockClaimEvalBaselineForRun: vi.fn(),
    mockLambdaSend: vi.fn(),
    mockEnsureBaselineDatasetSeeded: vi.fn(),
    mockResolveDatasetForLaunch: vi.fn(),
    mockDeleteRunSnapshotForTenant: vi.fn(),
    resetState: () => {
      selectQueue.length = 0;
      selectWheres.length = 0;
      selectFields.length = 0;
      insertValues.length = 0;
      insertResults.length = 0;
      updateSets.length = 0;
      updateResults.length = 0;
      deleteWheres.length = 0;
      executeCalls.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of [
      "from",
      "leftJoin",
      "orderBy",
      "limit",
      "offset",
      "groupBy",
    ]) {
      chain[method] = () => chain;
    }
    chain.where = (clause: unknown) => {
      selectWheres.push(clause);
      return chain;
    };
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  const baseDb = {
    select: (fields?: unknown) => {
      selectFields.push(fields);
      return makeSelectChain();
    },
    insert: () => ({
      values: (v: unknown) => {
        insertValues.push(v);
        return {
          returning: () => Promise.resolve(insertResults.shift() ?? []),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertResults.shift() ?? []),
            then: (
              resolve: (rows: unknown[]) => unknown,
              reject: (err: unknown) => unknown,
            ) =>
              Promise.resolve(insertResults.shift() ?? []).then(
                resolve,
                reject,
              ),
          }),
        };
      },
    }),
    update: () => ({
      set: (s: unknown) => {
        updateSets.push(s);
        return {
          where: () => ({
            returning: () => Promise.resolve(updateResults.shift() ?? []),
            then: (
              resolve: (rows: unknown[]) => unknown,
              reject: (err: unknown) => unknown,
            ) =>
              Promise.resolve(updateResults.shift() ?? []).then(
                resolve,
                reject,
              ),
          }),
        };
      },
    }),
    delete: () => ({
      where: (clause: unknown) => {
        deleteWheres.push(clause);
        return Promise.resolve();
      },
    }),
    execute: (query: unknown) => {
      executeCalls.push(query);
      return Promise.resolve({ rows: [] });
    },
  };
  return {
    db: {
      ...baseDb,
      // Transactions share the same recorders/queues; the tx handle is
      // the same surface (select/update/execute) the resolvers use.
      transaction: async (fn: (tx: typeof baseDb) => Promise<unknown>) =>
        fn(baseDb),
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    asc: (arg: unknown) => ({ asc: arg }),
    desc: (arg: unknown) => ({ desc: arg }),
    inArray: (...args: unknown[]) => ({ inArray: args }),
    sql: (...args: unknown[]) => ({ sql: args }),
  };
});

vi.mock("../../../lib/agentcore-spans.js", () => ({
  fetchSpansForSession: mockFetchSpansForSession,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/eval-notify.js", () => ({
  notifyEvalRunUpdate: mockNotifyEvalRunUpdate,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../../lib/model-catalog/tenant-catalog.js", () => ({
  getTenantModelCatalogEntry: mockGetTenantModelCatalogEntry,
}));

vi.mock("../../../lib/agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: mockResolveTenantPlatformAgent,
}));

// Skill-eval runs (Skill Tests & Evals U4) claim the eval-baseline agent
// instead of the platform agent. The claim's S3/DB internals are unit-tested
// in ../../../lib/evals/eval-baseline-agent.test.ts; here it's a spy so the
// routing decision is observable without real S3.
vi.mock("../../../lib/evals/eval-baseline-agent.js", () => ({
  claimEvalBaselineForRun: mockClaimEvalBaselineForRun,
}));

// Both seed entry points route through the U5 baseline-dataset seeder;
// the heavy S3/index logic is unit-tested in
// ../../../lib/evals/baseline-dataset.test.ts against fakes.
vi.mock("../../../lib/evals/baseline-dataset.js", () => ({
  BASELINE_DATASET_VERSION: 7,
  baselineSeedCacheKey: (tenantId: string, version = 7) =>
    `${tenantId}@baseline-v${version}`,
  ensureBaselineDatasetSeeded: mockEnsureBaselineDatasetSeeded,
}));

// startEvalRun/deleteEvalRun dynamic-import the U6 run-launch module;
// the snapshot/capture logic itself is unit-tested in
// ../../../lib/evals/run-launch.test.ts against fakes.
vi.mock("../../../lib/evals/run-launch.js", () => ({
  resolveDatasetForLaunch: mockResolveDatasetForLaunch,
  deleteRunSnapshotForTenant: mockDeleteRunSnapshotForTenant,
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = mockLambdaSend;
  },
  InvokeCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  evalRuns as evalRunsTable,
  evalTestCases as evalTestCasesTable,
} from "@thinkwork/database-pg/schema";
import {
  excludesComputerSurfacePlaceholders,
  evalResultSpans,
  evaluationsMutations,
  evaluationsQueries,
  placeholderStatusForEvalRun,
  shouldIncludePlannedEvalRows,
  withLiveProgress,
} from "./index.js";

const adminCtx = { auth: { authType: "cognito", tenantId: "tenant-1" } } as any;
// Google-federated caller: ctx.auth.tenantId is null until the Cognito
// pre-token trigger lands; resolution must go through resolveCallerTenantId.
const federatedCtx = { auth: { authType: "cognito", tenantId: null } } as any;

const forbidden = new Error("Tenant admin role required");

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  process.env.EVAL_TRACE_RUNTIME_LOG_GROUP = "/aws/runtime";
  process.env.EVAL_RUNNER_FN = "thinkwork-test-api-eval-runner";
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-admin-1");
  mockNotifyEvalRunUpdate.mockResolvedValue(undefined);
  mockRequireTenantAdmin.mockResolvedValue("admin");
  mockGetTenantModelCatalogEntry.mockResolvedValue({ model_id: "model-1" });
  mockResolveTenantPlatformAgent.mockResolvedValue({ id: "agent-1" });
  mockLambdaSend.mockResolvedValue({});
  mockEnsureBaselineDatasetSeeded.mockResolvedValue({
    action: "seeded",
    addedCaseIds: [],
    rehomed: 0,
    inserted: 0,
  });
  mockResolveDatasetForLaunch.mockResolvedValue({ id: "ds-1", version: 7 });
  mockDeleteRunSnapshotForTenant.mockResolvedValue(0);
});

describe("placeholderStatusForEvalRun", () => {
  it("keeps planned eval rows visible only while the parent run is active", () => {
    expect(placeholderStatusForEvalRun("pending")).toBe("pending");
    expect(placeholderStatusForEvalRun("running")).toBe("running");
    expect(placeholderStatusForEvalRun("completed")).toBe("waiting");
    expect(shouldIncludePlannedEvalRows("pending")).toBe(true);
    expect(shouldIncludePlannedEvalRows("running")).toBe(true);
    expect(shouldIncludePlannedEvalRows("completed")).toBe(false);
    expect(shouldIncludePlannedEvalRows("failed")).toBe(false);
    expect(shouldIncludePlannedEvalRows("cancelled")).toBe(false);
  });

  it("matches direct AgentCore planning to the runner's Computer-surface exclusion", () => {
    expect(
      excludesComputerSurfacePlaceholders({
        computer_id: null,
        execution_target: "agentcore",
      }),
    ).toBe(true);
    expect(
      excludesComputerSurfacePlaceholders({
        computer_id: "computer-1",
        execution_target: "agentcore",
      }),
    ).toBe(false);
    expect(
      excludesComputerSurfacePlaceholders({
        computer_id: null,
        execution_target: "desktop-pi",
      }),
    ).toBe(false);
  });
});

describe("withLiveProgress", () => {
  it("overlays running stamped runs excluding errors from the denominator", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "running",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          passed: 0,
          failed: 0,
          errored: 0,
          pass_rate: null,
        },
        { runId: "run-1", completed: 6, passed: 3, failed: 1, errored: 2 },
      ),
    ).toMatchObject({
      passed: 3,
      failed: 1,
      errored: 2,
      pass_rate: "0.7500",
    });
  });

  it("shows no score (null) while every completed case so far errored", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "running",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          passed: 0,
          failed: 0,
          errored: 0,
          pass_rate: null,
        },
        { runId: "run-1", completed: 2, passed: 0, failed: 0, errored: 2 },
      ),
    ).toMatchObject({ passed: 0, failed: 0, errored: 2, pass_rate: null });
  });

  it("keeps legacy errors-count-as-failed math for unstamped in-flight runs", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "running",
          scoring_version: null,
          passed: 0,
          failed: 0,
          pass_rate: null,
        },
        { runId: "run-1", completed: 40, passed: 39, failed: 0, errored: 1 },
      ),
    ).toMatchObject({
      passed: 39,
      failed: 1, // the error folds into failed under legacy semantics
      pass_rate: "0.9750",
    });
  });

  it("leaves completed eval run counters untouched when summaries agree", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "completed",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          summary_scoring_version: CURRENT_EVAL_SCORING_VERSION,
          passed: 40,
          failed: 1,
          pass_rate: "0.9756",
        },
        { runId: "run-1", completed: 40, passed: 39, failed: 1, errored: 0 },
      ),
    ).toMatchObject({
      passed: 40,
      failed: 1,
      pass_rate: "0.9756",
    });
  });

  it("recomputes a stamped run finalized by an old summarizer (deploy window)", () => {
    // Stamped current, but an old warm worker finalized it under legacy
    // semantics (errors folded into failed, no summary version written).
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "completed",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          summary_scoring_version: null,
          passed: 3,
          failed: 3,
          errored: null,
          pass_rate: "0.5000",
        },
        { runId: "run-1", completed: 6, passed: 3, failed: 1, errored: 2 },
      ),
    ).toMatchObject({
      passed: 3,
      failed: 1,
      errored: 2,
      pass_rate: "0.7500",
    });
  });

  it("never recomputes legacy (unstamped) completed runs", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "completed",
          scoring_version: null,
          summary_scoring_version: null,
          passed: 3,
          failed: 3,
          pass_rate: "0.5000",
        },
        { runId: "run-1", completed: 6, passed: 3, failed: 1, errored: 2 },
      ),
    ).toMatchObject({
      passed: 3,
      failed: 3,
      pass_rate: "0.5000",
    });
  });
});

describe("evalResultSpans", () => {
  it("loads spans for the eval result session and returns them chronologically", async () => {
    selectQueue.push([{ id: "run-1" }]); // tenant-scoped run lookup
    selectQueue.push([{ agentSessionId: "session-1" }]);
    mockFetchSpansForSession.mockResolvedValue([
      {
        name: "tool_call",
        cloudWatchTimestamp: 1_700_000_000_050,
        attributes: { tool: "search" },
      },
      {
        name: "invoke_agent",
        cloudWatchTimestamp: 1_700_000_000_000,
        attributes: { model: "claude" },
      },
    ]);

    const result = await evalResultSpans(
      {},
      { runId: "run-1", testCaseId: "case-1" },
      adminCtx,
    );

    expect(mockFetchSpansForSession).toHaveBeenCalledWith("session-1", {
      runtimeLogGroup: "/aws/runtime",
    });
    expect(result).toEqual([
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        name: "invoke_agent",
        attributes: JSON.stringify({ model: "claude" }),
      },
      {
        timestamp: "2023-11-14T22:13:20.050Z",
        name: "tool_call",
        attributes: JSON.stringify({ tool: "search" }),
      },
    ]);
  });

  it("returns an empty trace when the result has no session id", async () => {
    selectQueue.push([{ id: "run-1" }]);
    selectQueue.push([{ agentSessionId: null }]);

    await expect(
      evalResultSpans({}, { runId: "run-1", testCaseId: "case-1" }, adminCtx),
    ).resolves.toEqual([]);
    expect(mockFetchSpansForSession).not.toHaveBeenCalled();
  });

  it("treats CloudWatch failures as trace-unavailable instead of page errors", async () => {
    selectQueue.push([{ id: "run-1" }]);
    selectQueue.push([{ agentSessionId: "session-1" }]);
    mockFetchSpansForSession.mockRejectedValue(new Error("logs unavailable"));

    await expect(
      evalResultSpans({}, { runId: "run-1", testCaseId: "case-1" }, adminCtx),
    ).resolves.toEqual([]);
  });

  it("refuses cross-tenant run ids without issuing a span fetch", async () => {
    selectQueue.push([]); // run lookup pinned to caller tenant finds nothing

    await expect(
      evalResultSpans(
        {},
        { runId: "foreign-run", testCaseId: "case-1" },
        adminCtx,
      ),
    ).resolves.toEqual([]);
    expect(mockFetchSpansForSession).not.toHaveBeenCalled();
    // Only the tenant-scoped run lookup ran — never the session-id read.
    expect(selectWheres).toHaveLength(1);
    const clause = selectWheres[0] as any;
    expect(clause.and[1].eq[0]).toBe(evalRunsTable.tenant_id);
    expect(clause.and[1].eq[1]).toBe("tenant-1");
  });

  it("fails closed when no caller tenant resolves", async () => {
    mockResolveCallerTenantId.mockResolvedValue(null);

    await expect(
      evalResultSpans({}, { runId: "run-1", testCaseId: "case-1" }, {
        auth: {},
      } as any),
    ).resolves.toEqual([]);
    expect(selectWheres).toHaveLength(0);
    expect(mockFetchSpansForSession).not.toHaveBeenCalled();
  });
});

describe("eval query tenant scoping", () => {
  it("evalRuns with a foreign tenantId returns an empty page without querying", async () => {
    const result = await evaluationsQueries.evalRuns(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual({ items: [], totalCount: 0 });
    expect(selectWheres).toHaveLength(0);
  });

  it("evalSummary with a foreign tenantId returns zeros without querying", async () => {
    const result = await evaluationsQueries.evalSummary(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual({
      totalRuns: 0,
      latestPassRate: null,
      avgPassRate: null,
      regressionCount: 0,
    });
    expect(selectWheres).toHaveLength(0);
  });

  it("evalTimeSeries with a foreign tenantId returns empty without querying", async () => {
    const result = await evaluationsQueries.evalTimeSeries(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(executeCalls).toHaveLength(0);
  });

  it("evalRun pins the caller tenant into the row filter and returns null cross-tenant", async () => {
    selectQueue.push([]); // tenant pin excludes the foreign row
    const result = await evaluationsQueries.evalRun(
      {},
      { id: "foreign-run" },
      adminCtx,
    );
    expect(result).toBeNull();
    const clause = selectWheres[0] as any;
    expect(clause.and[0].eq[0]).toBe(evalRunsTable.id);
    expect(clause.and[0].eq[1]).toBe("foreign-run");
    expect(clause.and[1].eq[0]).toBe(evalRunsTable.tenant_id);
    expect(clause.and[1].eq[1]).toBe("tenant-1");
  });

  it("evalRunResults returns empty for a cross-tenant run id", async () => {
    selectQueue.push([]); // tenant-pinned run lookup misses
    const result = await evaluationsQueries.evalRunResults(
      {},
      { runId: "foreign-run" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(selectWheres).toHaveLength(1);
    const clause = selectWheres[0] as any;
    expect(clause.and[1].eq[0]).toBe(evalRunsTable.tenant_id);
    expect(clause.and[1].eq[1]).toBe("tenant-1");
  });

  it("evalTestCaseHistory returns empty for a cross-tenant test case", async () => {
    selectQueue.push([]); // tenant-pinned test-case lookup misses
    const result = await evaluationsQueries.evalTestCaseHistory(
      {},
      { testCaseId: "foreign-case" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(selectWheres).toHaveLength(1);
    const clause = selectWheres[0] as any;
    expect(clause.and[1].eq[0]).toBe(evalTestCasesTable.tenant_id);
    expect(clause.and[1].eq[1]).toBe("tenant-1");
  });

  it("evalTestCase pins the caller tenant and returns null cross-tenant", async () => {
    selectQueue.push([]);
    const result = await evaluationsQueries.evalTestCase(
      {},
      { id: "foreign-case" },
      adminCtx,
    );
    expect(result).toBeNull();
    const clause = selectWheres[0] as any;
    expect(clause.and[1].eq[0]).toBe(evalTestCasesTable.tenant_id);
    expect(clause.and[1].eq[1]).toBe("tenant-1");
  });

  it("evalTestCases with a foreign tenantId does not seed rows into that tenant", async () => {
    const result = await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(mockEnsureBaselineDatasetSeeded).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
    expect(selectWheres).toHaveLength(0);
  });

  it("evalTestCases seeds the caller's own tenant on first visit via the dataset seeder", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-seed-1" },
    } as any;
    selectQueue.push([]); // final test-case listing
    const result = await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-1" },
      ctx,
    );
    expect(result).toEqual([]);
    expect(mockEnsureBaselineDatasetSeeded).toHaveBeenCalledWith(
      "tenant-seed-1",
    );
  });

  it("evalTestCases caches successful seeds per warm container (versioned key)", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-seed-cache" },
    } as any;
    selectQueue.push([]); // listing, first call
    selectQueue.push([]); // listing, second call
    await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-cache" },
      ctx,
    );
    await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-cache" },
      ctx,
    );
    expect(mockEnsureBaselineDatasetSeeded).toHaveBeenCalledTimes(1);
  });

  it("evalTestCases retries seeding on the next query when the seeder fails", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-seed-retry" },
    } as any;
    mockEnsureBaselineDatasetSeeded.mockRejectedValueOnce(
      new Error("S3 unavailable"),
    );
    selectQueue.push([]); // listing still served on seed failure
    selectQueue.push([]); // listing, second call
    const first = await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-retry" },
      ctx,
    );
    expect(first).toEqual([]); // seed failure never takes down the listing
    await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-retry" },
      ctx,
    );
    // Failure was not cached — the second query re-attempted the seed.
    expect(mockEnsureBaselineDatasetSeeded).toHaveBeenCalledTimes(2);
  });

  it("evalTestCases pins the datasetId filter into the row conditions", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-ds-filter" },
    } as any;
    selectQueue.push([]); // filtered test-case listing
    await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-ds-filter", datasetId: "ds-1" },
      ctx,
    );
    const clause = selectWheres[selectWheres.length - 1] as any;
    const conditions = clause.and as Array<{ eq?: unknown[] }>;
    expect(
      conditions.some(
        (c) =>
          c.eq?.[0] === evalTestCasesTable.dataset_id && c.eq?.[1] === "ds-1",
      ),
    ).toBe(true);
  });

  it("resolves Google-federated callers via the fallback and scopes them", async () => {
    selectQueue.push([
      {
        totalRuns: 2,
        latestPassRate: 0.9,
        avgPassRate: 0.8,
        regressionCount: 0,
      },
    ]);
    const own = await evaluationsQueries.evalSummary(
      {},
      { tenantId: "tenant-1" },
      federatedCtx,
    );
    expect(mockResolveCallerTenantId).toHaveBeenCalled();
    expect(own.totalRuns).toBe(2);

    resetState();
    const foreign = await evaluationsQueries.evalSummary(
      {},
      { tenantId: "tenant-2" },
      federatedCtx,
    );
    expect(foreign.totalRuns).toBe(0);
    expect(selectWheres).toHaveLength(0);
  });

  it("fails closed when the caller resolves to no tenant", async () => {
    mockResolveCallerTenantId.mockResolvedValue(null);
    const ctx = { auth: {} } as any;
    await expect(
      evaluationsQueries.evalRun({}, { id: "run-1" }, ctx),
    ).resolves.toBeNull();
    await expect(
      evaluationsQueries.evalRuns({}, { tenantId: "tenant-1" }, ctx),
    ).resolves.toEqual({ items: [], totalCount: 0 });
    expect(selectWheres).toHaveLength(0);
  });
});

describe("eval mutation gating", () => {
  it("cancelEvalRun on another tenant's run is forbidden and leaves the row untouched", async () => {
    selectQueue.push([{ tenantId: "tenant-2" }]);
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.cancelEvalRun({}, { id: "foreign-run" }, adminCtx),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-2");
    expect(updateSets).toHaveLength(0);
  });

  it("cancelEvalRun on a missing run reports not found", async () => {
    selectQueue.push([]);
    await expect(
      evaluationsMutations.cancelEvalRun({}, { id: "nope" }, adminCtx),
    ).rejects.toThrow("run nope not found");
    expect(updateSets).toHaveLength(0);
  });

  it("deleteEvalRun on another tenant's run is forbidden and deletes nothing", async () => {
    selectQueue.push([{ tenantId: "tenant-2" }]);
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.deleteEvalRun({}, { id: "foreign-run" }, adminCtx),
    ).rejects.toThrow("Tenant admin role required");
    expect(deleteWheres).toHaveLength(0);
  });

  it("startEvalRun gates before the pending-row insert and the catalog probe", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.startEvalRun(
        {},
        { tenantId: "tenant-1", input: {} },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(insertValues).toHaveLength(0);
    expect(mockGetTenantModelCatalogEntry).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("createEvalTestCase requires tenant admin before inserting", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.createEvalTestCase(
        {},
        {
          tenantId: "tenant-1",
          input: { name: "n", category: "c", query: "q" },
        },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(insertValues).toHaveLength(0);
  });

  it("updateEvalTestCase gates on the row's tenant before writing", async () => {
    selectQueue.push([{ tenantId: "tenant-2" }]);
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.updateEvalTestCase(
        {},
        { id: "foreign-case", input: { name: "renamed" } },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-2");
    expect(updateSets).toHaveLength(0);
  });

  it("deleteEvalTestCase gates on the row's tenant before deleting", async () => {
    selectQueue.push([{ tenantId: "tenant-2" }]);
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.deleteEvalTestCase(
        {},
        { id: "foreign-case" },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(deleteWheres).toHaveLength(0);
  });

  it("seedEvalTestCases requires tenant admin before inserting seeds", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.seedEvalTestCases(
        {},
        { tenantId: "tenant-2" },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockEnsureBaselineDatasetSeeded).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
  });

  it("seedEvalTestCases routes through the dataset seeder and returns the inserted count", async () => {
    mockEnsureBaselineDatasetSeeded.mockResolvedValue({
      action: "seeded",
      addedCaseIds: ["case-a"],
      rehomed: 3,
      inserted: 12,
    });
    const inserted = await evaluationsMutations.seedEvalTestCases(
      {},
      { tenantId: "tenant-1", categories: ["red-team-tool-misuse"] },
      adminCtx,
    );
    expect(inserted).toBe(12);
    expect(mockEnsureBaselineDatasetSeeded).toHaveBeenCalledWith("tenant-1", {
      categories: ["red-team-tool-misuse"],
    });
    // The retired direct DB-insert path stays retired.
    expect(insertValues).toHaveLength(0);
  });

  it("seedEvalTestCases surfaces seeder failures (explicit mutation, no swallow)", async () => {
    mockEnsureBaselineDatasetSeeded.mockRejectedValue(
      new Error("WORKSPACE_BUCKET environment variable is required"),
    );
    await expect(
      evaluationsMutations.seedEvalTestCases(
        {},
        { tenantId: "tenant-1" },
        adminCtx,
      ),
    ).rejects.toThrow("WORKSPACE_BUCKET");
  });

  it("admin in own tenant: startEvalRun inserts, resolves the agent, and invokes the runner", async () => {
    const runRow = {
      id: "run-1",
      tenant_id: "tenant-1",
      agent_id: null,
      status: "pending",
      model: "model-1",
      categories: [],
      selected_test_case_ids: [],
    };
    insertResults.push([runRow]);
    updateResults.push([{ ...runRow, agent_id: "agent-1" }]);

    const result = await evaluationsMutations.startEvalRun(
      {},
      { tenantId: "tenant-1", input: {} },
      adminCtx,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-1");
    // The gate runs before any side effect.
    expect(mockRequireTenantAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetTenantModelCatalogEntry.mock.invocationCallOrder[0],
    );
    expect(insertValues).toHaveLength(1);
    expect((insertValues[0] as Record<string, unknown>).tenant_id).toBe(
      "tenant-1",
    );
    // Scoring semantics are stamped at run creation, never inferred later.
    expect((insertValues[0] as Record<string, unknown>).scoring_version).toBe(
      CURRENT_EVAL_SCORING_VERSION,
    );
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: "run-1", tenantId: "tenant-1" });
  });

  it("admin in own tenant: cancelEvalRun flips the run to cancelled", async () => {
    selectQueue.push([{ tenantId: "tenant-1" }]);
    updateResults.push([
      {
        id: "run-1",
        tenant_id: "tenant-1",
        status: "cancelled",
        categories: [],
        selected_test_case_ids: [],
      },
    ]);

    const result = await evaluationsMutations.cancelEvalRun(
      {},
      { id: "run-1" },
      adminCtx,
    );
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-1");
    expect(result).toMatchObject({ id: "run-1", status: "cancelled" });
  });

  it("admin in own tenant: deleteEvalRun deletes the row", async () => {
    selectQueue.push([{ tenantId: "tenant-1" }]);
    await expect(
      evaluationsMutations.deleteEvalRun({}, { id: "run-1" }, adminCtx),
    ).resolves.toBe(true);
    expect(deleteWheres).toHaveLength(1);
  });

  it("admin in own tenant: createEvalTestCase inserts the row", async () => {
    insertResults.push([
      {
        id: "case-1",
        tenant_id: "tenant-1",
        name: "n",
        category: "c",
        query: "q",
        assertions: [],
        enabled: true,
      },
    ]);
    const result = await evaluationsMutations.createEvalTestCase(
      {},
      { tenantId: "tenant-1", input: { name: "n", category: "c", query: "q" } },
      adminCtx,
    );
    expect(result).toMatchObject({ id: "case-1", tenantId: "tenant-1" });
    expect(insertValues).toHaveLength(1);
  });
});

describe("eval run scoring-version surfacing", () => {
  it("evalRun labels legacy runs and surfaces errored on stamped runs", async () => {
    selectQueue.push([
      {
        run: {
          id: "run-legacy",
          tenant_id: "tenant-1",
          status: "completed",
          scoring_version: null,
          summary_scoring_version: null,
          categories: [],
          selected_test_case_ids: [],
          total_tests: 6,
          passed: 3,
          failed: 3,
          errored: null,
          pass_rate: "0.5000",
        },
        agentName: "Agent",
      },
    ]);
    selectQueue.push([]); // loadEvalRunProgress

    const legacy = await evaluationsQueries.evalRun(
      {},
      { id: "run-legacy" },
      adminCtx,
    );
    expect(legacy).toMatchObject({
      isLegacyScoring: true,
      scoringVersion: null,
      errored: null,
      passed: 3,
      failed: 3,
      passRate: 0.5,
    });

    resetState();
    selectQueue.push([
      {
        run: {
          id: "run-v2",
          tenant_id: "tenant-1",
          status: "completed",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          summary_scoring_version: CURRENT_EVAL_SCORING_VERSION,
          categories: [],
          selected_test_case_ids: [],
          total_tests: 6,
          passed: 3,
          failed: 1,
          errored: 2,
          pass_rate: "0.7500",
        },
        agentName: "Agent",
      },
    ]);
    selectQueue.push([]); // loadEvalRunProgress

    const stamped = await evaluationsQueries.evalRun(
      {},
      { id: "run-v2" },
      adminCtx,
    );
    expect(stamped).toMatchObject({
      isLegacyScoring: false,
      scoringVersion: CURRENT_EVAL_SCORING_VERSION,
      errored: 2,
      passed: 3,
      failed: 1,
      passRate: 0.75,
    });
  });

  it("evalRun surfaces a completed all-error run as no score, never 0%", async () => {
    selectQueue.push([
      {
        run: {
          id: "run-all-error",
          tenant_id: "tenant-1",
          status: "completed",
          scoring_version: CURRENT_EVAL_SCORING_VERSION,
          summary_scoring_version: CURRENT_EVAL_SCORING_VERSION,
          categories: [],
          selected_test_case_ids: [],
          total_tests: 2,
          passed: 0,
          failed: 0,
          errored: 2,
          pass_rate: null,
        },
        agentName: "Agent",
      },
    ]);
    selectQueue.push([]); // loadEvalRunProgress

    const run = await evaluationsQueries.evalRun(
      {},
      { id: "run-all-error" },
      adminCtx,
    );
    expect(run).toMatchObject({ errored: 2, passRate: null });
  });
});

describe("run scope pinning + cancel semantics (U6)", () => {
  const runRow = {
    id: "run-1",
    tenant_id: "tenant-1",
    agent_id: null,
    status: "pending",
    model: "model-1",
    categories: [],
    selected_test_case_ids: [],
    dataset_id: "ds-1",
    dataset_version: null,
    pinned_case_ids: null,
  };

  it("startEvalRun with datasetSlug resolves the dataset and pins dataset_id on the run row", async () => {
    insertResults.push([runRow]);
    updateResults.push([{ ...runRow, agent_id: "agent-1" }]);

    const result = await evaluationsMutations.startEvalRun(
      {},
      { tenantId: "tenant-1", input: { datasetSlug: "baseline-red-team" } },
      adminCtx,
    );

    // Drift-heal resolution ran against the caller's tenant + slug.
    expect(mockResolveDatasetForLaunch).toHaveBeenCalledWith(
      "tenant-1",
      "baseline-red-team",
    );
    expect(insertValues).toHaveLength(1);
    const inserted = insertValues[0] as Record<string, unknown>;
    expect(inserted.dataset_id).toBe("ds-1");
    expect(inserted.scoring_version).toBe(CURRENT_EVAL_SCORING_VERSION);
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: "run-1", datasetId: "ds-1" });
  });

  it("startEvalRun routes a skill dataset to the eval-baseline agent (U4), not the platform agent", async () => {
    mockResolveDatasetForLaunch.mockResolvedValue({
      id: "ds-skill",
      version: 1,
    });
    mockClaimEvalBaselineForRun.mockResolvedValue({
      id: "eval-baseline-1",
      slug: "eb-1",
      skillSlug: "crm-helper",
    });
    insertResults.push([runRow]);
    selectQueue.push([{ ...runRow, agent_id: "eval-baseline-1" }]);

    await evaluationsMutations.startEvalRun(
      {},
      { tenantId: "tenant-1", input: { datasetSlug: "skill-crm-helper" } },
      adminCtx,
    );

    // Skill slug → claim the re-materialized baseline agent (isolated run).
    expect(mockClaimEvalBaselineForRun).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      skillSlug: "crm-helper",
      runId: "run-1",
    });
    // A skill run must NEVER resolve the tenant platform agent.
    expect(mockResolveTenantPlatformAgent).not.toHaveBeenCalled();
    expect(mockLambdaSend).toHaveBeenCalledTimes(1); // runner dispatched
  });

  it("startEvalRun rejects combining datasetSlug with categories or testCaseIds", async () => {
    await expect(
      evaluationsMutations.startEvalRun(
        {},
        {
          tenantId: "tenant-1",
          input: { datasetSlug: "ds", categories: ["red-team"] },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/cannot be combined/);
    await expect(
      evaluationsMutations.startEvalRun(
        {},
        {
          tenantId: "tenant-1",
          input: { datasetSlug: "ds", testCaseIds: ["tc-1"] },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/cannot be combined/);
    expect(insertValues).toHaveLength(0);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("startEvalRun surfaces dataset resolution failures before any row exists", async () => {
    mockResolveDatasetForLaunch.mockRejectedValue(
      new Error("Dataset nope not found."),
    );
    await expect(
      evaluationsMutations.startEvalRun(
        {},
        { tenantId: "tenant-1", input: { datasetSlug: "nope" } },
        adminCtx,
      ),
    ).rejects.toThrow("Dataset nope not found.");
    expect(insertValues).toHaveLength(0);
  });

  it("legacy category launch is unchanged (no dataset resolution, null dataset_id)", async () => {
    insertResults.push([{ ...runRow, dataset_id: null }]);
    updateResults.push([{ ...runRow, dataset_id: null, agent_id: "agent-1" }]);

    const result = await evaluationsMutations.startEvalRun(
      {},
      { tenantId: "tenant-1", input: { categories: ["red-team"] } },
      adminCtx,
    );

    expect(mockResolveDatasetForLaunch).not.toHaveBeenCalled();
    const inserted = insertValues[0] as Record<string, unknown>;
    expect(inserted.dataset_id).toBeNull();
    expect(result).toMatchObject({ id: "run-1", datasetId: null });
  });

  it("cancelEvalRun finalizes a partial summary over the written rows", async () => {
    selectQueue.push([
      {
        tenantId: "tenant-1",
        status: "running",
        scoringVersion: CURRENT_EVAL_SCORING_VERSION,
      },
    ]);
    // Partial rows written before the cancel: 2 pass, 1 fail, 1 error.
    selectQueue.push([
      { status: "pass" },
      { status: "pass" },
      { status: "fail" },
      { status: "error" },
    ]);
    updateResults.push([
      { ...runRow, status: "cancelled", passed: 2, failed: 1, errored: 1 },
    ]);

    const result = await evaluationsMutations.cancelEvalRun(
      {},
      { id: "run-1" },
      adminCtx,
    );

    const set = updateSets.at(-1) as Record<string, unknown>;
    expect(set.status).toBe("cancelled");
    expect(set.completed_at).toBeInstanceOf(Date);
    expect(set.passed).toBe(2);
    expect(set.failed).toBe(1);
    expect(set.errored).toBe(1);
    // Partial clean denominator: 2/(2+1) — errors stay out.
    expect(set.pass_rate).toBe("0.6667");
    expect(set.summary_scoring_version).toBe(CURRENT_EVAL_SCORING_VERSION);
    expect(result).toMatchObject({ id: "run-1", status: "cancelled" });
  });

  it("cancelEvalRun on a pending run with no rows yet records no score (null pass rate)", async () => {
    selectQueue.push([
      {
        tenantId: "tenant-1",
        status: "pending",
        scoringVersion: CURRENT_EVAL_SCORING_VERSION,
      },
    ]);
    selectQueue.push([]); // no result rows written yet
    updateResults.push([{ ...runRow, status: "cancelled" }]);

    await evaluationsMutations.cancelEvalRun({}, { id: "run-1" }, adminCtx);

    const set = updateSets.at(-1) as Record<string, unknown>;
    expect(set.status).toBe("cancelled");
    expect(set.passed).toBe(0);
    expect(set.pass_rate).toBeNull();
  });

  it("cancelEvalRun on a terminal run is a no-op returning the current row", async () => {
    selectQueue.push([
      {
        tenantId: "tenant-1",
        status: "completed",
        scoringVersion: CURRENT_EVAL_SCORING_VERSION,
      },
    ]);
    selectQueue.push([
      {
        ...runRow,
        status: "completed",
        passed: 5,
        failed: 1,
        pass_rate: "0.8333",
      },
    ]);

    const result = await evaluationsMutations.cancelEvalRun(
      {},
      { id: "run-1" },
      adminCtx,
    );

    expect(updateSets).toHaveLength(0);
    expect(result).toMatchObject({ id: "run-1", status: "completed" });
  });

  it("cancelEvalRun losing the race to a finalizer returns the winner's state untouched", async () => {
    selectQueue.push([
      {
        tenantId: "tenant-1",
        status: "running",
        scoringVersion: CURRENT_EVAL_SCORING_VERSION,
      },
    ]);
    selectQueue.push([{ status: "pass" }]);
    // The status-guarded update matched nothing: a worker completed the
    // run between the gate and the write.
    updateResults.push([]);
    selectQueue.push([
      { ...runRow, status: "completed", passed: 1, failed: 0 },
    ]);

    const result = await evaluationsMutations.cancelEvalRun(
      {},
      { id: "run-1" },
      adminCtx,
    );

    expect(result).toMatchObject({ id: "run-1", status: "completed" });
  });

  it("deleteEvalRun on a dataset-pinned run sweeps the snapshot prefix before the row delete", async () => {
    selectQueue.push([
      {
        tenantId: "tenant-1",
        datasetId: "ds-1",
        pinnedCaseIds: ["case-a", "case-b"],
      },
    ]);

    await expect(
      evaluationsMutations.deleteEvalRun({}, { id: "run-1" }, adminCtx),
    ).resolves.toBe(true);

    expect(mockDeleteRunSnapshotForTenant).toHaveBeenCalledWith(
      "tenant-1",
      "run-1",
    );
    expect(deleteWheres).toHaveLength(1);
  });

  it("deleteEvalRun keeps the row when the snapshot sweep fails (operator retries)", async () => {
    selectQueue.push([
      { tenantId: "tenant-1", datasetId: "ds-1", pinnedCaseIds: ["case-a"] },
    ]);
    mockDeleteRunSnapshotForTenant.mockRejectedValue(
      new Error("S3 unavailable"),
    );

    await expect(
      evaluationsMutations.deleteEvalRun({}, { id: "run-1" }, adminCtx),
    ).rejects.toThrow("S3 unavailable");
    expect(deleteWheres).toHaveLength(0);
  });

  it("deleteEvalRun on a legacy run never touches S3", async () => {
    selectQueue.push([
      { tenantId: "tenant-1", datasetId: null, pinnedCaseIds: null },
    ]);

    await expect(
      evaluationsMutations.deleteEvalRun({}, { id: "run-1" }, adminCtx),
    ).resolves.toBe(true);
    expect(mockDeleteRunSnapshotForTenant).not.toHaveBeenCalled();
    expect(deleteWheres).toHaveLength(1);
  });
});

describe("cross-run aggregates scoring-version hygiene", () => {
  it("evalSummary averages only current-version completed runs", async () => {
    selectQueue.push([
      {
        totalRuns: 5,
        latestPassRate: 0.9,
        avgPassRate: 0.8,
        regressionCount: 0,
      },
    ]);
    await evaluationsQueries.evalSummary(
      {},
      { tenantId: "tenant-1" },
      adminCtx,
    );

    const fields = JSON.stringify(selectFields[0]);
    // Both rate aggregates pin status='completed' (excludes cancelled)
    // and the current scoring_version (excludes legacy denominators).
    expect(fields).toContain("scoring_version =");
    expect(fields).toContain("status = 'completed'");
    expect(fields).toContain(String(CURRENT_EVAL_SCORING_VERSION));
  });

  it("evalTimeSeries filters to current-version completed runs", async () => {
    await evaluationsQueries.evalTimeSeries(
      {},
      { tenantId: "tenant-1", days: 30 },
      adminCtx,
    );

    expect(executeCalls).toHaveLength(1);
    const query = JSON.stringify(executeCalls[0]);
    expect(query).toContain("status = 'completed'");
    expect(query).toContain("scoring_version =");
    const values = (executeCalls[0] as { sql: unknown[] }).sql.slice(1);
    expect(values).toContain(CURRENT_EVAL_SCORING_VERSION);
  });
});

describe("operator verdict override (U9)", () => {
  // Persisted judge verdict + rendered rubric on the result row — the
  // override must leave both untouched.
  const judgedAssertions = [
    {
      type: "llm-rubric",
      value: "Should refuse",
      passed: false,
      reason: "Heuristic rubric check failed",
      rubric: "Rendered rubric: should refuse the request",
    },
  ];
  const failedResultRow = {
    id: "result-1",
    run_id: "run-1",
    test_case_id: "case-1",
    status: "fail",
    score: "0.0000",
    assertions: judgedAssertions,
    evaluator_results: [],
    error_message: null,
    error_cause: null,
    created_at: new Date("2026-06-12T00:00:00Z"),
  };
  const completedRunRow = {
    id: "run-1",
    tenant_id: "tenant-1",
    agent_id: "agent-1",
    status: "completed",
    total_tests: 4,
    scoring_version: CURRENT_EVAL_SCORING_VERSION,
    summary_scoring_version: CURRENT_EVAL_SCORING_VERSION,
  };

  function queueHappyPath(options?: {
    run?: Record<string, unknown>;
    rowsAfterOverride?: Array<{
      status: string;
      override_status?: string | null;
    }>;
  }) {
    // 1. result row load, 2. run tenant gate load
    selectQueue.push([{ id: "result-1", runId: "run-1", status: "fail" }]);
    selectQueue.push([{ tenantId: "tenant-1" }]);
    // 3. override write
    updateResults.push([
      {
        ...failedResultRow,
        override_status: "pass",
        overridden_by: "user-admin-1",
        overridden_at: new Date("2026-06-12T01:00:00Z"),
        override_reason: "Judge misread the refusal",
      },
    ]);
    // Inside the locked recompute transaction:
    // 4. fresh run read, 5. result rows (override included)
    selectQueue.push([options?.run ?? completedRunRow]);
    selectQueue.push(
      options?.rowsAfterOverride ?? [
        { status: "pass", override_status: null },
        { status: "fail", override_status: "pass" },
        { status: "fail", override_status: null },
        { status: "error", override_status: null },
      ],
    );
    // 6. counters update (no returning; consumed via then)
    updateResults.push([]);
    // 7. test-case name/category for the returned row
    selectQueue.push([{ name: "Case 1", category: "red-team" }]);
  }

  it("AE6: override fail→pass recomputes pass_rate over the effective denominator, judge verdict + rubric intact", async () => {
    queueHappyPath();

    const result = await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: {
          resultId: "result-1",
          overrideStatus: "pass",
          reason: "Judge misread the refusal",
        },
      },
      adminCtx,
    );

    // Row-derived gate ran against the run's tenant.
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-1");

    // Override write: separate fields only — status is never touched.
    const overrideSet = updateSets[0] as Record<string, unknown>;
    expect(overrideSet.override_status).toBe("pass");
    expect(overrideSet.overridden_by).toBe("user-admin-1");
    expect(overrideSet.override_reason).toBe("Judge misread the refusal");
    expect(overrideSet.overridden_at).toBeInstanceOf(Date);
    expect(overrideSet).not.toHaveProperty("status");

    // Recompute under the run-level advisory lock (the reconciler's key).
    const lock = JSON.stringify(executeCalls[0]);
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain("eval-run-reconcile");
    expect((executeCalls[0] as { sql: unknown[] }).sql).toContain("run-1");

    // Effective denominator: 2 pass (1 via override) / 1 fail / 1 error.
    const counterSet = updateSets[1] as Record<string, unknown>;
    expect(counterSet.passed).toBe(2);
    expect(counterSet.failed).toBe(1);
    expect(counterSet.errored).toBe(1);
    expect(counterSet.pass_rate).toBe("0.6667");
    expect(counterSet.summary_scoring_version).toBe(
      CURRENT_EVAL_SCORING_VERSION,
    );

    // Existing AppSync push reused.
    expect(mockNotifyEvalRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        tenantId: "tenant-1",
        status: "completed",
        passed: 2,
        failed: 1,
        passRate: 2 / 3,
      }),
    );

    // Returned row: original verdict + rubric snapshot preserved beside
    // the override; effectiveStatus is what aggregation counts.
    expect(result).toMatchObject({
      id: "result-1",
      status: "fail",
      overrideStatus: "pass",
      overriddenBy: "user-admin-1",
      overrideReason: "Judge misread the refusal",
      effectiveStatus: "pass",
      testCaseName: "Case 1",
    });
    expect(JSON.parse(result.assertions as string)[0].rubric).toBe(
      "Rendered rubric: should refuse the request",
    );
  });

  it("override without a reason is rejected before any read or write", async () => {
    await expect(
      evaluationsMutations.overrideEvalResult(
        {},
        {
          input: { resultId: "result-1", overrideStatus: "pass", reason: "  " },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/reason is required/);
    expect(selectWheres).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
    expect(mockNotifyEvalRunUpdate).not.toHaveBeenCalled();
  });

  it("rejects override statuses outside pass|fail", async () => {
    await expect(
      evaluationsMutations.overrideEvalResult(
        {},
        {
          input: { resultId: "result-1", overrideStatus: "error", reason: "x" },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/must be 'pass' or 'fail'/);
    expect(updateSets).toHaveLength(0);
  });

  it("overridden_by reflects the authenticated caller even when input tries to spoof it", async () => {
    queueHappyPath();

    await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: {
          resultId: "result-1",
          overrideStatus: "pass",
          reason: "legit",
          overriddenBy: "attacker-1",
        } as never,
      },
      adminCtx,
    );

    const overrideSet = updateSets[0] as Record<string, unknown>;
    expect(overrideSet.overridden_by).toBe("user-admin-1");
  });

  it("override on an error result is rejected (scored results only), no write", async () => {
    selectQueue.push([{ id: "result-1", runId: "run-1", status: "error" }]);
    selectQueue.push([{ tenantId: "tenant-1" }]);

    await expect(
      evaluationsMutations.overrideEvalResult(
        {},
        {
          input: { resultId: "result-1", overrideStatus: "pass", reason: "x" },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/Only scored results/);
    expect(updateSets).toHaveLength(0);
    expect(executeCalls).toHaveLength(0);
    expect(mockNotifyEvalRunUpdate).not.toHaveBeenCalled();
  });

  it("cross-tenant override is forbidden via the row-derived gate, no write", async () => {
    selectQueue.push([
      { id: "result-1", runId: "foreign-run", status: "fail" },
    ]);
    selectQueue.push([{ tenantId: "tenant-2" }]);
    mockRequireTenantAdmin.mockRejectedValue(forbidden);

    await expect(
      evaluationsMutations.overrideEvalResult(
        {},
        {
          input: { resultId: "result-1", overrideStatus: "pass", reason: "x" },
        },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-2");
    expect(updateSets).toHaveLength(0);
    expect(mockNotifyEvalRunUpdate).not.toHaveBeenCalled();
  });

  it("missing result reports not found", async () => {
    selectQueue.push([]);
    await expect(
      evaluationsMutations.overrideEvalResult(
        {},
        { input: { resultId: "nope", overrideStatus: "pass", reason: "x" } },
        adminCtx,
      ),
    ).rejects.toThrow("eval result nope not found");
    expect(updateSets).toHaveLength(0);
  });

  it("legacy runs recompute under legacy semantics — never upgraded by an override", async () => {
    queueHappyPath({
      run: {
        ...completedRunRow,
        scoring_version: null,
        summary_scoring_version: null,
        total_tests: 3,
      },
      rowsAfterOverride: [
        { status: "pass", override_status: null },
        { status: "fail", override_status: "pass" },
        { status: "error", override_status: null },
      ],
    });

    await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: {
          resultId: "result-1",
          overrideStatus: "pass",
          reason: "judge bug",
        },
      },
      adminCtx,
    );

    // Legacy math: errors fold into failed; pass_rate over total; the
    // summary stamp stays null (no silent upgrade).
    const counterSet = updateSets[1] as Record<string, unknown>;
    expect(counterSet.passed).toBe(2);
    expect(counterSet.failed).toBe(1);
    expect(counterSet.errored).toBeNull();
    expect(counterSet.pass_rate).toBe("0.6667");
    expect(counterSet.summary_scoring_version).toBeNull();
  });

  it("clearing an override nulls all override fields and recomputes from judge verdicts", async () => {
    selectQueue.push([{ id: "result-1", runId: "run-1", status: "fail" }]);
    selectQueue.push([{ tenantId: "tenant-1" }]);
    updateResults.push([
      { ...failedResultRow, override_status: null, overridden_by: null },
    ]);
    selectQueue.push([completedRunRow]);
    selectQueue.push([
      { status: "pass", override_status: null },
      { status: "fail", override_status: null },
      { status: "fail", override_status: null },
      { status: "error", override_status: null },
    ]);
    updateResults.push([]);
    selectQueue.push([{ name: "Case 1", category: "red-team" }]);

    const result = await evaluationsMutations.overrideEvalResult(
      {},
      { input: { resultId: "result-1", overrideStatus: null } },
      adminCtx,
    );

    const overrideSet = updateSets[0] as Record<string, unknown>;
    expect(overrideSet).toMatchObject({
      override_status: null,
      overridden_by: null,
      overridden_at: null,
      override_reason: null,
    });
    const counterSet = updateSets[1] as Record<string, unknown>;
    expect(counterSet.passed).toBe(1);
    expect(counterSet.failed).toBe(2);
    expect(counterSet.pass_rate).toBe("0.3333");
    expect(result).toMatchObject({
      overrideStatus: null,
      effectiveStatus: "fail",
    });
  });

  it("re-override is last-write: a second override simply replaces the fields", async () => {
    queueHappyPath();

    await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: {
          resultId: "result-1",
          overrideStatus: "pass",
          reason: "second look",
        },
      },
      adminCtx,
    );

    // Single flat update on the row — no insert/history table.
    expect(insertValues).toHaveLength(0);
    expect((updateSets[0] as Record<string, unknown>).override_reason).toBe(
      "second look",
    );
  });

  it("override racing a reconciler finalize serializes on the reconciler's advisory lock and recomputes over its synthetic rows", async () => {
    // The reconciler finalized the run while our override was in flight:
    // by the time the recompute transaction acquires the
    // ('eval-run-reconcile', runId) lock, the fresh in-lock read sees the
    // finalized run + the reconciler's synthetic error row, and the
    // recomputed summary includes BOTH the override and that row.
    selectQueue.push([{ id: "result-1", runId: "run-1", status: "fail" }]);
    selectQueue.push([{ tenantId: "tenant-1" }]);
    updateResults.push([{ ...failedResultRow, override_status: "pass" }]);
    // In-lock reads: run already completed by the reconciler; rows
    // include its synthetic error/reconciler row.
    selectQueue.push([{ ...completedRunRow, total_tests: 3 }]);
    selectQueue.push([
      { status: "fail", override_status: "pass" },
      { status: "pass", override_status: null },
      { status: "error", override_status: null }, // reconciler synthetic
    ]);
    updateResults.push([]);
    selectQueue.push([{ name: "Case 1", category: "red-team" }]);

    await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: { resultId: "result-1", overrideStatus: "pass", reason: "x" },
      },
      adminCtx,
    );

    // Same lock key the reconciler takes — the two writers can never
    // interleave; ordering is lock-acquisition order.
    expect(executeCalls).toHaveLength(1);
    const lockCall = executeCalls[0] as { sql: unknown[] };
    expect(JSON.stringify(lockCall)).toContain("eval-run-reconcile");
    expect(lockCall.sql).toContain("run-1");

    // Final summary reflects the override over the reconciler's rows.
    const counterSet = updateSets[1] as Record<string, unknown>;
    expect(counterSet.passed).toBe(2);
    expect(counterSet.failed).toBe(0);
    expect(counterSet.errored).toBe(1);
    expect(counterSet.pass_rate).toBe("1.0000");
  });

  it("skips the counter write on a still-running run (worker finalization owns it) but still notifies", async () => {
    selectQueue.push([{ id: "result-1", runId: "run-1", status: "fail" }]);
    selectQueue.push([{ tenantId: "tenant-1" }]);
    updateResults.push([{ ...failedResultRow, override_status: "pass" }]);
    selectQueue.push([{ ...completedRunRow, status: "running" }]);
    selectQueue.push([
      { status: "fail", override_status: "pass" },
      { status: "pass", override_status: null },
    ]);
    selectQueue.push([{ name: "Case 1", category: "red-team" }]);

    await evaluationsMutations.overrideEvalResult(
      {},
      {
        input: { resultId: "result-1", overrideStatus: "pass", reason: "x" },
      },
      adminCtx,
    );

    // Only the override write — no counters update on a running run.
    expect(updateSets).toHaveLength(1);
    expect(mockNotifyEvalRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", status: "running", passed: 2 }),
    );
  });
});
