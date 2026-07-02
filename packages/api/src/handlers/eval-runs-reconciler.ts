/**
 * eval-runs-reconciler Lambda
 *
 * Runs on a 5-minute schedule. If an eval run is still `running` but has made
 * no result progress for a bounded window, synthesize error rows for missing
 * category-selected test cases and finalize the run.
 *
 * Why: eval-worker finalization is last-writer based. If a worker process is
 * killed before it can write a per-case error row, no later worker may exist to
 * trip finalization, leaving the Admin UI stuck on "running" forever.
 */

import type { ScheduledEvent } from "aws-lambda";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  evalCaseOverrides,
  evalResults,
  evalRuns,
  evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
  CURRENT_EVAL_SCORING_VERSION,
  summarizeEvalStatuses,
} from "@thinkwork/evals-core";
import {
  summarizeEvalRunVerdicts,
  summaryScoringVersionFor,
  type EvalRunCaseOverrideRow,
} from "../lib/evals/case-verdicts.js";
import type { EvalTrialPlanEntry } from "./eval-runner.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

const STALE_AFTER_MINUTES = envNumber("EVAL_RUN_STALE_AFTER_MINUTES", 15);
const BATCH_SIZE = envNumber("EVAL_RUN_RECONCILE_BATCH_SIZE", 25);
const RECONCILER_EVALUATOR_ID = "ThinkWork.EvalRunReconciler";

type EvalRunCandidate = {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  status: string;
  categories: string[];
  selected_test_case_ids: string[];
  /**
   * Dataset-pinned runs (Trust Core U6): the expected case set is
   * reconstructed from the launch-time pinned_case_ids — NEVER the live
   * table's enabled=true filter, which would wedge a run whose case was
   * tombstoned mid-run via the count-mismatch skip.
   */
  dataset_id: string | null;
  pinned_case_ids: string[] | null;
  /**
   * Trial-plan runs (Eval Profiles U4): [{ caseId, trials }] where
   * caseId is the eval_test_cases row uuid the fan-out messages carried.
   * When present, the expected result-row set is reconstructed from this
   * immutable plan — one row per (case, trial 0..trials-1). Null on
   * pre-trial runs, which keep the per-case reconstruction.
   */
  pinned_trial_plan: EvalTrialPlanEntry[] | null;
  total_tests: number;
  /** True fan-out count; completion compares COALESCE(this, total_tests). */
  expected_result_rows: number | null;
  scoring_version: number | null;
  started_at: Date | null;
  last_result_at: Date | null;
  result_count: number;
};

type EvalResultSummary = {
  passed: number;
  failed: number;
  errored: number | null;
  unstable: number | null;
  passRate: number | null;
  totalCostUsd: number;
  /**
   * Cost honesty (Eval Profiles U5, R6): true when any row is missing a
   * priced agent-turn cost — reconciler-synthesized rows always are —
   * so totalCostUsd understates real spend and must render as partial.
   */
  costPartial: boolean;
};

type ReconciledRun = {
  runId: string;
  tenantId: string;
  agentId: string | null;
  totalTests: number;
  insertedErrors: number;
  summary: EvalResultSummary;
};

export function shouldReconcileEvalRun(
  row: Pick<
    EvalRunCandidate,
    "status" | "total_tests" | "started_at" | "last_result_at" | "result_count"
  > &
    Partial<Pick<EvalRunCandidate, "expected_result_rows">>,
  now: Date,
  staleAfterMs = STALE_AFTER_MINUTES * 60_000,
): boolean {
  if (row.status !== "running") return false;
  if (row.total_tests <= 0) return false;
  // Completion arithmetic reads the pinned fan-out count when present
  // (Eval Profiles U4); pre-trial and in-flight runs fall back to the
  // case count.
  if (row.result_count >= (row.expected_result_rows ?? row.total_tests)) {
    return true;
  }
  const lastProgressAt = row.last_result_at ?? row.started_at;
  if (!lastProgressAt) return false;
  return now.getTime() - new Date(lastProgressAt).getTime() >= staleAfterMs;
}

