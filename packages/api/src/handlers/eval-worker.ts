/**
 * eval-worker Lambda
 *
 * SQS delivers one eval test case per invocation. Application-level case
 * failures are recorded as eval_results.status='error' (with an error_cause)
 * and acknowledged. Throttling is the only error that redrives through SQS:
 * on the final receive (ApproximateReceiveCount vs the queue's
 * maxReceiveCount, mirrored in EVAL_FANOUT_MAX_RECEIVE_COUNT) the worker
 * records error/throttle instead of rethrowing, so a case never vanishes
 * into the DLQ without a result row. Timeouts already consumed the full
 * response budget and are recorded immediately as error/timeout.
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  evalResults,
  evalRuns,
  evalTestCases,
  tenants,
} from "@thinkwork/database-pg/schema";
import {
  CURRENT_EVAL_SCORING_VERSION,
  EvalEngineContractViolationError,
  runScoringEngine,
  scoreEvalOutcome,
  summarizeEvalStatuses,
  type EvalAssertion,
  type EvalAssertionResult,
  type EvalErrorCause,
  type EvalEvaluatorResult,
  type ScoringEngine,
} from "@thinkwork/evals-core";
import { createHash } from "crypto";
import {
  AgentCoreEvalInvocationTimeoutError,
  invokeAgentCoreForEval,
  type EvalReplayHistoryMessage,
} from "../lib/evals/agentcore-direct.js";
import { isRetryableEvalInfrastructureError } from "../lib/evals/retryable.js";
import {
  bedrockLlmJudge,
  createInHouseScoringEngine,
  EvalJudgeInvocationError,
  heuristicFallbackJudge,
  llmJudgeEnabled,
} from "../lib/evals/engines/in-house.js";
import { createAgentCoreScoringEngine } from "../lib/evals/engines/agentcore.js";

// Engine-seam extractions (Trust Core U10): the judge + gate symbols
// moved behind the scoring-engine modules; re-exported here so existing
// importers/tests keep working.
export { isRetryableEvalInfrastructureError } from "../lib/evals/retryable.js";
export {
  bedrockLlmJudge,
  EVAL_IN_HOUSE_ENGINE_ID,
  EVAL_JUDGE_SYSTEM_PROMPT,
  EvalJudgeInvocationError,
  createInHouseScoringEngine,
  heuristicFallbackJudge,
  llmJudgeEnabled,
  parseEvalJudgeVerdict,
  type EvalJudgeVerdict,
} from "../lib/evals/engines/in-house.js";
export {
  agentCoreEvaluatorsEnabled,
  createAgentCoreScoringEngine,
  EVAL_AGENTCORE_ENGINE_ID,
} from "../lib/evals/engines/agentcore.js";
import {
  evaluateWorkspaceProjectionAssertions,
  partitionEvalAssertions,
} from "../lib/evals/workspace-projection-assertions.js";
import { resolveTenantPlatformAgent } from "../lib/agents/tenant-platform-agent.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import {
  caseIdFromRunSnapshotKey,
  evalRunSnapshotCasePayloadKey,
  FLAGGED_THREAD_CATEGORY,
  isEvalRunSnapshotKeyForRun,
  parseEvalDatasetCase,
  sha256Hex,
  type DatasetStorage,
} from "../lib/evals/dataset-store.js";
import { createEvalDatasetStorageFromConfig } from "../lib/evals/run-launch.js";

const BUILT_IN_EVALUATOR_INPUT_USD_PER_1K = 0.0024;
const BUILT_IN_EVALUATOR_OUTPUT_USD_PER_1K = 0.012;
export interface EvalWorkerMessage {
  runId: string;
  testCaseId: string;
  index?: number;
  /**
   * Dataset-pinned launches (Trust Core U6): the run-scoped S3 key the
   * worker loads the case content from, plus its expected sha. Absent on
   * legacy messages, which keep reading the eval_test_cases row.
   */
  snapshotKey?: string;
  contentSha?: string;
  /**
   * Flagged-thread cases (U8): launch-computed sha256 per payload object
   * copied into the run snapshot prefix (history/workspace/traces). The
   * worker verifies its run-prefix payload fetch against these before
   * replaying recorded history — payloads aren't in the dataset
   * manifest, so the launch's read-once hash is the integrity anchor.
   */
  payloadShas?: Partial<Record<"history" | "workspace" | "traces", string>>;
}

