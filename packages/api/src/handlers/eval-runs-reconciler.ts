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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  evalResults,
  evalRuns,
  evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
  CURRENT_EVAL_SCORING_VERSION,
  summarizeEvalStatuses,
} from "@thinkwork/evals-core";
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
  total_tests: number;
  scoring_version: number | null;
  started_at: Date | null;
  last_result_at: Date | null;
  result_count: number;
};

type EvalResultSummary = {
  passed: number;
  failed: number;
  errored: number | null;
  passRate: number | null;
  totalCostUsd: number;
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
  >,
  now: Date,
  staleAfterMs = STALE_AFTER_MINUTES * 60_000,
): boolean {
  if (row.status !== "running") return false;
  if (row.total_tests <= 0) return false;
  if (row.result_count >= row.total_tests) return true;
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
  },
  staleMessage: string,
) {
  return {
    run_id: runId,
    test_case_id: testCase.id,
    status: "error",
    error_cause: "reconciler",
    score: null,
    duration_ms: 0,
    agent_session_id: `reconciler:${runId}:${testCase.id ?? testCase.pinnedCaseId ?? "unknown"}`,
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
  rows: Array<{ status: string; evaluator_results: unknown }>,
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
    passRate,
    totalCostUsd: rows.reduce(
      (total, row) => total + evaluatorCostUsd(row.evaluator_results),
      0,
    ),
  };
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
        eq(evalRuns.scoring_version, CURRENT_EVAL_SCORING_VERSION),
        sql`${evalRuns.summary_scoring_version} IS DISTINCT FROM ${evalRuns.scoring_version}`,
      ),
    )
    .limit(BATCH_SIZE);

  let resummarized = 0;
  for (const run of divergent) {
    const rows = await db
      .select({
        status: evalResults.status,
        evaluator_results: evalResults.evaluator_results,
      })
      .from(evalResults)
      .where(eq(evalResults.run_id, run.id));
    const summary = summarizeEvalRowsForReconciler(rows, run.scoring_version);
    const updated = await db
      .update(evalRuns)
      .set({
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        pass_rate:
          summary.passRate === null ? null : summary.passRate.toFixed(4),
        summary_scoring_version: CURRENT_EVAL_SCORING_VERSION,
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
      `[eval-runs-reconciler] resummarized runId=${run.id} under scoring_version=${CURRENT_EVAL_SCORING_VERSION}`,
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
      run.total_tests,
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
      total_tests: Number(record.total_tests) || 0,
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
};

/**
 * Reconstruct the run's expected case set.
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
        return { id: null, query: "", assertions: [], pinnedCaseId: caseId };
      }
      return {
        id: row.id,
        query: row.query,
        assertions: row.assertions,
        pinnedCaseId: caseId,
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
  return testCases;
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
      })
      .from(evalRuns)
      .where(eq(evalRuns.id, candidate.id));
    if (!freshRun || freshRun.status !== "running") return null;

    const existingRows = await tx
      .select({ testCaseId: evalResults.test_case_id })
      .from(evalResults)
      .where(eq(evalResults.run_id, candidate.id));
    const existingIds = new Set(
      existingRows
        .map((row) => row.testCaseId)
        .filter((id): id is string => Boolean(id)),
    );

    // A null-id expected case (pinned id whose index row vanished) can
    // never have a worker-written result row — workers FK the row uuid —
    // so it is always missing.
    const missingCases = testCases.filter(
      (testCase) => testCase.id === null || !existingIds.has(testCase.id),
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
        status: evalResults.status,
        evaluator_results: evalResults.evaluator_results,
      })
      .from(evalResults)
      .where(eq(evalResults.run_id, candidate.id));
    if (rows.length < freshRun.total_tests) return null;

    const summary = summarizeEvalRowsForReconciler(
      rows,
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
        pass_rate:
          summary.passRate === null ? null : summary.passRate.toFixed(4),
        // Preserve the run's stamped semantics: legacy runs stay
        // unversioned, stamped runs record the version this code
        // computed under.
        summary_scoring_version:
          candidate.scoring_version === null
            ? null
            : CURRENT_EVAL_SCORING_VERSION,
        cost_usd: summary.totalCostUsd.toFixed(6),
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