export function missingEvalTestCaseIds(
  expectedTestCaseIds: string[],
  existingResultTestCaseIds: Array<string | null>,
): string[] {
  const existing = new Set(
    existingResultTestCaseIds.filter((id): id is string => Boolean(id)),
  );
  return expectedTestCaseIds.filter((id) => !existing.has(id));
}

/**
 * Summarize result rows under the run's stamped scoring semantics.
 * Legacy runs (null `scoringVersion`, created pre-migration) keep the
 * historical errors-count-as-failed math — the reconciler must never
 * silently upgrade them to the new denominator.
 */
/**
 * Synthetic result row for a case that never produced one. Carries
 * `error_cause: 'reconciler'` so these never read as behavioral
 * failures and stay diagnosable in run health.
 */
export function buildReconcilerErrorRow(
  runId: string,
  testCase: {
    /**
     * eval_test_cases row uuid; null only for a pinned case whose index
     * row was hard-deleted mid-run (legacy deleteEvalTestCase) — the
     * synthetic row still terminates the run, just without the FK.
     */
    id: string | null;
    query: string;
    assertions: unknown;
    /** dataset_case_id, when the case came from a pinned run scope. */
    pinnedCaseId?: string | null;
    /** Which trial the synthetic row terminates (0-based); default 0. */
    trialIndex?: number;
  },
  staleMessage: string,
) {
  const trialIndex = testCase.trialIndex ?? 0;
  return {
    run_id: runId,
    test_case_id: testCase.id,
    status: "error",
    error_cause: "reconciler",
    trial_index: trialIndex,
    score: null,
    duration_ms: 0,
    agent_session_id: `reconciler:${runId}:${testCase.id ?? testCase.pinnedCaseId ?? "unknown"}${trialIndex > 0 ? `:trial-${trialIndex}` : ""}`,
    input: testCase.query,
    expected: null,
    actual_output: "",
    evaluator_results: [
      {
        evaluator_id: RECONCILER_EVALUATOR_ID,
        source: "in_house",
        value: null,
        label: "missing_result",
        explanation: staleMessage,
        skipped: true,
        error: staleMessage,
      },
    ],
    assertions: testCase.assertions ?? [],
    error_message: staleMessage,
  };
}

export function summarizeEvalRowsForReconciler(
  rows: Array<{
    status: string;
    override_status?: string | null;
    evaluator_results: unknown;
    agent_cost_usd?: string | null;
  }>,
  scoringVersion: number | null,
): EvalResultSummary {
  const { passed, failed, errored, passRate } = summarizeEvalStatuses(
    rows,
    scoringVersion,
  );
  return {
    passed,
    failed,
    errored,
    // Row-level (pre-trial) summary shape — the trial-aware paths below
    // compute unstable through the shared aggregation layer instead.
    unstable: null,
    passRate,
    totalCostUsd: rows.reduce((total, row) => total + rowCostUsd(row), 0),
    costPartial: rows.some((row) => row.agent_cost_usd == null),
  };
}

type SummaryResultRow = {
  testCaseId: string | null;
  trialIndex?: number | null;
  status: string;
  override_status?: string | null;
  evaluator_results: unknown;
  /** Priced agent-turn cost (U5); null/absent rows make the run cost partial. */
  agent_cost_usd?: string | null;
};

/**
 * A row's contribution to the run total (U5): evaluator cost + the
 * priced agent-turn cost. Rows without a priced agent cost contribute
 * only evaluator cost — the caller marks the total partial (R6).
 */
function rowCostUsd(row: {
  evaluator_results: unknown;
  agent_cost_usd?: string | null;
}): number {
  return (
    evaluatorCostUsd(row.evaluator_results) +
    (row.agent_cost_usd ? Number(row.agent_cost_usd) : 0)
  );
}

/**
 * Trial-aware summary for the reconciler's write paths (Eval Profiles
 * U4): routes through the SAME evals-core aggregation layer the worker's
 * finalization and the override recompute consume, so run counters are
 * CASE verdicts everywhere. Legacy runs (null scoringVersion) keep the
 * historical row math inside the shared helper.
 */
