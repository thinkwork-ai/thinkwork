import {
  evaluateAssertions,
  scoreEvalOutcome,
  type EvalAssertion,
  type EvalAssertionResult,
  type EvalEvaluatorResult,
} from "@thinkwork/evals-core";
import path from "node:path";
import type { PiSidecarEvalRunPayload } from "../main/pi-sidecar-session.js";
import type { PiSidecarEvalWorkItem } from "../main/pi-sidecar-session.js";
import {
  runLocalDesktopTurn,
  type LocalDesktopTurnPayload,
  type LocalTurnRunnerDeps,
  type LocalTurnRunnerResult,
} from "./local-turn-runner.js";
import {
  createRedactedLogger,
  type RedactedLogger,
} from "./redacted-logger.js";

export interface EvalRunnerDeps {
  runTurn?: (
    payload: LocalDesktopTurnPayload,
    deps: LocalTurnRunnerDeps,
  ) => Promise<LocalTurnRunnerResult>;
  fetchImpl?: typeof fetch;
  logger?: RedactedLogger;
  now?: () => Date;
  signal?: AbortSignal;
  turnTimeoutMs?: number;
  evalConcurrency?: number;
  evalMaxAttempts?: number;
  evalRetryDelayMs?: number;
  debug?: boolean;
}

export interface EvalRunSummary {
  completed: number;
  failed: number;
  cancelled: boolean;
}

const DEFAULT_EVAL_MAX_ATTEMPTS = 2;
const DEFAULT_EVAL_RETRY_DELAY_MS = 750;

export async function runDesktopEvalRun(
  payload: PiSidecarEvalRunPayload,
  deps: EvalRunnerDeps = {},
): Promise<EvalRunSummary> {
  const logger = deps.logger ?? createRedactedLogger();
  const runTurn = deps.runTurn ?? runLocalDesktopTurn;
  const concurrency = normalizeEvalConcurrency(deps.evalConcurrency);
  const maxAttempts = normalizeEvalMaxAttempts(deps.evalMaxAttempts);
  let completed = 0;
  let failed = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!deps.signal?.aborted) {
      const item = payload.workItems[nextIndex];
      nextIndex += 1;
      if (!item) return;

      const result = await runCase(item);
      if (!result.counted) continue;
      completed += 1;
      if (result.failed) failed += 1;
    }
  }

  async function runCase(
    item: PiSidecarEvalWorkItem,
  ): Promise<{ counted: boolean; failed: boolean }> {
    const startedAt = deps.now?.() ?? new Date();
    try {
      logger.info("desktop eval case starting", {
        runId: payload.runId,
        testCaseId: item.testCaseId,
        index: item.index,
        category: item.category,
      });
      const result = await runEvalCaseTurn({
        payload,
        item,
        runTurn,
        deps,
        logger,
        maxAttempts,
      });
      if (deps.signal?.aborted) return { counted: false, failed: false };
      const durationMs = elapsedMs(startedAt, deps.now?.() ?? new Date());
      const output = result.output;
      const assertionResults = await evaluateAssertions(
        parseAssertions(item.assertions),
        output,
        item.query,
      );
      const evaluatorResults = skippedEvaluatorResults(
        item.agentcoreEvaluatorIds,
      );
      const errorMessage =
        result.status === "failed"
          ? (result.errorMessage ?? "Local Pi turn failed")
          : null;
      const outcome = scoreEvalOutcome({
        assertionResults,
        evaluatorResults,
        errorMessage,
      });
      await postCaseResult(
        payload,
        {
          testCaseId: item.testCaseId,
          status: outcome.status,
          score: outcome.score,
          durationMs,
          agentSessionId: item.session.threadTurnId,
          input: item.query,
          expected: item.systemPrompt,
          actualOutput: output,
          systemPrompt: item.session.invocation.system_prompt ?? null,
          evaluatorResults,
          assertions: assertionResults,
          errorMessage,
        },
        deps.fetchImpl ?? fetch,
      );
      logger.info("desktop eval case completed", {
        runId: payload.runId,
        testCaseId: item.testCaseId,
        status: outcome.status,
      });
      return { counted: true, failed: outcome.status !== "pass" };
    } catch (error) {
      if (deps.signal?.aborted) return { counted: false, failed: false };
      const durationMs = elapsedMs(startedAt, deps.now?.() ?? new Date());
      const message =
        error instanceof Error
          ? error.message
          : `Eval case failed: ${String(error)}`;
      logger.error("desktop eval case failed", {
        runId: payload.runId,
        testCaseId: item.testCaseId,
        error: message,
      });
      await postCaseResult(
        payload,
        {
          testCaseId: item.testCaseId,
          status: "error",
          score: null,
          durationMs,
          agentSessionId: item.session.threadTurnId,
          input: item.query,
          expected: item.systemPrompt,
          actualOutput: "",
          systemPrompt: item.session.invocation.system_prompt ?? null,
          evaluatorResults: skippedEvaluatorResults(item.agentcoreEvaluatorIds),
          assertions: [],
          errorMessage: message,
        },
        deps.fetchImpl ?? fetch,
      );
      return { counted: true, failed: true };
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, payload.workItems.length) },
      () => worker(),
    ),
  );

  return { completed, failed, cancelled: deps.signal?.aborted === true };
}