/**
 * Execution-facing shape of a case: either the eval_test_cases row
 * (legacy messages) or the parsed run-scoped snapshot copy (pinned
 * messages). `id` is always the eval_test_cases row uuid — result rows
 * FK it for dedupe and trend history either way.
 */
export interface ExecutionCase {
  id: string;
  name: string;
  query: string;
  system_prompt: string | null;
  assertions: unknown;
  agentcore_evaluator_ids: string[] | null;
  /**
   * Flagged-thread replay (U8): the recorded conversation strictly
   * BEFORE the flagged turn, in the chat-agent-invoke messages_history
   * row shape. Undefined for synthetic cases (single-message replay).
   */
  messages_history?: EvalReplayHistoryMessage[];
}

let snapshotStorageForTests: DatasetStorage | undefined;

/** Test seam: pinned-case tests inject an in-memory storage fake. */
export function _setSnapshotStorageForTests(
  storage: DatasetStorage | undefined,
): void {
  snapshotStorageForTests = storage;
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

const PAYLOAD_SHA_NAMES = ["history", "workspace", "traces"] as const;

function parsePayloadShas(
  value: unknown,
): EvalWorkerMessage["payloadShas"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const shas: NonNullable<EvalWorkerMessage["payloadShas"]> = {};
  for (const name of PAYLOAD_SHA_NAMES) {
    const sha = record[name];
    if (typeof sha === "string" && sha.length > 0) shas[name] = sha;
  }
  return Object.keys(shas).length > 0 ? shas : undefined;
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
    snapshotKey:
      typeof parsed.snapshotKey === "string" && parsed.snapshotKey.length > 0
        ? parsed.snapshotKey
        : undefined,
    contentSha:
      typeof parsed.contentSha === "string" && parsed.contentSha.length > 0
        ? parsed.contentSha
        : undefined,
    payloadShas: parsePayloadShas(parsed.payloadShas),
  };
}

/**
 * Summarize a run's result rows under the run's stamped scoring
 * semantics (`scoringVersion` null = legacy ~v1: errors fold into
 * `failed`; v2+: `failed` counts only status='fail', errors land in
 * `errored`, and pass_rate = passed / (passed + failed) — null when
 * nothing scoreable, never 0%). Override-aware (Trust Core U9): rows
 * carrying an operator `override_status` count under their effective
 * verdict (override ?? status).
 */
export function summarizeEvalResults(
  rows: Array<{
    status: string;
    override_status?: string | null;
    evaluator_results: unknown;
  }>,
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

/**
 * The eval fan-out queue's redrive maxReceiveCount, mirrored into the
 * worker env by terraform (same local feeds the redrive policy, so the
 * two can't drift). Defaults to the terraform value when unset.
 */
export const DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT = 5;

export function evalFanoutMaxReceiveCount(
  value = process.env.EVAL_FANOUT_MAX_RECEIVE_COUNT,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EVAL_FANOUT_MAX_RECEIVE_COUNT;
  }
  return Math.floor(parsed);
}

/**
 * True when SQS will not redeliver this message again (this receive is
 * the last one before the redrive policy moves it to the DLQ). On the
 * final receive the worker records error/throttle instead of rethrowing
 * so the case never disappears without a result row.
 */
