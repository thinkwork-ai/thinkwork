import {
  evaluateAssertions,
  scoreEvalOutcome,
  type EvalAssertion,
  type EvalAssertionResult,
  type EvalEvaluatorResult,
} from "@thinkwork/evals-core";
import type { PiSidecarEvalRunPayload } from "../main/pi-sidecar-session.js";
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
  debug?: boolean;
}

export interface EvalRunSummary {
  completed: number;
  failed: number;
  cancelled: boolean;
}

export async function runDesktopEvalRun(
  payload: PiSidecarEvalRunPayload,
  deps: EvalRunnerDeps = {},
): Promise<EvalRunSummary> {
  const logger = deps.logger ?? createRedactedLogger();
  const runTurn = deps.runTurn ?? runLocalDesktopTurn;
  let completed = 0;
  let failed = 0;

  for (const item of payload.workItems) {
    if (deps.signal?.aborted) {
      return { completed, failed, cancelled: true };
    }

    const startedAt = deps.now?.() ?? new Date();
    try {
      logger.info("desktop eval case starting", {
        runId: payload.runId,
        testCaseId: item.testCaseId,
        index: item.index,
        category: item.category,
      });
      const result = await runTurn(
        {
          session: item.session,
          workspaceCacheRoot: payload.workspaceCacheRoot,
        },
        {
          signal: deps.signal,
          logger,
          fetchImpl: deps.fetchImpl,
          turnTimeoutMs: deps.turnTimeoutMs,
          debug: deps.debug,
        },
      );
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
      const outcome = scoreEvalOutcome({
        assertionResults,
        evaluatorResults,
        errorMessage:
          result.status === "failed" ? "Local Pi turn failed" : null,
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
          errorMessage:
            result.status === "failed" ? "Local Pi turn failed" : null,
        },
        deps.fetchImpl ?? fetch,
      );
      completed += 1;
      if (outcome.status !== "pass") failed += 1;
      logger.info("desktop eval case completed", {
        runId: payload.runId,
        testCaseId: item.testCaseId,
        status: outcome.status,
      });
    } catch (error) {
      const durationMs = elapsedMs(startedAt, deps.now?.() ?? new Date());
      failed += 1;
      completed += 1;
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
    }
  }

  return { completed, failed, cancelled: false };
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