function summarizeRunRowsForWrite(
  rows: SummaryResultRow[],
  caseOverrides: EvalRunCaseOverrideRow[],
  scoringVersion: number | null,
): EvalResultSummary {
  const verdictSummary = summarizeEvalRunVerdicts(
    rows.map((row) => ({
      test_case_id: row.testCaseId,
      trial_index: row.trialIndex ?? 0,
      status: row.status,
      override_status: row.override_status,
    })),
    caseOverrides,
    scoringVersion,
  );
  return {
    passed: verdictSummary.passed,
    failed: verdictSummary.failed,
    errored: verdictSummary.errored,
    unstable: verdictSummary.unstable,
    passRate: verdictSummary.passRate,
    totalCostUsd: rows.reduce((total, row) => total + rowCostUsd(row), 0),
    costPartial: rows.some((row) => row.agent_cost_usd == null),
  };
}

/** Case-level overrides for a run (KTD9); versioned runs only. */
async function loadCaseOverridesForRun(
  executor: Pick<ReturnType<typeof getDb>, "select">,
  runId: string,
  scoringVersion: number | null,
): Promise<EvalRunCaseOverrideRow[]> {
  if (scoringVersion === null) return [];
  return executor
    .select({
      test_case_id: evalCaseOverrides.test_case_id,
      override_status: evalCaseOverrides.override_status,
    })
    .from(evalCaseOverrides)
    .where(eq(evalCaseOverrides.run_id, runId));
}

export async function handler(
  _event: ScheduledEvent,
): Promise<{ reconciled: number; skipped: number }> {
  const db = getDb();
  const now = new Date();
  const candidates = await selectReconciliationCandidates();
  const reconciled: ReconciledRun[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (!shouldReconcileEvalRun(candidate, now, STALE_AFTER_MINUTES * 60_000)) {
      skipped++;
      continue;
    }

    const result = await reconcileRun(candidate);
    if (result) reconciled.push(result);
    else skipped++;
  }

  for (const result of reconciled) {
    await notifyEvalRunUpdate({
      runId: result.runId,
      tenantId: result.tenantId,
      agentId: result.agentId,
      status: "completed",
      totalTests: result.totalTests,
      passed: result.summary.passed,
      failed: result.summary.failed,
      passRate: result.summary.passRate ?? undefined,
    });
  }

  const resummarized = await resummarizeDivergentRuns();

  console.log(
    JSON.stringify({
      msg: "eval-runs-reconciler.complete",
      candidates: candidates.length,
      reconciled: reconciled.length,
      resummarized,
      skipped,
    }),
  );

  return { reconciled: reconciled.length, skipped };
}

/**
 * Deploy-window guard: a run stamped with the current scoring version
 * can be finalized by an old warm worker that computed the summary under
 * legacy semantics (and left `summary_scoring_version` null/stale).
 * Recompute those summaries under the stamped semantics. Runs stamped
 * with a version this code does not know are left for newer code; legacy
 * runs (null stamp) are never touched.
 */
