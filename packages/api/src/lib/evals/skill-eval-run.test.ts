/**
 * Skill-eval run launcher + score read tests (Skill Tests & Evals U5).
 *
 * Everything external is mocked: a chain-recording `db`, plus spies for
 * `resolveDatasetForLaunch`, `getTenantModelCatalogEntry`,
 * `claimEvalBaselineForRun`, and the Lambda client. The launcher is
 * self-guarding (never throws) — the busy/skipped arms must mark the run
 * failed and return a status, not propagate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  insertValues,
  insertResults,
  updateSets,
  updateWheres,
  mockResolveDatasetForLaunch,
  mockGetTenantModelCatalogEntry,
  mockClaimEvalBaselineForRun,
  mockLambdaSend,
  resetState,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertValues: unknown[] = [];
  const insertResults: unknown[][] = [];
  const updateSets: unknown[] = [];
  const updateWheres: unknown[] = [];
  return {
    selectQueue,
    insertValues,
    insertResults,
    updateSets,
    updateWheres,
    mockResolveDatasetForLaunch: vi.fn(),
    mockGetTenantModelCatalogEntry: vi.fn(),
    mockClaimEvalBaselineForRun: vi.fn(),
    mockLambdaSend: vi.fn(),
    resetState: () => {
      selectQueue.length = 0;
      insertValues.length = 0;
      insertResults.length = 0;
      updateSets.length = 0;
      updateWheres.length = 0;
    },
  };
});

vi.mock("../../graphql/utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of ["from", "orderBy", "groupBy"]) {
      chain[method] = () => chain;
    }
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => ({
        values: (v: unknown) => {
          insertValues.push(v);
          return {
            returning: () => Promise.resolve(insertResults.shift() ?? []),
          };
        },
      }),
      update: () => ({
        set: (s: unknown) => {
          updateSets.push(s);
          return {
            where: (clause: unknown) => {
              updateWheres.push(clause);
              return Promise.resolve();
            },
          };
        },
      }),
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    desc: (arg: unknown) => ({ desc: arg }),
    sql: (...args: unknown[]) => ({ sql: args }),
    evalDatasets: { id: "ds.id", tenant_id: "ds.tenant", slug: "ds.slug" },
    evalTestCases: { dataset_id: "tc.dataset", enabled: "tc.enabled" },
  };
});

vi.mock("./run-launch.js", () => ({
  resolveDatasetForLaunch: mockResolveDatasetForLaunch,
}));

vi.mock("../model-catalog/tenant-catalog.js", () => ({
  getTenantModelCatalogEntry: mockGetTenantModelCatalogEntry,
}));

vi.mock("./eval-baseline-agent.js", () => ({
  claimEvalBaselineForRun: mockClaimEvalBaselineForRun,
  EvalBaselineBusyError: class EvalBaselineBusyError extends Error {
    constructor(public readonly tenantId: string) {
      super("A skill evaluation is already running for this tenant.");
      this.name = "EvalBaselineBusyError";
    }
  },
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
import { DEFAULT_EVAL_MODEL_ID } from "./agentcore-direct.js";
import { EvalBaselineBusyError } from "./eval-baseline-agent.js";
import { launchSkillEvalRun, readSkillEvalScore } from "./skill-eval-run.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  process.env.EVAL_RUNNER_FN = "thinkwork-dev-api-eval-runner";
});

describe("launchSkillEvalRun", () => {
  it("returns unrated when the dataset has no manifest", async () => {
    mockResolveDatasetForLaunch.mockRejectedValueOnce(
      new Error("Dataset skill-x not found."),
    );
    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });
    expect(result).toEqual({ status: "unrated" });
    expect(insertValues).toHaveLength(0);
    expect(mockClaimEvalBaselineForRun).not.toHaveBeenCalled();
  });

  it("returns unrated when the dataset has zero enabled cases", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 0 }]); // enabled-case count
    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });
    expect(result).toEqual({ status: "unrated" });
    expect(insertValues).toHaveLength(0);
  });

  it("skips when the default eval model is not enabled in the tenant catalog", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 3 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce(null);
    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });
    expect(result).toEqual({
      status: "skipped",
      reason: "default eval model not enabled in tenant catalog",
    });
    expect(insertValues).toHaveLength(0);
    expect(mockGetTenantModelCatalogEntry).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      modelId: DEFAULT_EVAL_MODEL_ID,
    });
  });

  it("launches: inserts a pending run, claims the baseline, fires the runner", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 2 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce({ enabled: true });
    insertResults.push([{ id: "run-1" }]);
    mockClaimEvalBaselineForRun.mockResolvedValueOnce({
      id: "agent-1",
      slug: "agent-slug",
      skillSlug: "x",
    });

    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });

    expect(result).toEqual({ status: "launched", runId: "run-1" });
    // Pending row stamped with the dataset + current scoring version.
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      agent_id: null,
      status: "pending",
      execution_target: "agentcore",
      runtime_host: "aws-agentcore",
      model: DEFAULT_EVAL_MODEL_ID,
      dataset_id: "ds-1",
      scoring_version: CURRENT_EVAL_SCORING_VERSION,
    });
    expect(mockClaimEvalBaselineForRun).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      skillSlug: "x",
      runId: "run-1",
    });
    // Runner fired async (Event invoke) with the run id.
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invoke: any = mockLambdaSend.mock.calls[0][0];
    expect(invoke.input.InvocationType).toBe("Event");
    expect(invoke.input.FunctionName).toBe("thinkwork-dev-api-eval-runner");
    expect(JSON.parse(new TextDecoder().decode(invoke.input.Payload))).toEqual({
      runId: "run-1",
    });
    // No failed-marking on the happy path.
    expect(updateSets).toHaveLength(0);
  });

  it("datasetSlugOverride targets the staging dataset while the skill drives materialization (U6)", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-candidate",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 2 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce({ enabled: true });
    insertResults.push([{ id: "run-c" }]);
    mockClaimEvalBaselineForRun.mockResolvedValueOnce({
      id: "agent-1",
      slug: "agent-slug",
      skillSlug: "x",
    });

    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
      datasetSlugOverride: "skill-x-candidate",
    });

    expect(result).toEqual({ status: "launched", runId: "run-c" });
    // The run targets the STAGING dataset, not the live skill-x dataset.
    expect(mockResolveDatasetForLaunch).toHaveBeenCalledWith(
      "tenant-1",
      "skill-x-candidate",
    );
    expect(insertValues[0]).toMatchObject({ dataset_id: "ds-candidate" });
    // The baseline still materializes the catalog (= candidate) skill content
    // by skill slug — the override only changes which dataset is scored.
    expect(mockClaimEvalBaselineForRun).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      skillSlug: "x",
      runId: "run-c",
    });
  });

  it("busy: a baseline claim conflict marks the run failed and returns busy", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 1 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce({ enabled: true });
    insertResults.push([{ id: "run-1" }]);
    mockClaimEvalBaselineForRun.mockRejectedValueOnce(
      new EvalBaselineBusyError("tenant-1"),
    );

    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });

    expect(result).toEqual({ status: "busy" });
    // The pending run was marked failed (recoverable trail), runner NOT fired.
    expect(updateSets[0]).toMatchObject({ status: "failed" });
    expect(
      (updateSets[0] as Record<string, unknown>).completed_at,
    ).toBeInstanceOf(Date);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("skips (run marked failed) when the baseline claim fails for another reason", async () => {
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 1 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce({ enabled: true });
    insertResults.push([{ id: "run-1" }]);
    mockClaimEvalBaselineForRun.mockRejectedValueOnce(
      new Error("workspace materialization failed"),
    );

    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "workspace materialization failed",
    });
    expect(updateSets[0]).toMatchObject({ status: "failed" });
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("skips (run marked failed) when the runner fn is not configured", async () => {
    delete process.env.EVAL_RUNNER_FN;
    delete process.env.STAGE;
    mockResolveDatasetForLaunch.mockResolvedValueOnce({
      id: "ds-1",
      version: 1,
    });
    selectQueue.push([{ enabledCount: 1 }]);
    mockGetTenantModelCatalogEntry.mockResolvedValueOnce({ enabled: true });
    insertResults.push([{ id: "run-1" }]);
    mockClaimEvalBaselineForRun.mockResolvedValueOnce({
      id: "agent-1",
      slug: "agent-slug",
      skillSlug: "x",
    });

    const result = await launchSkillEvalRun({
      tenantId: "tenant-1",
      skillSlug: "x",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "EVAL_RUNNER_FN not configured",
    });
    expect(updateSets[0]).toMatchObject({ status: "failed" });
  });
});

describe("readSkillEvalScore", () => {
  it("returns unrated when no dataset row exists", async () => {
    selectQueue.push([]); // dataset lookup → none
    const score = await readSkillEvalScore("tenant-1", "x");
    expect(score).toEqual({
      skillSlug: "x",
      datasetSlug: "skill-x",
      tenantId: "tenant-1",
      rated: false,
      passRate: null,
      regression: false,
      lastRunId: null,
      lastRunAt: null,
      totalCases: 0,
    });
  });

  it("computes regression=true when the latest run scored below the previous", async () => {
    const completedAt = new Date("2026-06-13T10:00:00.000Z");
    selectQueue.push([{ id: "ds-1" }]); // dataset
    selectQueue.push([{ totalCases: 4 }]); // enabled-case count
    selectQueue.push([
      { id: "run-2", passRate: "0.5000", completedAt },
      { id: "run-1", passRate: "0.8000", completedAt: new Date() },
    ]);
    const score = await readSkillEvalScore("tenant-1", "x");
    expect(score.rated).toBe(true);
    expect(score.passRate).toBe(0.5);
    expect(score.regression).toBe(true);
    expect(score.lastRunId).toBe("run-2");
    expect(score.lastRunAt).toBe("2026-06-13T10:00:00.000Z");
    expect(score.totalCases).toBe(4);
  });

  it("computes regression=false when the latest run scored at or above the previous", async () => {
    selectQueue.push([{ id: "ds-1" }]);
    selectQueue.push([{ totalCases: 2 }]);
    selectQueue.push([
      { id: "run-2", passRate: "0.9000", completedAt: new Date() },
      { id: "run-1", passRate: "0.8000", completedAt: new Date() },
    ]);
    const score = await readSkillEvalScore("tenant-1", "x");
    expect(score.passRate).toBe(0.9);
    expect(score.regression).toBe(false);
  });

  it("rated dataset with a single completed run reports its pass rate, no regression", async () => {
    selectQueue.push([{ id: "ds-1" }]);
    selectQueue.push([{ totalCases: 3 }]);
    selectQueue.push([
      { id: "run-1", passRate: "0.7500", completedAt: new Date() },
    ]);
    const score = await readSkillEvalScore("tenant-1", "x");
    expect(score.rated).toBe(true);
    expect(score.passRate).toBe(0.75);
    expect(score.regression).toBe(false);
    expect(score.lastRunId).toBe("run-1");
  });

  it("rated dataset with no completed runs reports rated:true but no score", async () => {
    selectQueue.push([{ id: "ds-1" }]);
    selectQueue.push([{ totalCases: 5 }]);
    selectQueue.push([]); // no completed scored runs yet
    const score = await readSkillEvalScore("tenant-1", "x");
    expect(score.rated).toBe(true);
    expect(score.totalCases).toBe(5);
    expect(score.passRate).toBe(null);
    expect(score.regression).toBe(false);
    expect(score.lastRunId).toBe(null);
  });

  it("datasetSlugOverride reads the staging dataset's score (U6)", async () => {
    selectQueue.push([{ id: "ds-candidate" }]); // staging dataset row
    selectQueue.push([{ totalCases: 2 }]);
    selectQueue.push([
      { id: "run-c", passRate: "0.6000", completedAt: new Date() },
    ]);
    const score = await readSkillEvalScore(
      "tenant-1",
      "x",
      "skill-x-candidate",
    );
    // The reported dataset slug is the staging slug, not the live skill-x.
    expect(score.datasetSlug).toBe("skill-x-candidate");
    expect(score.rated).toBe(true);
    expect(score.passRate).toBe(0.6);
    expect(score.lastRunId).toBe("run-c");
  });

  it("unrated staging dataset (no row) reports the staging slug, unrated (U6)", async () => {
    selectQueue.push([]); // no staging dataset row
    const score = await readSkillEvalScore(
      "tenant-1",
      "x",
      "skill-x-candidate",
    );
    expect(score.datasetSlug).toBe("skill-x-candidate");
    expect(score.rated).toBe(false);
    expect(score.passRate).toBe(null);
  });
});