export function isFinalSqsReceive(
  record: Pick<SQSRecord, "attributes">,
  maxReceiveCount = evalFanoutMaxReceiveCount(),
): boolean {
  const count = Number(record.attributes?.ApproximateReceiveCount ?? "1");
  if (!Number.isFinite(count)) return false;
  return count >= maxReceiveCount;
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

interface ScoringEngines {
  inHouse: ScoringEngine;
  agentCore: ScoringEngine;
}

let scoringEnginesForTests: Partial<ScoringEngines> | undefined;

/** Test seam: engine-contract tests inject fake/spy engines. */
export function _setScoringEnginesForTests(
  engines: Partial<ScoringEngines> | undefined,
): void {
  scoringEnginesForTests = engines;
}

/**
 * Engine selection (Trust Core U10): the in-house engine always scores;
 * the AgentCore adapter handles the case's engines.agentcore evaluator
 * selection and stays gated OFF (skipped stubs) until activation —
 * agentCoreEvaluatorsEnabled() is consulted inside the adapter. Engines
 * are resolved per case so env-driven judge enablement is read at
 * execution time, exactly like the pre-contract path.
 */
function resolveScoringEngines(): ScoringEngines {
  return {
    inHouse:
      scoringEnginesForTests?.inHouse ??
      createInHouseScoringEngine({
        // ALWAYS pass a judge (Trust Core U12) — never undefined. With the
        // LLM judge enabled, the real Bedrock Converse judge scores every
        // rubric. Disabled, the heuristic fallback judge scores refusal
        // rubrics (red-team) and throws EvalJudgeInvocationError →
        // error/evaluator_error for non-refusal rubrics, so a quality
        // rubric is recorded unscored rather than vacuously passed.
        judge: llmJudgeEnabled() ? bedrockLlmJudge : heuristicFallbackJudge,
      }),
    agentCore:
      scoringEnginesForTests?.agentCore ?? createAgentCoreScoringEngine(),
  };
}

/**
 * Pinned-case load (Trust Core U6): dataset-pinned messages carry a
 * run-scoped snapshot key. Reject any key resolving outside the run's
 * guarded tenant prefix BEFORE any S3 fetch, verify the fetched content
 * sha against the message's expected sha, and parse the engine-neutral
 * case file. Every failure is error/infra_other — never a behavioral
 * fail, never an SQS redrive (retrying cannot fix a bad reference).
 */
async function loadPinnedCase(
  run: typeof evalRuns.$inferSelect,
  message: EvalWorkerMessage,
): Promise<
  | { ok: true; executionCase: ExecutionCase }
  | { ok: false; errorMessage: string }
> {
  const snapshotKey = message.snapshotKey as string;
  const db = getDb();
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, run.tenant_id));
  if (!tenant?.slug) {
    return {
      ok: false,
      errorMessage: `tenant ${run.tenant_id} has no slug; cannot resolve run snapshot`,
    };
  }
  if (!isEvalRunSnapshotKeyForRun(snapshotKey, tenant.slug, run.id)) {
    // No fetch: the reference points outside this run's guarded prefix.
    return {
      ok: false,
      errorMessage: `eval snapshot key rejected (outside run snapshot prefix): ${snapshotKey}`,
    };
  }

  const storage =
    snapshotStorageForTests ?? createEvalDatasetStorageFromConfig();
  const content = await storage.read(snapshotKey);
  if (content == null) {
    return {
      ok: false,
      errorMessage: `run snapshot object missing: ${snapshotKey}`,
    };
  }
  if (message.contentSha && sha256Hex(content) !== message.contentSha) {
    return {
      ok: false,
      errorMessage: `run snapshot content sha mismatch for ${snapshotKey}`,
    };
  }

  const parsed = parseEvalDatasetCase(content);
  const executionCase: ExecutionCase = {
    id: message.testCaseId,
    name: parsed.core.name,
    query: parsed.core.query,
    system_prompt: parsed.core.system_prompt,
    assertions: parsed.core.assertions,
    // Engine evaluator ids come from the case file's engines.agentcore
    // block for pinned cases — never the live index row.
    agentcore_evaluator_ids: parsed.engines?.agentcore?.evaluator_ids ?? [],
  };

  // Flagged-thread replay (U8): load the recorded history from the RUN
  // snapshot (never the live dataset payload) and slice it strictly
  // before the flagged turn. The case query already IS the flagged
  // turn's text (U7 capture).
  if (parsed.core.category === FLAGGED_THREAD_CATEGORY) {
    const replay = await loadFlaggedReplayHistory(
      storage,
      snapshotKey,
      tenant.slug,
      run.id,
      message,
    );
    if (!replay.ok) return replay;
    executionCase.messages_history = replay.messagesHistory;
  }

  return { ok: true, executionCase };
}

