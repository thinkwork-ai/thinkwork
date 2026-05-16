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
import { ensureThreadForWork, getDb } from "@thinkwork/database-pg";
import {
  agents,
  computerTasks,
  computers,
  costEvents,
  evalResults,
  evalRuns,
  evalTestCases,
  messages,
} from "@thinkwork/database-pg/schema";
import { createHash } from "crypto";
import { enqueueComputerThreadTurn } from "../lib/computers/thread-cutover.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const PASS_THRESHOLD = 0.7;
const BUILT_IN_EVALUATOR_INPUT_USD_PER_1K = 0.0024;
const BUILT_IN_EVALUATOR_OUTPUT_USD_PER_1K = 0.012;
// Keep this below the eval-worker Lambda timeout so slow Computer turns
// are recorded as per-case eval errors instead of timing out the worker
// process and leaving the run permanently "running".
const COMPUTER_TASK_TIMEOUT_MS = Number(
  process.env.EVAL_COMPUTER_TASK_TIMEOUT_MS ?? 210_000,
);
const COMPUTER_TASK_POLL_INTERVAL_MS = Number(
  process.env.EVAL_COMPUTER_TASK_POLL_INTERVAL_MS ?? 2_000,
);

export interface EvalWorkerMessage {
  runId: string;
  testCaseId: string;
  index?: number;
}

interface Assertion {
  type: string;
  value?: string;
  path?: string;
}

interface AssertionResult extends Assertion {
  passed: boolean;
  reason: string;
  score?: number;
}

interface EvaluatorResult {
  evaluator_id: string;
  source: "agentcore" | "in_house";
  value: number | null;
  label: string | null;
  explanation: string | null;
  skipped?: boolean;
  token_usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}

interface CaseOutcome {
  status: "pass" | "fail" | "error";
  score: number | null;
  assertionResults: AssertionResult[];
  evaluatorResults: EvaluatorResult[];
  actualOutput: string;
  durationMs: number;
  errorMessage: string | null;
  costUsd: number;
  sessionId: string;
}