export async function resummarizeDivergentRuns(): Promise<number> {
  const db = getDb();
  const divergent = await db
    .select({
      id: evalRuns.id,
      tenant_id: evalRuns.tenant_id,
      agent_id: evalRuns.agent_id,
      total_tests: evalRuns.total_tests,
      scoring_version: evalRuns.scoring_version,
    })
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.status, "completed"),
        // v2 and v3 share the errors-out-of-denominator rule (KTD4), so
        // this code can honestly recompute either; runs stamped with a
        // version NEWER than this code knows are left for newer code.
        gte(evalRuns.scoring_version, 2),
        lte(evalRuns.scoring_version, CURRENT_EVAL_SCORING_VERSION),
        sql`${evalRuns.summary_scoring_version} IS DISTINCT FROM ${evalRuns.scoring_version}`,
      ),
    )
    .limit(BATCH_SIZE);

  let resummarized = 0;
  for (const run of divergent) {
    const rows = await db
      .select({
        testCaseId: evalResults.test_case_id,
        trialIndex: evalResults.trial_index,
        status: evalResults.status,
        override_status: evalResults.override_status,
        evaluator_results: evalResults.evaluator_results,
      })
      .from(evalResults)
      .where(eq(evalResults.run_id, run.id));
    const caseOverrides = await loadCaseOverridesForRun(
      db,
      run.id,
      run.scoring_version,
    );
    const summary = summarizeRunRowsForWrite(
      rows,
      caseOverrides,
      run.scoring_version,
    );
    const updated = await db
      .update(evalRuns)
      .set({
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        unstable: summary.unstable,
        pass_rate:
          summary.passRate === null ? null : summary.passRate.toFixed(4),
        // Record the run's OWN stamped semantics (≤ this code's version
        // by the filter above) so the recompute converges instead of
        // staying divergent forever.
        summary_scoring_version: summaryScoringVersionFor(
          run.scoring_version,
          CURRENT_EVAL_SCORING_VERSION,
        ),
      })
      .where(and(eq(evalRuns.id, run.id), eq(evalRuns.status, "completed")))
      .returning({ id: evalRuns.id });
    if (updated.length === 0) continue;
    resummarized++;

    await notifyEvalRunUpdate({
      runId: run.id,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "completed",
      totalTests: run.total_tests,
      passed: summary.passed,
      failed: summary.failed,
      passRate: summary.passRate ?? undefined,
    });
    console.log(
      `[eval-runs-reconciler] resummarized runId=${run.id} under scoring_version=${run.scoring_version}`,
    );
  }
  return resummarized;
}

