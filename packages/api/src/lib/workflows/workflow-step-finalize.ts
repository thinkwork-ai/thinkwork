/**
 * Workflow-interpreter finalize hook (THINK-219 U6).
 *
 * Sibling of projectAgentLoopFinalize (agent-loops/finalize-projection.ts):
 * runs at end-of-turn from process-finalize for turns dispatched by a workflow
 * agent step. Where the agent-loop projection owns its own run/iteration
 * ledger, this hook's only job is to resume the parked Step Functions task
 * token so the shared interpreter (workflow-step-dispatch's record_advance
 * phase) can evaluate the continuation policy.
 *
 * The DB is the source of truth: the task token was stored by the interpreter
 * at dispatch (purpose 'agent_step'); we CAS-consume it exactly once and hand
 * the turn's evidence back to SFN. A retried finalize sees the token already
 * consumed and no-ops without a duplicate event.
 *
 * projectWorkflowStepFinalizeSafely mirrors the "safely" contract of its
 * agent-loop sibling: it never throws — a resume failure must not fail an
 * otherwise-finalized turn.
 */

import type { WorkflowGoalEvidence } from "@thinkwork/agent-loops-core";
import {
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";
import {
  consumeTaskToken,
  getDb,
  recordWorkflowStepEvent,
} from "@thinkwork/database-pg";
import type { FinalizeGoalRunProjection } from "../chat-finalize/types.js";

// Same untyped-db convention as the api-side adapters: callable with either
// the resolver db or a Lambda getDb().
type WorkflowDb = ReturnType<typeof getDb>;

// Module-scope client; warm Lambda invocations reuse the TCP pool. Tests
// `vi.mock('@aws-sdk/client-sfn', …)` to swap the constructor.
const _DEFAULT_SFN_CLIENT = new SFNClient({});

// AWS SFN error names meaning the token already resolved (a retry landed
// after the first resume, or the token timed out). Tolerated, never fatal.
const CONSUMED_ERROR_NAMES = new Set(["TaskDoesNotExist", "TaskTimedOut"]);

const EVENT_SUMMARY_LIMIT = 1000;
const TASK_CAUSE_LIMIT = 1000;

/** Result shape carries the resolved status through for tests + callers. */
export type WorkflowStepFinalizeResult =
  | { status: "skipped"; reason: string }
  | { status: "held"; reason: string }
  | {
      status: "already_consumed";
      runId: string;
      stepId: string;
      iteration: number;
    }
  | {
      status: "resumed";
      runId: string;
      stepId: string;
      iteration: number;
      turnStatus: "completed" | "failed";
    };

export interface WorkflowStepFinalizeContext {
  runId: string;
  stepId: string;
  iteration: number;
}

/**
 * Same input the agent-loop projection receives from process-finalize.
 * turnStatus is widened with the non-terminal "running" sentinel purely so
 * the HOLD guard below is expressible and testable — process-finalize only
 * ever passes "completed" | "failed".
 */
export interface ProjectWorkflowStepFinalizeInput {
  tenantId: string;
  threadTurnId: string;
  contextSnapshot: unknown;
  goalRun: FinalizeGoalRunProjection | null;
  responseText: string;
  turnStatus: "completed" | "failed" | "running";
  errorMessage?: string | null;
  now?: Date;
}

export interface ProjectWorkflowStepFinalizeOptions {
  db?: WorkflowDb;
  sfnClient?: SFNClient;
}

/**
 * Never-throws wrapper called from process-finalize. Logs + swallows so a
 * resume failure can't unwind an otherwise-finalized turn.
 */
export async function projectWorkflowStepFinalizeSafely(
  input: ProjectWorkflowStepFinalizeInput,
  options: ProjectWorkflowStepFinalizeOptions = {},
): Promise<WorkflowStepFinalizeResult | { status: "error" }> {
  try {
    return await projectWorkflowStepFinalize(input, options);
  } catch (err) {
    console.error(
      "[chat-finalize] Workflow step finalize projection failed:",
      err,
    );
    return { status: "error" };
  }
}

export async function projectWorkflowStepFinalize(
  input: ProjectWorkflowStepFinalizeInput,
  options: ProjectWorkflowStepFinalizeOptions = {},
): Promise<WorkflowStepFinalizeResult> {
  const ctx = workflowStepContextFromSnapshot(input.contextSnapshot);
  if (!ctx) {
    return { status: "skipped", reason: "not_workflow_step_turn" };
  }

  // HOLD: only a genuinely terminal turn resumes the interpreter. A turn still
  // running (or a goal awaiting user input mid-turn) leaves the task token
  // parked — no event, no consume, no SFN call. A later finalize resolves it.
  if (input.turnStatus !== "completed" && input.turnStatus !== "failed") {
    return { status: "held", reason: "turn_not_terminal" };
  }

  const db = options.db ?? getDb();
  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;
  const now = input.now ?? new Date();

  // Single-winner consume. A null means a prior finalize already resumed this
  // step (retry / duplicate) — no duplicate event, no second SFN send.
  const consumed = await consumeTaskToken(db, {
    workflowRunId: ctx.runId,
    stepId: ctx.stepId,
    iteration: ctx.iteration,
    purpose: "agent_step",
    now,
  });
  if (!consumed) {
    return {
      status: "already_consumed",
      runId: ctx.runId,
      stepId: ctx.stepId,
      iteration: ctx.iteration,
    };
  }

  if (input.turnStatus === "failed") {
    const errorSummary =
      boundedString(input.errorMessage) ?? "Workflow agent step failed.";
    await recordWorkflowStepEvent(db, {
      tenantId: input.tenantId,
      workflowRunId: ctx.runId,
      eventType: "workflow_step_failed",
      summary: {
        stepId: ctx.stepId,
        stepKind: "agent",
        iteration: ctx.iteration,
        status: "failed",
        errorSummary,
      },
      runStatus: null,
      now,
    });
    await sendTaskFailure(sfn, consumed.token, errorSummary);
    return {
      status: "resumed",
      runId: ctx.runId,
      stepId: ctx.stepId,
      iteration: ctx.iteration,
      turnStatus: "failed",
    };
  }

  const evidence = evidenceFromGoalRun(input.goalRun);
  await recordWorkflowStepEvent(db, {
    tenantId: input.tenantId,
    workflowRunId: ctx.runId,
    eventType: "workflow_step_finished",
    summary: {
      stepId: ctx.stepId,
      stepKind: "agent",
      iteration: ctx.iteration,
      status: "completed",
      summary:
        boundedString(evidence.completionSummary) ??
        boundedString(evidence.summary),
      tokensUsed:
        typeof evidence.tokensUsed === "number"
          ? evidence.tokensUsed
          : undefined,
    },
    runStatus: null,
    now,
  });

  // AgentStepResult contract (workflow-step-dispatch.ts): record_advance reads
  // $.stepResult = this JSON.
  const output = JSON.stringify({ turnStatus: "completed", evidence });
  await sendTaskSuccess(sfn, consumed.token, output);
  return {
    status: "resumed",
    runId: ctx.runId,
    stepId: ctx.stepId,
    iteration: ctx.iteration,
    turnStatus: "completed",
  };
}

/**
 * Key on contextSnapshot.workflowRun — the block the workflow-step wakeup
 * payload carries (buildWorkflowStepWakeupPayload), which the turn row's
 * context_snapshot spreads verbatim. Absent → not a workflow-step turn.
 */
export function workflowStepContextFromSnapshot(
  snapshot: unknown,
): WorkflowStepFinalizeContext | null {
  const record = asRecord(snapshot);
  const workflowRun = asRecord(record.workflowRun);
  const runId = stringValue(workflowRun.runId);
  const stepId = stringValue(workflowRun.stepId);
  const iteration = workflowRun.iteration;
  if (!runId || !stepId || typeof iteration !== "number") return null;
  return { runId, stepId, iteration };
}

/**
 * Project the finalized goal run into interpreter evidence. A goal status of
 * `paused` denotes the worker wants a human (resume_eligible pause) — map it
 * to needsHuman so decideWorkflowContinuation suspends the run to an approval
 * gate instead of looping. Every other status passes through verbatim; the
 * interpreter owns the complete/budget/continue decision.
 */
function evidenceFromGoalRun(
  goalRun: FinalizeGoalRunProjection | null,
): WorkflowGoalEvidence {
  if (!goalRun) return {};
  return {
    status: goalRun.status,
    summary: goalRun.summary ?? null,
    completionSummary: goalRun.completion_summary ?? null,
    tokensUsed: goalRun.tokens_used ?? null,
    budgetLimitedReason: goalRun.budget_limited_reason ?? null,
    needsHuman: goalRun.status === "paused" ? true : null,
  };
}

async function sendTaskSuccess(
  sfn: SFNClient,
  taskToken: string,
  output: string,
): Promise<void> {
  try {
    await sfn.send(new SendTaskSuccessCommand({ taskToken, output }));
  } catch (err) {
    if (isConsumedError(err)) {
      console.warn(
        "[chat-finalize] Workflow step token already resolved on SendTaskSuccess (tolerated).",
      );
      return;
    }
    throw err;
  }
}

async function sendTaskFailure(
  sfn: SFNClient,
  taskToken: string,
  cause: string,
): Promise<void> {
  try {
    await sfn.send(
      new SendTaskFailureCommand({
        taskToken,
        error: "WorkflowStepFailed",
        cause: cause.slice(0, TASK_CAUSE_LIMIT),
      }),
    );
  } catch (err) {
    if (isConsumedError(err)) {
      console.warn(
        "[chat-finalize] Workflow step token already resolved on SendTaskFailure (tolerated).",
      );
      return;
    }
    throw err;
  }
}

function isConsumedError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  return CONSUMED_ERROR_NAMES.has(name);
}

function boundedString(
  value: string | null | undefined,
  limit = EVENT_SUMMARY_LIMIT,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
