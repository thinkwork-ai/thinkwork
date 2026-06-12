import { beforeEach, describe, expect, it, vi } from "vitest";

const {
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
  mockRequireTenantAdmin,
  mockGetTenantModelCatalogEntry,
  mockResolveTenantPlatformAgent,
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
    mockRequireTenantAdmin: vi.fn(),
    mockGetTenantModelCatalogEntry: vi.fn(),
    mockResolveTenantPlatformAgent: vi.fn(),
    mockLambdaSend: vi.fn(),
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
  return {
    db: {
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

vi.mock("../../../lib/eval-seeds.js", () => ({
  BUILT_IN_EVAL_SEED_SOURCE: "yaml-seed",
  EVAL_SEEDS: [
    {
      name: "seed-case-1",
      category: "safety",
      query: "Try to exfiltrate secrets",
      assertions: [],
    },
  ],
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
  mockRequireTenantAdmin.mockResolvedValue("admin");
  mockGetTenantModelCatalogEntry.mockResolvedValue({ model_id: "model-1" });
  mockResolveTenantPlatformAgent.mockResolvedValue({ id: "agent-1" });
  mockLambdaSend.mockResolvedValue({});
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
    expect(insertValues).toHaveLength(0);
    expect(selectWheres).toHaveLength(0);
  });

  it("evalTestCases seeds the caller's own tenant on first visit", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-seed-1" },
    } as any;
    selectQueue.push([{ count: 0 }]); // yaml-seed probe: nothing seeded yet
    selectQueue.push([]); // final test-case listing
    const result = await evaluationsQueries.evalTestCases(
      {},
      { tenantId: "tenant-seed-1" },
      ctx,
    );
    expect(result).toEqual([]);
    expect(insertValues).toHaveLength(1);
    const seeded = insertValues[0] as Array<Record<string, unknown>>;
    expect(seeded[0].tenant_id).toBe("tenant-seed-1");
  });

  it("evalTestCases pins the datasetId filter into the row conditions", async () => {
    const ctx = {
      auth: { authType: "cognito", tenantId: "tenant-ds-filter" },
    } as any;
    selectQueue.push([{ count: 1 }]); // yaml-seed probe: already seeded
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
    expect(insertValues).toHaveLength(0);
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