async function runEvalCaseTurn({
  payload,
  item,
  runTurn,
  deps,
  logger,
  maxAttempts,
}: {
  payload: PiSidecarEvalRunPayload;
  item: PiSidecarEvalWorkItem;
  runTurn: NonNullable<EvalRunnerDeps["runTurn"]>;
  deps: EvalRunnerDeps;
  logger: RedactedLogger;
  maxAttempts: number;
}): Promise<LocalTurnRunnerResult> {
  const turnPayload = {
    session: item.session,
    workspaceCacheRoot: evalCaseWorkspaceCacheRoot(payload, item),
  };
  const turnDeps = {
    signal: deps.signal,
    logger,
    fetchImpl: deps.fetchImpl,
    turnTimeoutMs: deps.turnTimeoutMs,
    evalMode: true,
    debug: deps.debug,
  };

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await runTurn(turnPayload, turnDeps);
      return result;
    } catch (error) {
      if (
        deps.signal?.aborted ||
        !shouldRetryLocalTurnError(error) ||
        attempt >= maxAttempts
      ) {
        throw error;
      }
      await waitBeforeRetry({ payload, item, attempt, deps, logger, error });
    }
  }
}

async function waitBeforeRetry({
  payload,
  item,
  attempt,
  deps,
  logger,
  error,
}: {
  payload: PiSidecarEvalRunPayload;
  item: PiSidecarEvalWorkItem;
  attempt: number;
  deps: EvalRunnerDeps;
  logger: RedactedLogger;
  error?: unknown;
}): Promise<void> {
  const delayMs =
    typeof deps.evalRetryDelayMs === "number" &&
    Number.isFinite(deps.evalRetryDelayMs)
      ? Math.max(0, deps.evalRetryDelayMs)
      : DEFAULT_EVAL_RETRY_DELAY_MS * attempt;
  logger.warn("desktop eval case retrying local Pi turn", {
    runId: payload.runId,
    testCaseId: item.testCaseId,
    attempt,
    nextAttempt: attempt + 1,
    delayMs,
    error: error instanceof Error ? error.message : String(error),
  });
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function shouldRetryLocalTurnError(error: unknown): boolean {
  return isRetryableEmptyAssistantError(
    error instanceof Error ? error.message : String(error),
  );
}

function isRetryableEmptyAssistantError(message: string | undefined): boolean {
  return (
    typeof message === "string" &&
    message
      .toLowerCase()
      .includes("assistant error turn with no assistant text")
  );
}

function parseAssertions(value: unknown): EvalAssertion[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is EvalAssertion => {
        if (!entry || typeof entry !== "object") return false;
        return typeof (entry as { type?: unknown }).type === "string";
      })
    : [];
}

function skippedEvaluatorResults(ids: string[]): EvalEvaluatorResult[] {
  return ids.map((id) => ({
    evaluator_id: id,
    source: "agentcore",
    value: null,
    label: null,
    explanation: "AgentCore built-in evaluator skipped for desktop-local run.",
    skipped: true,
  }));
}

async function postCaseResult(
  payload: PiSidecarEvalRunPayload,
  body: {
    testCaseId: string;
    status: "pass" | "fail" | "error";
    score: number | null;
    durationMs: number;
    agentSessionId: string | null;
    input: string;
    expected: string | null;
    actualOutput: string;
    systemPrompt: string | null;
    evaluatorResults: EvalEvaluatorResult[];
    assertions: EvalAssertionResult[];
    errorMessage: string | null;
  },
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(payload.resultCallback.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${payload.resultCallback.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Desktop eval callback failed (${response.status})`);
  }
}

function elapsedMs(startedAt: Date, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function normalizeEvalConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function normalizeEvalMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EVAL_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.min(3, Math.floor(value)));
}

function evalCaseWorkspaceCacheRoot(
  payload: PiSidecarEvalRunPayload,
  item: PiSidecarEvalWorkItem,
): string {
  return path.join(
    payload.workspaceCacheRoot,
    "eval-runs",
    payload.runId,
    item.testCaseId,
  );
}