/**
 * Load + slice the flagged-thread history payload from the run snapshot
 * (U8). Replay contract (KTD): messages strictly BEFORE
 * `flagged_message_id` become `messages_history`; the flagged turn's
 * text is already the case query; the recorded answer (and anything
 * after the flagged turn) is judging context only and must NEVER
 * replay. The payload key derives from the guard-validated snapshot
 * key's case-id segment — never from file content — so it sits inside
 * the run prefix by construction. Integrity: the fetched bytes must
 * match the launch-computed sha carried on the SQS message.
 */
async function loadFlaggedReplayHistory(
  storage: DatasetStorage,
  snapshotKey: string,
  tenantSlug: string,
  runId: string,
  message: EvalWorkerMessage,
): Promise<
  | { ok: true; messagesHistory: EvalReplayHistoryMessage[] }
  | { ok: false; errorMessage: string }
> {
  const historyKey = evalRunSnapshotCasePayloadKey(
    tenantSlug,
    runId,
    caseIdFromRunSnapshotKey(snapshotKey),
    "history",
  );
  const content = await storage.read(historyKey);
  if (content == null) {
    return {
      ok: false,
      errorMessage: `flagged-thread replay history payload missing from run snapshot: ${historyKey}`,
    };
  }
  const expectedSha = message.payloadShas?.history;
  if (expectedSha && sha256Hex(content) !== expectedSha) {
    return {
      ok: false,
      errorMessage: `flagged-thread replay history payload sha mismatch for ${historyKey}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      errorMessage: `flagged-thread replay history payload is not valid JSON: ${historyKey}`,
    };
  }
  const payload = parsed as {
    messages?: unknown;
    flagged_message_id?: unknown;
  };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const flaggedMessageId =
    typeof payload.flagged_message_id === "string"
      ? payload.flagged_message_id
      : null;

  // Slice STRICTLY before the flagged message. When the marker is
  // missing or unresolvable, degrade to an empty history rather than
  // replaying the whole array — the recorded bad answer must never be
  // fed back to the agent under test.
  const flaggedIndex = flaggedMessageId
    ? messages.findIndex(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          (row as { id?: unknown }).id === flaggedMessageId,
      )
    : -1;
  const priorMessages =
    flaggedIndex >= 0 ? messages.slice(0, flaggedIndex) : [];

  // Same row filter chat-agent-invoke applies before shipping
  // messages_history to the runtime (user/assistant + non-empty text);
  // the runtime's normalizeHistory drops anything else anyway.
  const messagesHistory: EvalReplayHistoryMessage[] = [];
  for (const row of priorMessages) {
    if (typeof row !== "object" || row === null) continue;
    const { role, content: text } = row as {
      role?: unknown;
      content?: unknown;
    };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof text !== "string" || text.length === 0) continue;
    messagesHistory.push({ role, content: text });
  }
  return { ok: true, messagesHistory };
}

async function executeCase(
  run: typeof evalRuns.$inferSelect,
  tc: ExecutionCase,
  message: EvalWorkerMessage,
  options: { finalReceive: boolean },
): Promise<CaseOutcome> {
  const sessionId = uniqueSessionId(run.id, tc.id, message.index ?? 0);
  let actualOutput = "";
  let systemPrompt: string | null = null;
  let durationMs = 0;
  let errorMessage: string | null = null;
  let errorCause: EvalErrorCause | null = null;
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
      // Flagged-thread replay (U8): recorded conversation strictly
      // before the flagged turn; undefined (= empty history) for
      // synthetic single-message cases.
      messagesHistory: tc.messages_history,
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

    // Scoring dispatches through the ScoringEngine contract (Trust Core
    // U10). runScoringEngine validates each engine's result at the
    // boundary — a malformed result throws
    // EvalEngineContractViolationError (classified error/evaluator_error
    // below); engine-thrown errors propagate raw so throttles stay
    // SQS-retryable.
    const engines = resolveScoringEngines();
    const response = { output: actualOutput, durationMs, sessionId };
    const inHouseResult = await runScoringEngine(engines.inHouse, {
      query: tc.query,
      assertions: outputAssertions,
      response,
      context: { modelId: run.model },
    });
    assertionResults.push(...inHouseResult.assertions);
    evaluatorResults.push(...inHouseResult.verdicts);

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
      const agentCoreResult = await runScoringEngine(engines.agentCore, {
        query: tc.query,
        assertions: [],
        evaluatorIds,
        response,
        context: { modelId: run.model },
      });
      assertionResults.push(...agentCoreResult.assertions);
      evaluatorResults.push(...agentCoreResult.verdicts);
      costUsd += agentCoreResult.verdicts.reduce(
        (total, result) =>
          total + estimateAgentCoreEvaluatorCostUsd(result.token_usage),
        0,
      );
    }
  } catch (err) {
    if (err instanceof AgentCoreEvalInvocationTimeoutError) {
      // Timeout is infrastructure, not behavior: the case consumed the
      // full response budget, so it records error/timeout immediately —
      // no synthetic failing assertion, no SQS redrive.
      durationMs = err.timeoutMs;
      errorCause = "timeout";
      errorMessage = err.message;
      console.error(`[eval-worker] test '${tc.name}' timed out:`, errorMessage);
    } else if (isRetryableEvalInfrastructureError(err)) {
      if (!options.finalReceive) {
        // SQS redrive retries the case (bounded by the queue's
        // maxReceiveCount).
        throw err;
      }
      // Final receive: a rethrow would dead-letter the message with no
      // result row, leaving the run open until the reconciler. Record
      // error/throttle so the case terminates visibly.
      errorCause = "throttle";
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[eval-worker] test '${tc.name}' throttled on final SQS receive; recording error/throttle:`,
        errorMessage,
      );
    } else if (err instanceof EvalJudgeInvocationError) {
      errorCause = "evaluator_error";
      errorMessage = err.message;
      console.error(
        `[eval-worker] test '${tc.name}' judge error:`,
        errorMessage,
      );
    } else if (err instanceof EvalEngineContractViolationError) {
      // A scoring engine returned an unknown status/shape — the
      // evaluator broke, not the agent (same taxonomy as a judge crash).
      errorCause = "evaluator_error";
      errorMessage = err.message;
      console.error(
        `[eval-worker] test '${tc.name}' engine contract violation:`,
        errorMessage,
      );
    } else {
      errorCause = "infra_other";
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[eval-worker] test '${tc.name}' failed:`, errorMessage);
    }
  }

  const scoredOutcome = scoreEvalOutcome({
    assertionResults,
    evaluatorResults,
    errorMessage,
    errorCause,
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
      override_status: evalResults.override_status,
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

async function handleMessage(
  message: EvalWorkerMessage,
  options: { finalReceive: boolean },
): Promise<void> {
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

  // Dataset-pinned messages execute the launch-time copy (Trust Core
  // U6); the live eval_test_cases content is never used for them — a
  // mid-run edit or tombstone cannot change what this case runs against.
  let executionCase: ExecutionCase = tc;
  let outcome: CaseOutcome;
  if (message.snapshotKey) {
    const pinned = await loadPinnedCase(run, message);
    if (!pinned.ok) {
      console.error(
        `[eval-worker] pinned case load failed for run ${message.runId}:`,
        pinned.errorMessage,
      );
      outcome = {
        status: "error",
        errorCause: "infra_other",
        score: null,
        assertionResults: [],
        evaluatorResults: [],
        actualOutput: "",
        systemPrompt: null,
        durationMs: 0,
        errorMessage: pinned.errorMessage,
        costUsd: 0,
        sessionId: uniqueSessionId(
          message.runId,
          message.testCaseId,
          message.index ?? 0,
        ),
        threadTurnId: null,
      };
    } else {
      executionCase = pinned.executionCase;
      outcome = await executeCase(run, executionCase, message, options);
    }
  } else {
    outcome = await executeCase(run, executionCase, message, options);
  }

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
      input: executionCase.query,
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
  const maxReceiveCount = evalFanoutMaxReceiveCount();
  for (const record of recordsFromEvent(event)) {
    try {
      await handleMessage(parseEvalWorkerMessage(record.body), {
        finalReceive: isFinalSqsReceive(record, maxReceiveCount),
      });
    } catch (err) {
      console.error("[eval-worker] infrastructure failure:", err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
