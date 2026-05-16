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
  total_tests: number;
  started_at: Date | null;
  last_result_at: Date | null;
  result_count: number;
};

type EvalResultSummary = {
  passed: number;
  failed: number;
  passRate: number;
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

export function summarizeEvalRowsForReconciler(
  rows: Array<{ status: string; evaluator_results: unknown }>,
): EvalResultSummary {
  const passed = rows.filter((row) => row.status === "pass").length;
  const failed = rows.length - passed;
  return {
    passed,
    failed,
    passRate: rows.length > 0 ? passed / rows.length : 0,
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
      passRate: result.summary.passRate,
    });
  }

  console.log(
    JSON.stringify({
      msg: "eval-runs-reconciler.complete",
      candidates: candidates.length,
      reconciled: reconciled.length,
      skipped,
    }),
  );

  return { reconciled: reconciled.length, skipped };
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
      run.total_tests,
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
      total_tests: Number(record.total_tests) || 0,
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

async function reconcileRun(
  candidate: EvalRunCandidate,
): Promise<ReconciledRun | null> {
  if (candidate.categories.length === 0) {
    console.warn(
      `[eval-runs-reconciler] skip runId=${candidate.id}: cannot reconstruct selected test cases without categories`,
    );
    return null;
  }

  const db = getDb();
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
        inArray(evalTestCases.category, candidate.categories),
      ),
    )
    .orderBy(asc(evalTestCases.category), asc(evalTestCases.name));

  if (testCases.length !== candidate.total_tests) {
    console.warn(
      `[eval-runs-reconciler] skip runId=${candidate.id}: expected ${candidate.total_tests} cases but reconstructed ${testCases.length}`,
    );
    return null;
  }

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
    const missingIds = new Set(
      missingEvalTestCaseIds(
        testCases.map((testCase) => testCase.id),
        existingRows.map((row) => row.testCaseId),
      ),
    );

    const missingCases = testCases.filter((testCase) =>
      missingIds.has(testCase.id),
    );
    if (missingCases.length > 0) {
      await tx.insert(evalResults).values(
        missingCases.map((testCase) => ({
          run_id: candidate.id,
          test_case_id: testCase.id,
          status: "error",
          score: null,
          duration_ms: 0,
          agent_session_id: `reconciler:${candidate.id}:${testCase.id}`,
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
        })),
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

    const summary = summarizeEvalRowsForReconciler(rows);
    const completedAt = new Date();
    const updated = await tx
      .update(evalRuns)
      .set({
        status: "completed",
        completed_at: completedAt,
        passed: summary.passed,
        failed: summary.failed,
        pass_rate: summary.passRate.toFixed(4),
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
