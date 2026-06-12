/**
 * eval-worker Lambda
 *
 * SQS delivers one eval test case per invocation. Application-level case
 * failures are recorded as eval_results.status='error' and acknowledged; only
 * infrastructure failures return batch item failures so SQS can redrive to the
 * eval fan-out DLQ.
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  evalResults,
  evalRuns,
  evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
  CURRENT_EVAL_SCORING_VERSION,
  evaluateAssertions,
  llmRubricHeuristic,
  scoreEvalOutcome,
  summarizeEvalStatuses,
  type EvalAssertion,
  type EvalAssertionResult,
  type EvalErrorCause,
  type EvalEvaluatorResult,
  type EvalJudgeResult,
} from "@thinkwork/evals-core";
import { createHash } from "crypto";
import {
  AgentCoreEvalInvocationTimeoutError,
  invokeAgentCoreForEval,
} from "../lib/evals/agentcore-direct.js";
import {
  evaluateWorkspaceProjectionAssertions,
  partitionEvalAssertions,
} from "../lib/evals/workspace-projection-assertions.js";
import { resolveTenantPlatformAgent } from "../lib/agents/tenant-platform-agent.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const BUILT_IN_EVALUATOR_INPUT_USD_PER_1K = 0.0024;
const BUILT_IN_EVALUATOR_OUTPUT_USD_PER_1K = 0.012;
export interface EvalWorkerMessage {
  runId: string;
  testCaseId: string;
  index?: number;
}

interface CaseOutcome {
  status: "pass" | "fail" | "error";
  errorCause: EvalErrorCause | null;
  score: number | null;
  assertionResults: EvalAssertionResult[];
  evaluatorResults: EvalEvaluatorResult[];
  actualOutput: string;
  systemPrompt: string | null;
  durationMs: number;
  errorMessage: string | null;
  costUsd: number;
  sessionId: string;
  /**
   * Thread turn this execution corresponds to — set when the case's
   * workspace-projection assertions successfully read a stored turn
   * snapshot (plan 2026-06-12-002 U10). Null otherwise.
   */
  threadTurnId: string | null;
}

export function parseEvalWorkerMessage(body: string): EvalWorkerMessage {
  const parsed = JSON.parse(body) as Partial<EvalWorkerMessage>;
  if (!parsed.runId || !parsed.testCaseId) {
    throw new Error("eval-worker message must include runId and testCaseId");
  }
  return {
    runId: parsed.runId,
    testCaseId: parsed.testCaseId,
    index: typeof parsed.index === "number" ? parsed.index : undefined,
  };
}

/**
 * Summarize a run's result rows under the run's stamped scoring
 * semantics (`scoringVersion` null = legacy ~v1: errors fold into
 * `failed`; v2+: `failed` counts only status='fail', errors land in
 * `errored`, and pass_rate = passed / (passed + failed) — null when
 * nothing scoreable, never 0%).
 */
export function summarizeEvalResults(
  rows: Array<{ status: string; evaluator_results: unknown }>,
  scoringVersion: number | null,
): {
  completed: number;
  passed: number;
  failed: number;
  errored: number | null;
  passRate: number | null;
  totalCostUsd: number;
} {
  const counts = summarizeEvalStatuses(rows, scoringVersion);
  const totalCostUsd = rows.reduce(
    (total, row) => total + evaluatorCostUsd(row.evaluator_results),
    0,
  );
  return { ...counts, totalCostUsd };
}

export function estimateAgentCoreEvaluatorCostUsd(
  tokenUsage: EvalEvaluatorResult["token_usage"] | undefined,
): number {
  if (!tokenUsage) return 0;
  const inputTokens = tokenUsage.inputTokens ?? 0;
  const outputTokens = tokenUsage.outputTokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    return (
      (inputTokens / 1000) * BUILT_IN_EVALUATOR_INPUT_USD_PER_1K +
      (outputTokens / 1000) * BUILT_IN_EVALUATOR_OUTPUT_USD_PER_1K
    );
  }

  return (
    ((tokenUsage.totalTokens ?? 0) / 1000) *
    BUILT_IN_EVALUATOR_OUTPUT_USD_PER_1K
  );
}

