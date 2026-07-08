/**
 * Pure interpreter loop logic for the shared workflow interpreter
 * (THINK-219). No DB, no AWS — the step-dispatch Lambda and the api-side
 * finalize hook both consume this; DB effects live in
 * @thinkwork/database-pg (workflow-interpreter-db).
 */

import type {
  ContinuationPolicy,
  WorkflowDefinition,
  WorkflowStep,
} from "./workflow-definition";

/**
 * The only state Step Functions carries between interpreter states. The
 * database is the source of truth; the cursor is a pointer, never a payload.
 */
export interface InterpreterCursor {
  workflowRunId: string;
  tenantId: string;
  /** Index of the next step to dispatch within definition.steps. */
  stepPointer: number;
  /** 1-based loop iteration (increments when the policy decides continue). */
  iteration: number;
  /** Interpreter loop cycles executed in the CURRENT SFN execution. */
  loopCycleCount: number;
  /** Continue-as-new rollovers performed so far (infinite-restart guard). */
  rolloverCount: number;
}

/** Roll over well before the ~1,400-iteration event-history ceiling. */
export const ROLLOVER_CYCLE_THRESHOLD = 250;
/** Hard guard against a rollover loop that never terminates. */
export const MAX_ROLLOVERS = 40;

/** Step kinds the execute_step phase runs synchronously in-Lambda. */
export type ExecutableWorkflowStep = Extract<
  WorkflowStep,
  { kind: "routine" | "http" | "emit_event" }
>;

export type NextStepDirective =
  | { type: "dispatch_agent"; step: Extract<WorkflowStep, { kind: "agent" }> }
  | { type: "wait_until"; step: WorkflowStep; until: string }
  | { type: "execute_step"; step: ExecutableWorkflowStep }
  | {
      type: "approval_step";
      step: Extract<WorkflowStep, { kind: "approval" }>;
    }
  | { type: "unsupported_step"; step: WorkflowStep }
  | { type: "iteration_end" };

/**
 * Resolve what the interpreter does at the current cursor. `now` is injected
 * so wait resolution is deterministic in tests.
 *
 * routine/http/emit_event run synchronously in the step-dispatch Lambda
 * (execute_step); approval parks on a task token (approval_step). `tool`
 * validates but has no headless runner yet, so it returns unsupported_step
 * and the run fails cleanly in ThinkWork terms instead of misrouting.
 */
export function planNextStep(
  definition: WorkflowDefinition,
  cursor: InterpreterCursor,
  now: Date = new Date(),
): NextStepDirective {
  const step = definition.steps[cursor.stepPointer];
  if (!step) return { type: "iteration_end" };
  switch (step.kind) {
    case "agent":
      return { type: "dispatch_agent", step };
    case "wait": {
      const until =
        step.until ??
        new Date(
          now.getTime() + (step.durationSeconds ?? 0) * 1000,
        ).toISOString();
      return { type: "wait_until", step, until };
    }
    case "routine":
    case "http":
    case "emit_event":
      return { type: "execute_step", step };
    case "approval":
      return { type: "approval_step", step };
    case "tool":
      return { type: "unsupported_step", step };
    default: {
      const exhaustive: never = step;
      return { type: "unsupported_step", step: exhaustive as WorkflowStep };
    }
  }
}

export type WorkflowContinuationDecision =
  "complete" | "continue" | "human_needed" | "failed" | "budget_stopped";

export interface WorkflowGoalEvidence {
  /** Goal runtime status projected from the finalized turn. */
  status?: string | null;
  summary?: string | null;
  completionSummary?: string | null;
  tokensUsed?: number | null;
  budgetLimitedReason?: string | null;
  /** Explicit needs-a-human marker from the worker, when present. */
  needsHuman?: boolean | null;
}

export interface WorkflowContinuationResult {
  decision: WorkflowContinuationDecision;
  terminal: boolean;
  reason: string;
  /** Safe-scalar summary suitable for a workflow_policy_decision event. */
  summary: Record<string, unknown>;
}

const GOAL_COMPLETE_STATUSES = new Set(["complete", "completed", "cleared"]);

