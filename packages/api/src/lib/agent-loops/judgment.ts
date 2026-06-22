import type {
  JudgeSpec,
  JudgmentResult,
  LoopPolicy,
} from "@thinkwork/agent-loops-core";
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

export interface AgentLoopJudgmentDecision {
  judgment: JudgmentResult;
  runStatus: AgentLoopFinalRunStatus;
  iterationStatus: AgentLoopFinalIterationStatus;
  terminal: boolean;
  enqueueNextIteration: boolean;
  evidenceSummary: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface JudgeAgentLoopIterationInput {
  judgeSpec: JudgeSpec;
  loopPolicy: LoopPolicy;
  iterationNumber: number;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  turnStatus?: "completed" | "failed";
  errorMessage?: string | null;
}

const RESPONSE_PREVIEW_LIMIT = 500;
const RATIONALE_LIMIT = 1000;

export function judgeAgentLoopIteration(
  input: JudgeAgentLoopIterationInput,
): AgentLoopJudgmentDecision {
  if (input.turnStatus === "failed") {
    return terminalDecision({
      outcome: "failed",
      reason: bounded(input.errorMessage || "Worker turn failed."),
      terminalReason: "worker_turn_failed",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun: input.goalRun,
      responseText: input.responseText,
      errorCode: "worker_turn_failed",
      errorMessage: bounded(input.errorMessage || "Worker turn failed."),
    });
  }

  if (input.judgeSpec.mode === "model_judge") {
    return terminalDecision({
      outcome: "failed",
      reason: "AgentLoop model_judge is reserved for Phase 2.",
      terminalReason: "model_judge_unsupported_phase1",
      runStatus: failedRunStatus(input.loopPolicy),
      iterationStatus: "failed",
      goalRun: input.goalRun,
      responseText: input.responseText,
      errorCode: "model_judge_unsupported_phase1",
      errorMessage: "AgentLoop model_judge is reserved for Phase 2.",
    });
  }

  if (input.judgeSpec.mode === "human_approval") {
    return {
      judgment: judgmentResult({
        outcome: "needs_human_approval",
        reason:
          "Human approval is required before this AgentLoop can continue.",
        shouldContinue: false,
        terminalReason: "human_approval_required",
        goalRun: input.goalRun,
        responseText: input.responseText,
      }),
      runStatus: "waiting_for_human",
      iterationStatus: "waiting_for_human",
      terminal: true,
      enqueueNextIteration: false,
      evidenceSummary: evidenceSummary(input.goalRun, input.responseText, {
        terminalReason: "human_approval_required",
      }),
    };
  }

  const goalRun = input.goalRun;
  if (!goalRun) {
    return terminalDecision({
      outcome: "failed",
      reason: "AgentLoop worker did not return goal-run evidence.",
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
      reason: "AgentLoop worker returned malformed goal-run evidence.",
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
      reason: budgetReason,
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
      reason:
        goalRun.completion_summary ||
        goalRun.summary ||
        "AgentLoop goal completed.",
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
      reason: "AgentLoop goal was cancelled by the worker runtime.",
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
      reason: "AgentLoop reached its maximum iteration count.",
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
    judgment: judgmentResult({
      outcome: "continue",
      reason:
        goalRun.summary ||
        goalRun.completion_notes ||
        "AgentLoop goal remains active.",
      shouldContinue: true,
      goalRun,
      responseText: input.responseText,
    }),
    runStatus: "running",
    iterationStatus: "completed",
    terminal: false,
    enqueueNextIteration: true,
    evidenceSummary: evidenceSummary(goalRun, input.responseText, {
      terminalReason: null,
      nextIteration: input.iterationNumber + 1,
    }),
  };
}

function terminalDecision(input: {
  outcome: JudgmentResult["outcome"];
  reason: string;
  terminalReason: string;
  runStatus: AgentLoopFinalRunStatus;
  iterationStatus: AgentLoopFinalIterationStatus;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  errorCode?: string;
  errorMessage?: string;
}): AgentLoopJudgmentDecision {
  return {
    judgment: judgmentResult({
      outcome: input.outcome,
      reason: input.reason,
      shouldContinue: false,
      terminalReason: input.terminalReason,
      goalRun: input.goalRun,
      responseText: input.responseText,
    }),
    runStatus: input.runStatus,
    iterationStatus: input.iterationStatus,
    terminal: true,
    enqueueNextIteration: false,
    evidenceSummary: evidenceSummary(input.goalRun, input.responseText, {
      terminalReason: input.terminalReason,
    }),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}

function judgmentResult(input: {
  outcome: JudgmentResult["outcome"];
  reason: string;
  shouldContinue: boolean;
  terminalReason?: string;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
}): JudgmentResult {
  return {
    outcome: input.outcome,
    reason: bounded(input.reason),
    shouldContinue: input.shouldContinue,
    terminalReason: input.terminalReason,
    structuredOutput: evidenceSummary(input.goalRun, input.responseText, {
      terminalReason: input.terminalReason ?? null,
    }),
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