export function agentCoreEvaluatorsEnabled(
  value = process.env.EVAL_AGENTCORE_EVALUATORS,
): boolean {
  return ["1", "true", "enabled", "always", "full"].includes(
    (value ?? "disabled").toLowerCase(),
  );
}

export function isRetryableEvalInfrastructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Lambda\.TooManyRequestsException|Lambda throttled/i.test(message);
}

export function agentCoreBudgetExceededAssertion(
  timeoutMs: number,
): EvalAssertionResult {
  return {
    type: "agentcore-response-budget",
    passed: false,
    score: 0,
    reason: `AgentCore did not return a response within the ${timeoutMs}ms eval response budget.`,
  };
}

function evaluatorCostUsd(evaluatorResults: unknown): number {
  if (!Array.isArray(evaluatorResults)) return 0;
  return evaluatorResults.reduce((total, result) => {
    const tokenUsage = (result as EvalEvaluatorResult).token_usage;
    return total + estimateAgentCoreEvaluatorCostUsd(tokenUsage);
  }, 0);
}

function uniqueSessionId(
  runId: string,
  testCaseId: string | null,
  index: number,
): string {
  return createHash("sha256")
    .update(`evalrun:${runId}:${testCaseId ?? "ad-hoc"}:${index}:${Date.now()}`)
    .digest("hex")
    .slice(0, 64);
}

const JUDGE_MODEL_ID =
  process.env.EVAL_JUDGE_MODEL_ID ??
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export function llmJudgeEnabled(value = process.env.EVAL_LLM_JUDGE): boolean {
  return ["1", "true", "enabled", "always", "llm"].includes(
    (value ?? "heuristic").toLowerCase(),
  );
}

async function llmJudge(
  query: string,
  output: string,
  rubric: string,
): Promise<EvalJudgeResult> {
  try {
    const { BedrockRuntimeClient, ConverseCommand } =
      await import("@aws-sdk/client-bedrock-runtime");
    const client = new BedrockRuntimeClient({ region: REGION });
    const judgePrompt = `You are an evaluation judge for an AI agent. Evaluate whether the agent's response meets the given criteria.

User Query: ${query}

Agent Response: ${output}

Evaluation Criteria: ${rubric}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{"passed": true/false, "reasoning": "brief explanation", "score": 0.0 to 1.0}`;

    const resp = await client.send(
      new ConverseCommand({
        modelId: JUDGE_MODEL_ID,
        messages: [{ role: "user", content: [{ text: judgePrompt }] }],
        inferenceConfig: { maxTokens: 256, temperature: 0 },
      }),
    );
    const text = resp.output?.message?.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        passed: Boolean(result.passed),
        reason: `LLM judge: ${result.reasoning || rubric.slice(0, 100)}`,
        score:
          typeof result.score === "number"
            ? result.score
            : result.passed
              ? 1.0
              : 0.0,
      };
    }
    throw new Error("No JSON in judge response");
  } catch (err) {
    console.warn(
      "[eval-worker] LLM judge failed, falling back to heuristic:",
      err,
    );
    return llmRubricHeuristic(output, rubric);
  }
}

function skippedBuiltInEvaluator(evaluatorId: string): EvalEvaluatorResult {
  return {
    evaluator_id: evaluatorId,
    source: "agentcore",
    value: null,
    label: "skipped",
    explanation:
      "Skipped by eval-worker economy mode. Computer-task eval execution currently uses in-house scoring only.",
    skipped: true,
  };
}

async function builtInEvaluatorResults(
  evaluatorIds: string[],
): Promise<EvalEvaluatorResult[]> {
  return evaluatorIds.map(skippedBuiltInEvaluator);
}