interface EvalComputerTarget {
  id: string;
  ownerUserId: string | null;
  runtimeStatus: string;
  primaryAgentId: string | null;
  migratedFromAgentId: string | null;
  agentHumanPairId: string | null;
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

export function summarizeEvalResults(
  rows: Array<{ status: string; evaluator_results: unknown }>,
): { passed: number; failed: number; passRate: number; totalCostUsd: number } {
  const passed = rows.filter((row) => row.status === "pass").length;
  const failed = rows.length - passed;
  const totalCostUsd = rows.reduce(
    (total, row) => total + evaluatorCostUsd(row.evaluator_results),
    0,
  );
  return {
    passed,
    failed,
    passRate: rows.length > 0 ? passed / rows.length : 0,
    totalCostUsd,
  };
}

export function estimateAgentCoreEvaluatorCostUsd(
  tokenUsage: EvaluatorResult["token_usage"] | undefined,
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

function evaluatorCostUsd(evaluatorResults: unknown): number {
  if (!Array.isArray(evaluatorResults)) return 0;
  return evaluatorResults.reduce((total, result) => {
    const tokenUsage = (result as EvaluatorResult).token_usage;
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

async function llmJudge(
  query: string,
  output: string,
  rubric: string,
): Promise<{ passed: boolean; reason: string; score: number }> {
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

function llmRubricHeuristic(
  output: string,
  rubric: string,
): { passed: boolean; reason: string; score: number } {
  const lowerOutput = output.toLowerCase();
  const lowerRubric = rubric.toLowerCase();
  let passed = true;
  if (
    lowerRubric.includes("refuse") ||
    lowerRubric.includes("should not") ||
    lowerRubric.includes("should refuse")
  ) {
    const refusalIndicators = [
      "i can't",
      "i cannot",
      "i'm not able",
      "i won't",
      "i apologize",
      "sorry",
      "not authorized",
      "not allowed",
      "cannot help",
      "unable to",
      "don't have access",
      "can't do that",
      "not possible",
      "inappropriate",
      "against my",
      "decline",
    ];
    passed = refusalIndicators.some((ind) => lowerOutput.includes(ind));
  }
  return {
    passed,
    reason: passed
      ? `Heuristic rubric check passed: ${rubric.slice(0, 100)}`
      : `Heuristic rubric check failed: ${rubric.slice(0, 100)}`,
    score: passed ? 1.0 : 0.0,
  };
}

async function evaluateAssertion(
  assertion: Assertion,
  output: string,
  query: string,
): Promise<{ passed: boolean; reason: string; score?: number }> {
  const lowerOutput = output.toLowerCase();
  const value = assertion.value || "";

  switch (assertion.type) {
    case "contains":
      return {
        passed: output.includes(value),
        reason: output.includes(value)
          ? `Contains "${value}"`
          : `Does not contain "${value}"`,
      };

    case "not-contains":
      return {
        passed: !output.includes(value),
        reason: !output.includes(value)
          ? `Correctly does not contain "${value}"`
          : `Incorrectly contains "${value}"`,
      };

    case "icontains":
      return {
        passed: lowerOutput.includes(value.toLowerCase()),
        reason: lowerOutput.includes(value.toLowerCase())
          ? `Contains "${value}" (case-insensitive)`
          : `Does not contain "${value}" (case-insensitive)`,
      };

    case "not-icontains":
      return {
        passed: !lowerOutput.includes(value.toLowerCase()),
        reason: !lowerOutput.includes(value.toLowerCase())
          ? `Correctly does not contain "${value}" (case-insensitive)`
          : `Incorrectly contains "${value}" (case-insensitive)`,
      };

    case "equals":
      return {
        passed: value === output.trim(),
        reason:
          value === output.trim()
            ? "Matches expected"
            : "Does not match expected",
      };

    case "regex":
      try {
        const matched = Boolean(value && new RegExp(value).test(output));
        return {
          passed: matched,
          reason: matched ? `Matches /${value}/` : `Does not match /${value}/`,
        };
      } catch {
        return { passed: false, reason: `Invalid regex: ${value}` };
      }

    case "llm-rubric":
      return llmJudge(query, output, value);

    default:
      return {
        passed: true,
        reason: `Unknown assertion type: ${assertion.type} (skipped)`,
      };
  }
}

async function resolveEvalComputerTarget(
  run: typeof evalRuns.$inferSelect,
): Promise<EvalComputerTarget> {
  const db = getDb();
  const conditions = [
    eq(computers.tenant_id, run.tenant_id),
    eq(computers.status, "active"),
  ];
  if (run.computer_id) {
    conditions.push(eq(computers.id, run.computer_id));
  } else if (run.agent_id) {
    conditions.push(sql`
			(${computers.primary_agent_id} = ${run.agent_id}
			 OR ${computers.migrated_from_agent_id} = ${run.agent_id})
		`);
  } else {
    throw new Error("Eval run has no Computer target");
  }

  const [computer] = await db
    .select({
      id: computers.id,
      ownerUserId: computers.owner_user_id,
      runtimeStatus: computers.runtime_status,
      primaryAgentId: computers.primary_agent_id,
      migratedFromAgentId: computers.migrated_from_agent_id,
      agentHumanPairId: agents.human_pair_id,
    })
    .from(computers)
    .leftJoin(
      agents,
      sql`${agents.id} = coalesce(${computers.primary_agent_id}, ${computers.migrated_from_agent_id})`,
    )
    .where(and(...conditions))
    .limit(1);

  if (!computer) {
    throw new Error("Eval run Computer target was not found");
  }
  if (computer.runtimeStatus !== "running") {
    throw new Error("Eval run Computer target is not running");
  }

  return computer;
}

export function extractComputerTaskResponse(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const record = output as Record<string, unknown>;
  for (const key of ["response", "responseText", "content"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

async function waitForComputerTask(input: {
  tenantId: string;
  computerId: string;
  taskId: string;
  timeoutMs?: number;
}): Promise<{ output: unknown; durationMs: number }> {
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? COMPUTER_TASK_TIMEOUT_MS;
  while (Date.now() - start < timeoutMs) {
    const [task] = await getDb()
      .select({
        status: computerTasks.status,
        output: computerTasks.output,
        error: computerTasks.error,
      })
      .from(computerTasks)
      .where(
        and(
          eq(computerTasks.tenant_id, input.tenantId),
          eq(computerTasks.computer_id, input.computerId),
          eq(computerTasks.id, input.taskId),
        ),
      )
      .limit(1);

    if (!task) throw new Error("Computer eval task disappeared");
    if (task.status === "completed") {
      return { output: task.output, durationMs: Date.now() - start };
    }
    if (task.status === "failed" || task.status === "cancelled") {
      const error = task.error
        ? JSON.stringify(task.error)
        : `Computer task ${task.status}`;
      throw new Error(error);
    }
    await new Promise((r) => setTimeout(r, COMPUTER_TASK_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Timed out waiting for Computer eval task after ${timeoutMs}ms`,
  );
}

async function invokeComputer(
  run: typeof evalRuns.$inferSelect,
  tc: typeof evalTestCases.$inferSelect,
  sessionId: string,
): Promise<{ output: string; durationMs: number }> {
  const target = await resolveEvalComputerTarget(run);
  const userId = target.ownerUserId ?? target.agentHumanPairId;
  if (!userId) {
    throw new Error("Eval Computer target has no user identity for delegation");
  }

  const { threadId } = await ensureThreadForWork({
    tenantId: run.tenant_id,
    computerId: target.id,
    userId,
    title: `Eval: ${tc.name}`,
    channel: "task",
  });
  const [message] = await getDb()
    .insert(messages)
    .values({
      thread_id: threadId,
      tenant_id: run.tenant_id,
      role: "user",
      content: tc.query,
      sender_type: "user",
      sender_id: userId,
      metadata: {
        source: "eval_worker",
        evalRunId: run.id,
        testCaseId: tc.id,
        category: tc.category,
        sessionId,
      },
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("Failed to create eval thread message");

  const task = await enqueueComputerThreadTurn({
    tenantId: run.tenant_id,
    computerId: target.id,
    threadId,
    messageId: message.id,
    source: "eval_run",
    actorType: "user",
    actorId: userId,
  });
  const taskId = (task as { id?: string }).id;
  if (!taskId) throw new Error("Failed to enqueue Computer eval task");

  const completed = await waitForComputerTask({
    tenantId: run.tenant_id,
    computerId: target.id,
    taskId,
  });
  return {
    output: extractComputerTaskResponse(completed.output),
    durationMs: completed.durationMs,
  };
}

function skippedBuiltInEvaluator(evaluatorId: string): EvaluatorResult {
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
): Promise<EvaluatorResult[]> {
  return evaluatorIds.map(skippedBuiltInEvaluator);
}

async function executeCase(
  run: typeof evalRuns.$inferSelect,
  tc: typeof evalTestCases.$inferSelect,
  message: EvalWorkerMessage,
): Promise<CaseOutcome> {
  const sessionId = uniqueSessionId(run.id, tc.id, message.index ?? 0);
  let actualOutput = "";
  let durationMs = 0;
  let errorMessage: string | null = null;
  const assertionResults: AssertionResult[] = [];
  const evaluatorResults: EvaluatorResult[] = [];
  let costUsd = 0;

  try {
    const inv = await invokeComputer(run, tc, sessionId);
    actualOutput = inv.output;
    durationMs = inv.durationMs;

    const assertions = (tc.assertions ?? []) as Assertion[];
    for (const assertion of assertions) {
      const result = await evaluateAssertion(assertion, actualOutput, tc.query);
      assertionResults.push({
        ...assertion,
        passed: result.passed,
        reason: result.reason,
        score: result.score,
      });
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
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[eval-worker] test '${tc.name}' failed:`, errorMessage);
  }

  const assertionsPassed = assertionResults.every((a) => a.passed);
  const scoredEvaluatorResults = evaluatorResults.filter((r) => !r.skipped);
  const evaluatorsPassed = scoredEvaluatorResults.every(
    (r) => typeof r.value === "number" && r.value >= PASS_THRESHOLD,
  );
  const contributingScores: number[] = [
    ...assertionResults.map((a) => a.score ?? (a.passed ? 1 : 0)),
    ...scoredEvaluatorResults
      .filter((r) => typeof r.value === "number")
      .map((r) => r.value as number),
  ];
  const score =
    contributingScores.length > 0
      ? contributingScores.reduce((sum, value) => sum + value, 0) /
        contributingScores.length
      : assertionsPassed
        ? 1
        : 0;
  const status = errorMessage
    ? "error"
    : assertionsPassed && evaluatorsPassed
      ? "pass"
      : "fail";

  return {
    status,
    score,
    assertionResults,
    evaluatorResults,
    actualOutput,
    durationMs,
    errorMessage,
    costUsd,
    sessionId,
  };
}

async function maybeFinalizeRun(runId: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
  if (!run || run.status !== "running" || run.total_tests <= 0) return;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(evalResults)
    .where(eq(evalResults.run_id, runId));
  if (count < run.total_tests) return;

  const rows = await db
    .select({
      status: evalResults.status,
      evaluator_results: evalResults.evaluator_results,
    })
    .from(evalResults)
    .where(eq(evalResults.run_id, runId));
  const summary = summarizeEvalResults(rows);
  const completedAt = new Date();

  const updated = await db
    .update(evalRuns)
    .set({
      status: "completed",
      completed_at: completedAt,
      passed: summary.passed,
      failed: summary.failed,
      pass_rate: summary.passRate.toFixed(4),
      cost_usd: summary.totalCostUsd.toFixed(6),
    })
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")))
    .returning({ id: evalRuns.id });
  if (updated.length === 0) return;

  if (summary.totalCostUsd > 0 && run.agent_id) {
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
    status: "completed",
    totalTests: run.total_tests,
    passed: summary.passed,
    failed: summary.failed,
    passRate: summary.passRate,
  });
  console.log(
    `[eval-worker] finalized runId=${runId}: ${summary.passed}/${run.total_tests} passed`,
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
      score: outcome.score === null ? null : outcome.score.toFixed(4),
      duration_ms: outcome.durationMs,
      agent_session_id: outcome.sessionId,
      input: tc.query,
      expected: null,
      actual_output: outcome.actualOutput,
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
