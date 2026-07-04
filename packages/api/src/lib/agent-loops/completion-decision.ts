import type { LoopPolicy } from "@thinkwork/agent-loops-core";
import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";

export type AgentLoopFinalRunStatus =
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "budget_stopped"
  | "escalated";

export type AgentLoopFinalIterationStatus =
  | "completed"
  | "failed"
  | "budget_stopped"
  | "waiting_for_human";

export type AgentLoopCompletionOutcome =
  | "complete"
  | "continue"
  | "failed"
  | "budget_stopped"
  | "escalated";

/**
 * The run-status projection decision (THINK-137 U10). This is NOT a judge — the
 * worker's own goal-run signal drives completion. It advances run/iteration
 * status and decides whether the loop enqueues another iteration. The judge /
 * evidence / ROI feature was removed; there is no judge verdict anymore.
 */
export interface AgentLoopCompletionDecision {
  outcome: AgentLoopCompletionOutcome;
  runStatus: AgentLoopFinalRunStatus;
  iterationStatus: AgentLoopFinalIterationStatus;
  terminal: boolean;
  enqueueNextIteration: boolean;
  terminalReason?: string | null;
  outputSummary: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface DecideAgentLoopCompletionInput {
  loopPolicy: LoopPolicy;
  iterationNumber: number;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  turnStatus?: "completed" | "failed";
  errorMessage?: string | null;
}

const RESPONSE_PREVIEW_LIMIT = 500;
const RATIONALE_LIMIT = 1000;

export function decideAgentLoopCompletion(
  input: DecideAgentLoopCompletionInput,
): AgentLoopCompletionDecision {
  if (input.turnStatus === "failed") {
    return terminalDecision({
      outcome: "failed",
      terminalReason: "worker_turn_failed",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun: input.goalRun,
      responseText: input.responseText,
      errorCode: "worker_turn_failed",
      errorMessage: bounded(input.errorMessage || "Worker turn failed."),
    });
  }

  const goalRun = input.goalRun;
  if (!goalRun) {
    return terminalDecision({
      outcome: "failed",
      terminalReason: "goal_run_missing",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun,
      responseText: input.responseText,
      errorCode: "goal_run_missing",
      errorMessage: "AgentLoop worker did not return goal-run evidence.",
    });
  }

  if (goalRun.debug?.error === "malformed_goal_run") {
    return terminalDecision({
      outcome: "failed",
      terminalReason: "malformed_goal_run",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun,
      responseText: input.responseText,
      errorCode: "malformed_goal_run",
      errorMessage: "AgentLoop worker returned malformed goal-run evidence.",
    });
  }

  const budgetReason = budgetStopReason(goalRun, input.loopPolicy);
  if (budgetReason) {
    return terminalDecision({
      outcome: "budget_stopped",
      terminalReason: "budget_stopped",
      runStatus: "budget_stopped",
      iterationStatus: "budget_stopped",
      goalRun,
      responseText: input.responseText,
      errorCode: "budget_stopped",
      errorMessage: budgetReason,
    });
  }

  if (
    goalRun.status === "complete" ||
    goalRun.status === "completed" ||
    goalRun.status === "cleared"
  ) {
    return terminalDecision({
      outcome: "complete",
      terminalReason: "goal_completed",
      runStatus: "completed",
      iterationStatus: "completed",
      goalRun,
      responseText: input.responseText,
    });
  }

  if (goalRun.status === "cancelled") {
    return terminalDecision({
      outcome: "failed",
      terminalReason: "goal_cancelled",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun,
      responseText: input.responseText,
      errorCode: "goal_cancelled",
      errorMessage: "AgentLoop goal was cancelled by the worker runtime.",
    });
  }

  if (input.iterationNumber >= input.loopPolicy.maxIterations) {
    return terminalDecision({
      outcome: input.loopPolicy.escalateOnFailure ? "escalated" : "failed",
      terminalReason: "max_iterations_reached",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun,
      responseText: input.responseText,
      errorCode: "max_iterations_reached",
      errorMessage: "AgentLoop reached its maximum iteration count.",
    });
  }

  return {
    outcome: "continue",
    runStatus: "running",
    iterationStatus: "completed",
    terminal: false,
    enqueueNextIteration: true,
    terminalReason: null,
    outputSummary: evidenceSummary(goalRun, input.responseText, {
      terminalReason: null,
      nextIteration: input.iterationNumber + 1,
    }),
  };
}

function terminalDecision(input: {
  outcome: AgentLoopCompletionOutcome;
  terminalReason: string;
  runStatus: AgentLoopFinalRunStatus;
  iterationStatus: AgentLoopFinalIterationStatus;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  errorCode?: string;
  errorMessage?: string;
}): AgentLoopCompletionDecision {
  return {
    outcome: input.outcome,
    runStatus: input.runStatus,
    iterationStatus: input.iterationStatus,
    terminal: true,
    enqueueNextIteration: false,
    terminalReason: input.terminalReason,
    outputSummary: evidenceSummary(input.goalRun, input.responseText, {
      terminalReason: input.terminalReason,
    }),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}

function evidenceSummary(
  goalRun: FinalizeGoalRunProjection | null,
  responseText: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return compact({
    source: goalRun?.source ?? "agent_loop_finalize",
    status: goalRun?.status ?? "missing",
    objective: goalRun?.objective,
    summary: goalRun?.summary,
    completionSummary: goalRun?.completion_summary,
    completionNotes: goalRun?.completion_notes,
    verificationNotes: goalRun?.verification_notes,
    tokensUsed: goalRun?.tokens_used,
    tokenBudget: goalRun?.token_budget,
    timeUsedSeconds: goalRun?.time_used_seconds,
    budgetLimitedReason: goalRun?.budget_limited_reason,
    responsePreview: bounded(responseText, RESPONSE_PREVIEW_LIMIT),
    ...extra,
  });
}

function budgetStopReason(
  goalRun: FinalizeGoalRunProjection,
  loopPolicy: LoopPolicy,
): string | null {
  if (goalRun.status === "budget_limited") {
    return (
      goalRun.budget_limited_reason || "AgentLoop goal budget was exhausted."
    );
  }
  if (
    loopPolicy.maxTokens !== undefined &&
    goalRun.tokens_used !== undefined &&
    goalRun.tokens_used >= loopPolicy.maxTokens
  ) {
    return "AgentLoop token budget was exhausted.";
  }
  if (
    loopPolicy.maxRuntimeMs !== undefined &&
    goalRun.time_used_seconds !== undefined &&
    goalRun.time_used_seconds * 1000 >= loopPolicy.maxRuntimeMs
  ) {
    return "AgentLoop runtime budget was exhausted.";
  }
  return null;
}

function failedRunStatus(loopPolicy: LoopPolicy): "failed" | "escalated" {
  return loopPolicy.escalateOnFailure || loopPolicy.failBehavior === "escalate"
    ? "escalated"
    : "failed";
}

function bounded(value: string, limit = RATIONALE_LIMIT): string {
  return value.trim().slice(0, limit);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