async function selectReconciliationCandidates(): Promise<EvalRunCandidate[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      run.id,
      run.tenant_id,
      run.agent_id,
      run.status,
      run.categories,
      run.selected_test_case_ids,
      run.dataset_id,
      run.pinned_case_ids,
      run.pinned_trial_plan,
      run.total_tests,
      run.expected_result_rows,
      run.scoring_version,
      run.started_at,
      MAX(result.created_at) AS last_result_at,
      COUNT(result.id)::int AS result_count
    FROM eval_runs run
    LEFT JOIN eval_results result ON result.run_id = run.id
    WHERE run.status = 'running'
      AND run.total_tests > 0
      AND run.started_at < NOW() - (${STALE_AFTER_MINUTES} || ' minutes')::interval
    GROUP BY run.id
    ORDER BY run.started_at ASC
    LIMIT ${BATCH_SIZE}
  `);
  return ((result as unknown as { rows?: unknown[] }).rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      tenant_id: String(record.tenant_id),
      agent_id: typeof record.agent_id === "string" ? record.agent_id : null,
      status: String(record.status),
      categories: Array.isArray(record.categories)
        ? record.categories.map(String)
        : [],
      selected_test_case_ids: Array.isArray(record.selected_test_case_ids)
        ? record.selected_test_case_ids.map(String)
        : [],
      dataset_id:
        typeof record.dataset_id === "string" ? record.dataset_id : null,
      pinned_case_ids: Array.isArray(record.pinned_case_ids)
        ? record.pinned_case_ids.map(String)
        : null,
      pinned_trial_plan: parsePinnedTrialPlan(record.pinned_trial_plan),
      total_tests: Number(record.total_tests) || 0,
      expected_result_rows:
        record.expected_result_rows === null ||
        record.expected_result_rows === undefined
          ? null
          : Number(record.expected_result_rows),
      scoring_version:
        record.scoring_version === null || record.scoring_version === undefined
          ? null
          : Number(record.scoring_version),
      started_at:
        record.started_at instanceof Date
          ? record.started_at
          : record.started_at
            ? new Date(String(record.started_at))
            : null,
      last_result_at:
        record.last_result_at instanceof Date
          ? record.last_result_at
          : record.last_result_at
            ? new Date(String(record.last_result_at))
            : null,
      result_count: Number(record.result_count) || 0,
    };
  });
}

type ExpectedReconcileCase = {
  id: string | null;
  query: string;
  assertions: unknown;
  pinnedCaseId?: string | null;
  /** Expected trial index (0-based); 0 on pre-trial reconstructions. */
  trialIndex: number;
};

/**
 * Parse a run row's pinned_trial_plan jsonb ([{ caseId, trials }],
 * caseId = eval_test_cases uuid). Null when absent/malformed — the
 * reconstruction then falls back to the pre-trial per-case paths.
 */
export function parsePinnedTrialPlan(
  value: unknown,
): EvalTrialPlanEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: EvalTrialPlanEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { caseId, trials } = raw as { caseId?: unknown; trials?: unknown };
    if (typeof caseId !== "string" || caseId.length === 0) return null;
    if (typeof trials !== "number" || !Number.isFinite(trials) || trials < 1) {
      return null;
    }
    entries.push({ caseId, trials: Math.floor(trials) });
  }
  return entries;
}

/**
 * Trial-plan reconstruction (Eval Profiles U4): the immutable pinned
 * plan IS the expected result-row set — for each { caseId, trials }
 * entry, trial indexes 0..trials-1. Case content (query/assertions for
 * the synthetic rows) resolves from the index rows by uuid with NO
 * enabled filter; a plan uuid whose row was hard-deleted still
 * synthesizes terminating rows (null FK), mirroring the pinned-case
 * path. Never re-derived from live assertions.
 */
async function expectedCasesFromTrialPlan(
  candidate: EvalRunCandidate,
  plan: EvalTrialPlanEntry[],
): Promise<ExpectedReconcileCase[]> {
  const db = getDb();
  const caseIds = plan.map((entry) => entry.caseId);
  const rows =
    caseIds.length > 0
      ? await db
          .select({
            id: evalTestCases.id,
            query: evalTestCases.query,
            assertions: evalTestCases.assertions,
          })
          .from(evalTestCases)
          .where(
            and(
              eq(evalTestCases.tenant_id, candidate.tenant_id),
              inArray(evalTestCases.id, caseIds),
            ),
          )
      : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const expected: ExpectedReconcileCase[] = [];
  for (const entry of plan) {
    const row = byId.get(entry.caseId);
    if (!row) {
      console.warn(
        `[eval-runs-reconciler] runId=${candidate.id}: trial-plan case ${entry.caseId} has no index row; synthesizing without FK`,
      );
    }
    for (let trialIndex = 0; trialIndex < entry.trials; trialIndex++) {
      expected.push(
        row
          ? {
              id: row.id,
              query: row.query,
              assertions: row.assertions,
              trialIndex,
            }
          : {
              id: null,
              query: "",
              assertions: [],
              pinnedCaseId: entry.caseId,
              trialIndex,
            },
      );
    }
  }
  return expected;
}

/**
 * Reconstruct the run's expected case set.
 *
 * Trial-plan runs (Eval Profiles U4): reconstructed from the immutable
 * pinned_trial_plan — one expected row per (case, trial).
 *
 * Pinned runs (Trust Core U6): the launch-time pinned_case_ids list is
 * the truth — joined to the dataset's index rows by
 * (dataset_id, dataset_case_id) with NO enabled filter, so a case
 * tombstoned mid-run still resolves and can never wedge the run via a
 * count mismatch. A pinned id whose index row was hard-deleted (legacy
 * deleteEvalTestCase) still synthesizes a terminating row (null FK).
 *
 * Legacy runs: reconstructed from selected_test_case_ids / categories
 * against enabled=true rows, with the historical count-mismatch skip.
 */
async function expectedCasesForCandidate(
  candidate: EvalRunCandidate,
): Promise<ExpectedReconcileCase[] | null> {
  const db = getDb();

  if (candidate.pinned_trial_plan !== null) {
    return expectedCasesFromTrialPlan(candidate, candidate.pinned_trial_plan);
  }

  if (candidate.pinned_case_ids !== null && candidate.dataset_id) {
    const rows = await db
      .select({
        id: evalTestCases.id,
        query: evalTestCases.query,
        assertions: evalTestCases.assertions,
        dataset_case_id: evalTestCases.dataset_case_id,
      })
      .from(evalTestCases)
      .where(
        and(
          eq(evalTestCases.tenant_id, candidate.tenant_id),
          eq(evalTestCases.dataset_id, candidate.dataset_id),
          candidate.pinned_case_ids.length > 0
            ? inArray(evalTestCases.dataset_case_id, candidate.pinned_case_ids)
            : sql`false`,
        ),
      );
    const byCaseId = new Map(
      rows
        .filter((r): r is typeof r & { dataset_case_id: string } =>
          Boolean(r.dataset_case_id),
        )
        .map((r) => [r.dataset_case_id, r]),
    );
    return candidate.pinned_case_ids.map((caseId) => {
      const row = byCaseId.get(caseId);
      if (!row) {
        console.warn(
          `[eval-runs-reconciler] runId=${candidate.id}: pinned case ${caseId} has no index row; synthesizing without FK`,
        );
        return {
          id: null,
          query: "",
          assertions: [],
          pinnedCaseId: caseId,
          trialIndex: 0,
        };
      }
      return {
        id: row.id,
        query: row.query,
        assertions: row.assertions,
        pinnedCaseId: caseId,
        trialIndex: 0,
      };
    });
  }

  if (
    candidate.categories.length === 0 &&
    candidate.selected_test_case_ids.length === 0
  ) {
    console.warn(
      `[eval-runs-reconciler] skip runId=${candidate.id}: cannot reconstruct selected test cases without categories`,
    );
    return null;
  }

  const testCases = await db
    .select({
      id: evalTestCases.id,
      query: evalTestCases.query,
      assertions: evalTestCases.assertions,
    })
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.tenant_id, candidate.tenant_id),
        eq(evalTestCases.enabled, true),
        // Mirrors the runner's legacy-path curation filter (U7) so the
        // reconstruction matches what dispatch actually fanned out.
        eq(evalTestCases.quality_state, "active"),
        candidate.selected_test_case_ids.length > 0
          ? inArray(evalTestCases.id, candidate.selected_test_case_ids)
          : inArray(evalTestCases.category, candidate.categories),
      ),
    )
    .orderBy(asc(evalTestCases.category), asc(evalTestCases.name));

  if (testCases.length !== candidate.total_tests) {
    console.warn(
      `[eval-runs-reconciler] skip runId=${candidate.id}: expected ${candidate.total_tests} cases but reconstructed ${testCases.length}`,
    );
    return null;
  }
  return testCases.map((testCase) => ({ ...testCase, trialIndex: 0 }));
}

async function reconcileRun(
  candidate: EvalRunCandidate,
): Promise<ReconciledRun | null> {
  const db = getDb();
  const testCases = await expectedCasesForCandidate(candidate);
  if (testCases === null) return null;

  const staleMessage = `Reconciler recorded missing eval result after ${STALE_AFTER_MINUTES} minutes without run progress`;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext('eval-run-reconcile'),
        hashtext(${candidate.id})
      )
    `);

    const [freshRun] = await tx
      .select({
        status: evalRuns.status,
        total_tests: evalRuns.total_tests,
        expected_result_rows: evalRuns.expected_result_rows,
      })
      .from(evalRuns)
      .where(eq(evalRuns.id, candidate.id));
    if (!freshRun || freshRun.status !== "running") return null;

    const existingRows = await tx
      .select({
        testCaseId: evalResults.test_case_id,
        trialIndex: evalResults.trial_index,
      })
      .from(evalResults)
      .where(eq(evalResults.run_id, candidate.id));
    // Result-row identity is (case, trial) — Eval Profiles U4; pre-trial
    // rows carry trial_index 0 via the column default.
    const existingKeys = new Set(
      existingRows
        .filter((row): row is typeof row & { testCaseId: string } =>
          Boolean(row.testCaseId),
        )
        .map((row) => `${row.testCaseId}:${row.trialIndex ?? 0}`),
    );

    // A null-id expected case (pinned id whose index row vanished) can
    // never have a worker-written result row — workers FK the row uuid —
    // so it is always missing.
    const missingCases = testCases.filter(
      (testCase) =>
        testCase.id === null ||
        !existingKeys.has(`${testCase.id}:${testCase.trialIndex}`),
    );
    if (missingCases.length > 0) {
      await tx
        .insert(evalResults)
        .values(
          missingCases.map((testCase) =>
            buildReconcilerErrorRow(candidate.id, testCase, staleMessage),
          ),
        );
    }

    const rows = await tx
      .select({
        testCaseId: evalResults.test_case_id,
        trialIndex: evalResults.trial_index,
        status: evalResults.status,
        override_status: evalResults.override_status,
        evaluator_results: evalResults.evaluator_results,
        agent_cost_usd: evalResults.agent_cost_usd,
      })
      .from(evalResults)
      .where(eq(evalResults.run_id, candidate.id));
    // Completion compares against the pinned fan-out count when present.
    if (rows.length < (freshRun.expected_result_rows ?? freshRun.total_tests)) {
      return null;
    }

    const caseOverrides = await loadCaseOverridesForRun(
      tx,
      candidate.id,
      candidate.scoring_version,
    );
    const summary = summarizeRunRowsForWrite(
      rows,
      caseOverrides,
      candidate.scoring_version,
    );
    const completedAt = new Date();
    const updated = await tx
      .update(evalRuns)
      .set({
        status: "completed",
        completed_at: completedAt,
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        unstable: summary.unstable,
        pass_rate:
          summary.passRate === null ? null : summary.passRate.toFixed(4),
        // Preserve the run's stamped semantics: legacy runs stay
        // unversioned; stamped runs record their own version (capped at
        // the version this code knows — deploy-window guard).
        summary_scoring_version: summaryScoringVersionFor(
          candidate.scoring_version,
          CURRENT_EVAL_SCORING_VERSION,
        ),
        cost_usd: summary.totalCostUsd.toFixed(6),
        // Reconciler-synthesized rows never carry priced agent cost, so
        // a reconciled run is cost-partial by construction (R6).
        cost_partial: summary.costPartial,
        error_message:
          missingCases.length > 0
            ? `Reconciled ${missingCases.length} missing eval result(s)`
            : null,
      })
      .where(and(eq(evalRuns.id, candidate.id), eq(evalRuns.status, "running")))
      .returning({ id: evalRuns.id });
    if (updated.length === 0) return null;

    if (summary.totalCostUsd > 0 && candidate.agent_id) {
      await tx
        .insert(costEvents)
        .values({
          tenant_id: candidate.tenant_id,
          agent_id: candidate.agent_id,
          request_id: `eval-run-${candidate.id}`,
          event_type: "eval_compute",
          amount_usd: summary.totalCostUsd.toFixed(6),
          metadata: {
            source: "eval-runs-reconciler",
            run_id: candidate.id,
            total_tests: freshRun.total_tests,
          },
        })
        .onConflictDoNothing();
    }

    return {
      insertedErrors: missingCases.length,
      summary,
      totalTests: freshRun.total_tests,
    };
  });

  if (!result) return null;
  console.log(
    `[eval-runs-reconciler] finalized runId=${candidate.id} inserted_errors=${result.insertedErrors} passed=${result.summary.passed}/${result.totalTests}`,
  );
  return {
    runId: candidate.id,
    tenantId: candidate.tenant_id,
    agentId: candidate.agent_id,
    ...result,
  };
}

function evaluatorCostUsd(evaluatorResults: unknown): number {
  if (!Array.isArray(evaluatorResults)) return 0;
  return evaluatorResults.reduce((total, result) => {
    const tokenUsage = (result as { token_usage?: unknown }).token_usage;
    if (!isRecord(tokenUsage)) return total;
    const inputTokens = numberFrom(tokenUsage.inputTokens);
    const outputTokens = numberFrom(tokenUsage.outputTokens);
    if (inputTokens > 0 || outputTokens > 0) {
      return (
        total + (inputTokens / 1000) * 0.0024 + (outputTokens / 1000) * 0.012
      );
    }
    return total + (numberFrom(tokenUsage.totalTokens) / 1000) * 0.012;
  }, 0);
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