/**
 * Evaluate the continuation policy after an agent iteration. The interpreter
 * (not the goal runtime) owns the iteration budget; the goal runtime's token
 * budget only surfaces here as a budget_limited status.
 */
export function decideWorkflowContinuation(input: {
  policy: ContinuationPolicy | undefined;
  iteration: number;
  turnStatus: "completed" | "failed";
  evidence: WorkflowGoalEvidence | null;
}): WorkflowContinuationResult {
  const { policy, iteration, turnStatus, evidence } = input;
  const base = {
    iteration,
    exitSignal: policy?.exitSignal,
    maxIterations: policy?.maxIterations,
    goalStatus: evidence?.status ?? "missing",
    completionSummary: bounded(evidence?.completionSummary),
    summaryPreview: bounded(evidence?.summary),
    tokensUsed: evidence?.tokensUsed ?? undefined,
  };

  if (turnStatus === "failed") {
    return {
      decision: "failed",
      terminal: true,
      reason: "agent_turn_failed",
      summary: compact({ ...base, reason: "agent_turn_failed" }),
    };
  }

  if (evidence?.needsHuman) {
    return {
      decision: "human_needed",
      terminal: false,
      reason: "worker_requested_human",
      summary: compact({ ...base, reason: "worker_requested_human" }),
    };
  }

  if (evidence?.status === "budget_limited") {
    return {
      decision: "budget_stopped",
      terminal: true,
      reason: evidence.budgetLimitedReason || "token_budget_reached",
      summary: compact({
        ...base,
        reason: evidence.budgetLimitedReason || "token_budget_reached",
      }),
    };
  }

  if (evidence?.status && GOAL_COMPLETE_STATUSES.has(evidence.status)) {
    return {
      decision: "complete",
      terminal: true,
      reason: "exit_signal_satisfied",
      summary: compact({ ...base, reason: "exit_signal_satisfied" }),
    };
  }

  // No policy means a plain (non-looping) workflow: one pass and done.
  if (!policy) {
    return {
      decision: "complete",
      terminal: true,
      reason: "single_pass_complete",
      summary: compact({ ...base, reason: "single_pass_complete" }),
    };
  }

  if (iteration >= policy.maxIterations) {
    return {
      decision: "budget_stopped",
      terminal: true,
      reason: "max_iterations_reached",
      summary: compact({ ...base, reason: "max_iterations_reached" }),
    };
  }

  return {
    decision: "continue",
    terminal: false,
    reason: "exit_signal_not_met",
    summary: compact({
      ...base,
      reason: "exit_signal_not_met",
      nextIteration: iteration + 1,
    }),
  };
}

export interface RolloverPlan {
  rollOver: boolean;
  blocked?: "max_rollovers";
  nextCursor?: InterpreterCursor;
}

/**
 * Decide whether the current execution should continue-as-new. Callers must
 * only invoke this at a step boundary with no pending task token.
 */
export function planRollover(
  cursor: InterpreterCursor,
  threshold: number = ROLLOVER_CYCLE_THRESHOLD,
): RolloverPlan {
  if (cursor.loopCycleCount < threshold) return { rollOver: false };
  if (cursor.rolloverCount >= MAX_ROLLOVERS) {
    return { rollOver: false, blocked: "max_rollovers" };
  }
  return {
    rollOver: true,
    nextCursor: {
      ...cursor,
      loopCycleCount: 0,
      rolloverCount: cursor.rolloverCount + 1,
    },
  };
}

/** Advance the cursor after a completed step within the same iteration. */
export function advanceCursor(
  definition: WorkflowDefinition,
  cursor: InterpreterCursor,
  decision?: WorkflowContinuationDecision,
): InterpreterCursor {
  const cycled = { ...cursor, loopCycleCount: cursor.loopCycleCount + 1 };
  if (decision === "continue") {
    return { ...cycled, stepPointer: 0, iteration: cursor.iteration + 1 };
  }
  return { ...cycled, stepPointer: cursor.stepPointer + 1 };
}

function bounded(value: string | null | undefined, limit = 500) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