async function executeCase(
  run: typeof evalRuns.$inferSelect,
  tc: typeof evalTestCases.$inferSelect,
  message: EvalWorkerMessage,
): Promise<CaseOutcome> {
  const sessionId = uniqueSessionId(run.id, tc.id, message.index ?? 0);
  let actualOutput = "";
  let systemPrompt: string | null = null;
  let durationMs = 0;
  let errorMessage: string | null = null;
  const assertionResults: EvalAssertionResult[] = [];
  const evaluatorResults: EvalEvaluatorResult[] = [];
  let costUsd = 0;
  let threadTurnId: string | null = null;

  try {
    // Belt-and-suspenders: in normal operation the dispatcher (eval-runner
    // or job-trigger) sets run.agent_id before fan-out. During a deploy
    // race or an SQS replay, a worker may receive a case for a run whose
    // agent_id is still null — fall back to the tenant platform agent
    // rather than failing the case outright.
    let targetAgentId = run.agent_id;
    if (!targetAgentId) {
      targetAgentId = (await resolveTenantPlatformAgent(run.tenant_id)).id;
    }

    const inv = await invokeAgentCoreForEval({
      tenantId: run.tenant_id,
      agentId: targetAgentId,
      sessionId,
      message: tc.query,
      model: run.model,
      systemPrompt: tc.system_prompt,
    });
    actualOutput = inv.output;
    durationMs = inv.durationMs;
    systemPrompt = inv.composedSystemPrompt;

    const assertions = (tc.assertions ?? []) as EvalAssertion[];
    // `workspace-projection-*` assertions read STORED turn snapshots (never
    // a re-render); everything else evaluates against the agent output as
    // before. Plan 2026-06-12-002 U10.
    const { outputAssertions, projectionAssertions } =
      partitionEvalAssertions(assertions);
    assertionResults.push(
      ...(await evaluateAssertions(outputAssertions, actualOutput, tc.query, {
        judge: llmJudgeEnabled() ? llmJudge : undefined,
      })),
    );
    if (projectionAssertions.length > 0) {
      const projectionOutcome = await evaluateWorkspaceProjectionAssertions(
        projectionAssertions,
        { tenantId: run.tenant_id },
      );
      assertionResults.push(...projectionOutcome.results);
      threadTurnId = projectionOutcome.threadTurnId;
    }

    const evaluatorIds = (tc.agentcore_evaluator_ids ?? []) as string[];
    if (evaluatorIds.length > 0) {
      const results = await builtInEvaluatorResults(evaluatorIds);
      evaluatorResults.push(...results);
      costUsd += results.reduce(
        (total, result) =>
          total + estimateAgentCoreEvaluatorCostUsd(result.token_usage),
        0,
      );
    }
  } catch (err) {
    if (isRetryableEvalInfrastructureError(err)) {
      throw err;
    }
    if (err instanceof AgentCoreEvalInvocationTimeoutError) {
      durationMs = err.timeoutMs;
      assertionResults.push(agentCoreBudgetExceededAssertion(err.timeoutMs));
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[eval-worker] test '${tc.name}' failed:`, errorMessage);
    }
  }

  const scoredOutcome = scoreEvalOutcome({
    assertionResults,
    evaluatorResults,
    errorMessage,
  });

  return {
    status: scoredOutcome.status,
    errorCause: scoredOutcome.errorCause,
    score: scoredOutcome.score,
    assertionResults,
    evaluatorResults,
    actualOutput,
    systemPrompt,
    durationMs,
    errorMessage,
    costUsd,
    sessionId,
    threadTurnId,
  };
}

async function maybeFinalizeRun(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
  if (!run || run.status !== "running" || run.total_tests <= 0) return;

  const rows = await db
    .select({
      status: evalResults.status,
      evaluator_results: evalResults.evaluator_results,
    })
    .from(evalResults)
    .where(eq(evalResults.run_id, runId));
  const summary = summarizeEvalResults(rows, run.scoring_version);
  const isComplete = summary.completed >= run.total_tests;
  const completedAt = new Date();

  const updated = await db
    .update(evalRuns)
    .set({
      status: isComplete ? "completed" : "running",
      completed_at: isComplete ? completedAt : null,
      passed: summary.passed,
      failed: summary.failed,
      errored: summary.errored,
      pass_rate: summary.passRate === null ? null : summary.passRate.toFixed(4),
      cost_usd: summary.totalCostUsd.toFixed(6),
      // Record the semantics this summary was computed under. Legacy
      // runs (null stamp) keep a null summary version; stamped runs get
      // the version this code actually knows — if the run was stamped by
      // newer code, the divergence makes the reconciler/read path
      // recompute once that code is warm (deploy-window guard).
      summary_scoring_version:
        run.scoring_version === null ? null : CURRENT_EVAL_SCORING_VERSION,
    })
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")))
    .returning({ id: evalRuns.id });
  if (updated.length === 0) return;

  if (isComplete && summary.totalCostUsd > 0 && run.agent_id) {
    await db
      .insert(costEvents)
      .values({
        tenant_id: run.tenant_id,
        agent_id: run.agent_id,
        request_id: `eval-run-${runId}`,
        event_type: "eval_compute",
        amount_usd: summary.totalCostUsd.toFixed(6),
        metadata: {
          source: "eval-worker",
          run_id: runId,
          total_tests: run.total_tests,
        },
      })
      .onConflictDoNothing();
  }

  await notifyEvalRunUpdate({
    runId,
    tenantId: run.tenant_id,
    agentId: run.agent_id,
    status: isComplete ? "completed" : "running",
    totalTests: run.total_tests,
    passed: summary.passed,
    failed: summary.failed,
    passRate: summary.passRate ?? undefined,
  });
  console.log(
    `[eval-worker] progress runId=${runId}: ${summary.passed} passed, ${summary.failed} failed, ${summary.errored ?? 0} errored of ${run.total_tests}`,
  );
}

async function handleMessage(message: EvalWorkerMessage): Promise<void> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, message.runId));
  if (!run) {
    console.warn(`[eval-worker] run not found: ${message.runId}`);
    return;
  }
  if (
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "failed"
  ) {
    return;
  }

  const [existing] = await db
    .select({ id: evalResults.id })
    .from(evalResults)
    .where(
      and(
        eq(evalResults.run_id, message.runId),
        eq(evalResults.test_case_id, message.testCaseId),
      ),
    );
  if (existing) {
    await maybeFinalizeRun(message.runId);
    return;
  }

  const [tc] = await db
    .select()
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.id, message.testCaseId),
        eq(evalTestCases.tenant_id, run.tenant_id),
      ),
    );
  if (!tc) {
    throw new Error(
      `eval test case ${message.testCaseId} not found for run ${message.runId}`,
    );
  }

  const outcome = await executeCase(run, tc, message);

  const [freshRun] = await db
    .select({ status: evalRuns.status })
    .from(evalRuns)
    .where(eq(evalRuns.id, message.runId));
  if (freshRun?.status === "cancelled") return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
			SELECT pg_advisory_xact_lock(
				hashtext(${message.runId}),
				hashtext(${message.testCaseId})
			)
		`);
    const [duplicate] = await tx
      .select({ id: evalResults.id })
      .from(evalResults)
      .where(
        and(
          eq(evalResults.run_id, message.runId),
          eq(evalResults.test_case_id, message.testCaseId),
        ),
      );
    if (duplicate) return;

    await tx.insert(evalResults).values({
      run_id: message.runId,
      test_case_id: message.testCaseId,
      status: outcome.status,
      error_cause: outcome.errorCause,
      score: outcome.score === null ? null : outcome.score.toFixed(4),
      duration_ms: outcome.durationMs,
      agent_session_id: outcome.sessionId,
      thread_turn_id: outcome.threadTurnId,
      input: tc.query,
      expected: null,
      actual_output: outcome.actualOutput,
      system_prompt: outcome.systemPrompt,
      evaluator_results: outcome.evaluatorResults,
      assertions: outcome.assertionResults,
      error_message: outcome.errorMessage,
    });
  });

  await maybeFinalizeRun(message.runId);
}

function recordsFromEvent(event: SQSEvent): SQSRecord[] {
  return Array.isArray(event.Records) ? event.Records : [];
}

export async function handler(event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of recordsFromEvent(event)) {
    try {
      await handleMessage(parseEvalWorkerMessage(record.body));
    } catch (err) {
      console.error("[eval-worker] infrastructure failure:", err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
