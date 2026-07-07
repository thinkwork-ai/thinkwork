/**
 * Workflow interpreter step-dispatch Lambda (THINK-219 U5).
 *
 * The shared Step Functions interpreter invokes THIS single handler for every
 * phase of the loop body, discriminated by `event.phase`. State output
 * replaces `$` wholesale each cycle; the cursor is the only carried state and
 * the database is the source of truth.
 *
 * packages/lambda must NOT import @thinkwork/api (see job-trigger.ts) — this
 * consumes only @thinkwork/database-pg, @thinkwork/agent-loops-core, and the
 * AWS SDK. All per-phase logic is factored into exported functions taking a db
 * handle so unit tests inject a fake db; getDb() is called only in `handler`.
 */

import {
  advanceCursor,
  buildWorkflowStepWakeupPayload,
  decideWorkflowContinuation,
  planNextStep,
  planRollover,
  readWorkflowDefinition,
  type InterpreterCursor,
  type WorkflowDefinition,
  type WorkflowGoalEvidence,
} from "@thinkwork/agent-loops-core";
import {
  getDb,
  isTerminalWorkflowRunStatus,
  recordInterpreterRollover,
  recordWorkflowStepEvent,
  storeTaskToken,
} from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  workflowRunEvents,
  workflowRuns,
  workflowVersions,
} from "@thinkwork/database-pg/schema";
import { and, eq, sql } from "drizzle-orm";

// Same untyped-db convention as the api-side adapters and job-trigger.
type WorkflowDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Directives — mirror the terraform Choice-state routing (FROZEN protocol).
// ---------------------------------------------------------------------------

export type WorkflowDirective =
  | "dispatch_agent"
  | "wait_until"
  | "await_approval"
  | "continue"
  | "rollover"
  | "terminal_success"
  | "terminal_failure"
  | "terminal_canceled";

export interface DirectiveResult {
  directive: WorkflowDirective;
  cursor: InterpreterCursor;
  until?: string;
}

export interface ParkResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// Event shapes (state-output replaces `$` wholesale each cycle).
// ---------------------------------------------------------------------------

export interface AgentStepResult {
  turnStatus: "completed" | "failed";
  errorSummary?: string | null;
  evidence?: WorkflowGoalEvidence | null;
}

export type WorkflowStepDispatchEvent =
  | { phase: "load_next"; cursor: InterpreterCursor; executionArn: string }
  | { phase: "dispatch_agent"; cursor: InterpreterCursor; taskToken: string }
  | {
      phase: "record_advance";
      cursor: InterpreterCursor;
      stepResult?: AgentStepResult | null;
    }
  | { phase: "await_approval"; cursor: InterpreterCursor; taskToken: string }
  | {
      phase: "record_approval";
      cursor: InterpreterCursor;
      approval: { approved: boolean; note?: string | null };
    };

// ---------------------------------------------------------------------------
// Loaders (ThinkWork-terms errors, never ASL / Step Functions vocabulary).
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  tenant_id: string;
  status: string;
  backend_execution_id: string | null;
  workflow_version_id: string | null;
  input_summary: Record<string, unknown> | null;
}

async function loadRun(
  db: WorkflowDb,
  cursor: InterpreterCursor,
): Promise<RunRow> {
  const [run] = await db
    .select({
      id: workflowRuns.id,
      tenant_id: workflowRuns.tenant_id,
      status: workflowRuns.status,
      backend_execution_id: workflowRuns.backend_execution_id,
      workflow_version_id: workflowRuns.workflow_version_id,
      input_summary: workflowRuns.input_summary,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, cursor.workflowRunId))
    .limit(1);
  if (!run) {
    throw new Error(
      `workflow run ${cursor.workflowRunId} not found — cannot interpret a missing run`,
    );
  }
  // Tenant re-assert (KTD9): the cursor's tenant must match the stored run.
  if (run.tenant_id !== cursor.tenantId) {
    throw new Error(
      `workflow run ${cursor.workflowRunId} belongs to another tenant — refusing to interpret across tenants`,
    );
  }
  return run as RunRow;
}

async function loadDefinition(
  db: WorkflowDb,
  run: RunRow,
): Promise<WorkflowDefinition> {
  if (!run.workflow_version_id) {
    throw new Error(
      `workflow run ${run.id} has no published workflow version — nothing to interpret`,
    );
  }
  const [version] = await db
    .select({ definition_snapshot: workflowVersions.definition_snapshot })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, run.workflow_version_id))
    .limit(1);
  const definition = version
    ? readWorkflowDefinition(version.definition_snapshot)
    : null;
  if (!definition) {
    throw new Error(
      `workflow version ${run.workflow_version_id} does not hold a valid workflow definition`,
    );
  }
  return definition;
}

// ---------------------------------------------------------------------------
// Phase 1: load_next
// ---------------------------------------------------------------------------

export async function handleLoadNext(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "load_next" }>,
  now: Date = new Date(),
): Promise<DirectiveResult> {
  const { cursor, executionArn } = event;
  const run = await loadRun(db, cursor);

  if (isTerminalWorkflowRunStatus(run.status) || run.status === "canceled") {
    return { directive: "terminal_canceled", cursor };
  }

  // Rollover repoint: a continue-as-new execution adopts a run whose current
  // ARN is the superseded one. Tolerate a false return (a late duplicate).
  if (
    run.backend_execution_id &&
    run.backend_execution_id !== executionArn &&
    cursor.rolloverCount > 0
  ) {
    await recordInterpreterRollover(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      oldExecutionArn: run.backend_execution_id,
      newExecutionArn: executionArn,
      iteration: cursor.iteration,
      now,
    });
  }

  const definition = await loadDefinition(db, run);
  const plan = planNextStep(definition, cursor, now);

  if (plan.type === "dispatch_agent") {
    return { directive: "dispatch_agent", cursor };
  }
  if (plan.type === "wait_until") {
    return { directive: "wait_until", cursor, until: plan.until };
  }

  // iteration_end here means the pointer drifted out of range (record_advance
  // normally evaluates the iteration boundary). Fail loudly, in ThinkWork
  // terms, rather than silently looping.
  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_step_failed",
    summary: {
      iteration: cursor.iteration,
      status: "failed",
      reason: "cursor_out_of_range",
    },
    runStatus: "failed",
    now,
  });
  return { directive: "terminal_failure", cursor };
}

// ---------------------------------------------------------------------------
// Phase 2: dispatch_agent (invoked via .waitForTaskToken; return ignored)
// ---------------------------------------------------------------------------

export async function handleDispatchAgent(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "dispatch_agent" }>,
  now: Date = new Date(),
): Promise<ParkResult> {
  const { cursor, taskToken } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  if (!step || step.kind !== "agent") {
    throw new Error(
      `workflow run ${run.id} step pointer ${cursor.stepPointer} is not an agent step — cannot dispatch`,
    );
  }

  await storeTaskToken(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    stepId: step.id,
    iteration: cursor.iteration,
    purpose: "agent_step",
    token: taskToken,
    now,
  });

  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_step_started",
    summary: {
      stepId: step.id,
      stepKind: "agent",
      iteration: cursor.iteration,
      status: "running",
    },
    runStatus: "running",
    now,
  });

  const input = run.input_summary ?? {};
  const agentId = (input as { agentId?: unknown }).agentId;
  if (typeof agentId !== "string" || !agentId) {
    throw new Error(
      `workflow run ${run.id} has no agent to dispatch — the trigger must record the acting agent`,
    );
  }

  const idempotencyKey = `workflow-run:${run.id}:step:${step.id}:iteration:${cursor.iteration}`;
  const [existing] = await db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.tenant_id, cursor.tenantId),
        eq(agentWakeupRequests.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) {
    const workflowName = (input as { workflowName?: unknown }).workflowName;
    const spaceId = (input as { spaceId?: unknown }).spaceId;
    // Pi requires a human invoker (user_id) on every invocation; the trigger
    // paths record who started the run in input_summary.requestedByUserId and
    // each step's wakeup carries it as the requesting actor.
    const requestedByUserId = (input as { requestedByUserId?: unknown })
      .requestedByUserId;
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: run.id,
      workflowName: typeof workflowName === "string" ? workflowName : null,
      stepId: step.id,
      iteration: cursor.iteration,
      objective: step.objective,
      tokenBudget: step.tokenBudget,
      exitSignal: definition.continuationPolicy?.exitSignal,
      maxIterations: definition.continuationPolicy?.maxIterations,
      spaceId: typeof spaceId === "string" ? spaceId : null,
    });
    await db.insert(agentWakeupRequests).values({
      tenant_id: cursor.tenantId,
      agent_id: agentId,
      source: "workflow_step",
      reason: `workflow step ${step.id}`,
      payload,
      status: "queued",
      idempotency_key: idempotencyKey,
      ...(typeof requestedByUserId === "string" && requestedByUserId
        ? {
            requested_by_actor_type: "user",
            requested_by_actor_id: requestedByUserId,
          }
        : {}),
      requested_at: now,
      created_at: now,
    });
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 3: record_advance
// ---------------------------------------------------------------------------

export async function handleRecordAdvance(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "record_advance" }>,
  now: Date = new Date(),
): Promise<DirectiveResult> {
  const { cursor, stepResult } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  if (!step) {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_failed",
      summary: {
        iteration: cursor.iteration,
        status: "failed",
        reason: "cursor_out_of_range",
      },
      runStatus: "failed",
      now,
    });
    return { directive: "terminal_failure", cursor };
  }

  const isAgentStep = step.kind === "agent";
  let turnStatus: "completed" | "failed" = "completed";
  let evidence: WorkflowGoalEvidence | null = null;
  let stepErrorSummary: string | undefined;
  if (isAgentStep) {
    // Absent stepResult on an agent step (wait steps + Catch-routed failures)
    // is treated as a failed turn in ThinkWork terms.
    turnStatus = stepResult?.turnStatus ?? "failed";
    evidence = stepResult?.evidence ?? null;
    if (turnStatus === "failed") {
      stepErrorSummary =
        stepResult?.errorSummary ?? "agent step did not return a result";
    }
  }

  const isLastStep = cursor.stepPointer >= definition.steps.length - 1;

  // Idempotency dedupe: a prior policy decision for this (run, step, iteration)
  // means this record_advance is a retry. Skip every event insert and recompute
  // the directive purely — the decision is deterministic.
  const [priorDecision] = await db
    .select({ id: workflowRunEvents.id })
    .from(workflowRunEvents)
    .where(
      and(
        eq(workflowRunEvents.workflow_run_id, run.id),
        eq(workflowRunEvents.event_type, "workflow_policy_decision"),
        sql`${workflowRunEvents.payload_summary}->>'stepId' = ${step.id}`,
        sql`${workflowRunEvents.payload_summary}->>'iteration' = ${String(cursor.iteration)}`,
      ),
    )
    .limit(1);
  const record = !priorDecision;

  // Non-final step: record completion, advance the pointer, keep going. No
  // policy evaluation happens mid-pass.
  if (!isLastStep) {
    if (record) {
      await recordStepCompletion(db, {
        cursor,
        run,
        step,
        turnStatus,
        stepErrorSummary,
        now,
      });
    }
    return { directive: "continue", cursor: advanceCursor(definition, cursor) };
  }

  // Iteration end: record step completion, then evaluate the continuation
  // policy.
  if (record) {
    await recordStepCompletion(db, {
      cursor,
      run,
      step,
      turnStatus,
      stepErrorSummary,
      now,
    });
  }

  const result = decideWorkflowContinuation({
    policy: definition.continuationPolicy,
    iteration: cursor.iteration,
    turnStatus,
    evidence,
  });

  const decisionRunStatus =
    result.decision === "complete"
      ? "succeeded"
      : result.decision === "human_needed"
        ? "waiting_for_human"
        : result.decision === "failed" || result.decision === "budget_stopped"
          ? "failed"
          : null; // continue keeps the run running

  const decisionErrorSummary =
    result.decision === "failed" || result.decision === "budget_stopped"
      ? result.reason
      : undefined;

  if (record) {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_policy_decision",
      summary: {
        stepId: step.id,
        iteration: cursor.iteration,
        decision: result.decision,
        reason: result.reason,
        errorSummary: decisionErrorSummary,
        tokensUsed:
          typeof result.summary.tokensUsed === "number"
            ? result.summary.tokensUsed
            : undefined,
        nextIteration:
          typeof result.summary.nextIteration === "number"
            ? result.summary.nextIteration
            : undefined,
      },
      runStatus: decisionRunStatus,
      now,
    });
  }

  switch (result.decision) {
    case "complete":
      return { directive: "terminal_success", cursor };
    case "human_needed":
      return { directive: "await_approval", cursor };
    case "failed":
    case "budget_stopped":
      return { directive: "terminal_failure", cursor };
    case "continue":
      return await planContinue(db, {
        definition,
        cursor,
        run,
        record,
        now,
      });
  }
}

/**
 * Advance to the next iteration and decide whether to continue-as-new. Shared
 * by record_advance's continue decision and record_approval's approved path.
 */
async function planContinue(
  db: WorkflowDb,
  input: {
    definition: WorkflowDefinition;
    cursor: InterpreterCursor;
    run: RunRow;
    record: boolean;
    now: Date;
  },
): Promise<DirectiveResult> {
  const { definition, cursor, run, record, now } = input;
  const newCursor = advanceCursor(definition, cursor, "continue");
  const plan = planRollover(newCursor);
  if (plan.rollOver && plan.nextCursor) {
    return { directive: "rollover", cursor: plan.nextCursor };
  }
  if (plan.blocked === "max_rollovers") {
    if (record) {
      await recordWorkflowStepEvent(db, {
        tenantId: cursor.tenantId,
        workflowRunId: run.id,
        eventType: "workflow_step_failed",
        summary: {
          iteration: cursor.iteration,
          status: "failed",
          reason: "max_rollovers_guard",
        },
        runStatus: "failed",
        now,
      });
    }
    return { directive: "terminal_failure", cursor };
  }
  return { directive: "continue", cursor: newCursor };
}

async function recordStepCompletion(
  db: WorkflowDb,
  input: {
    cursor: InterpreterCursor;
    run: RunRow;
    step: WorkflowDefinition["steps"][number];
    turnStatus: "completed" | "failed";
    stepErrorSummary: string | undefined;
    now: Date;
  },
): Promise<void> {
  const { cursor, run, step, turnStatus, stepErrorSummary, now } = input;
  if (turnStatus === "failed") {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_failed",
      summary: {
        stepId: step.id,
        stepKind: step.kind,
        iteration: cursor.iteration,
        status: "failed",
        errorSummary: stepErrorSummary,
      },
      runStatus: null,
      now,
    });
    return;
  }
  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_step_finished",
    summary: {
      stepId: step.id,
      stepKind: step.kind,
      iteration: cursor.iteration,
      status: "completed",
    },
    runStatus: null,
    now,
  });
}

// ---------------------------------------------------------------------------
// Phase 4: await_approval (waitForTaskToken; parks)
// ---------------------------------------------------------------------------

export async function handleAwaitApproval(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "await_approval" }>,
  now: Date = new Date(),
): Promise<ParkResult> {
  const { cursor, taskToken } = event;
  const run = await loadRun(db, cursor);
  await storeTaskToken(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    stepId: "approval",
    iteration: cursor.iteration,
    purpose: "approval",
    token: taskToken,
    now,
  });
  // Run status stays waiting_for_human (already set by the policy decision).
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 5: record_approval
// ---------------------------------------------------------------------------

export async function handleRecordApproval(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "record_approval" }>,
  now: Date = new Date(),
): Promise<DirectiveResult> {
  const { cursor, approval } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);

  if (!approval.approved) {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_approval_decision",
      provenance: "operator_decision",
      summary: {
        iteration: cursor.iteration,
        decision: "rejected",
        summary: approval.note ?? undefined,
      },
      runStatus: "canceled",
      now,
    });
    return { directive: "terminal_canceled", cursor };
  }

  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_approval_decision",
    provenance: "operator_decision",
    summary: {
      iteration: cursor.iteration,
      decision: "approved",
      summary: approval.note ?? undefined,
    },
    runStatus: "running",
    now,
  });

  return await planContinue(db, {
    definition,
    cursor,
    run,
    record: true,
    now,
  });
}

// ---------------------------------------------------------------------------
// Handler — the only place getDb() is called.
// ---------------------------------------------------------------------------

export async function handler(
  event: WorkflowStepDispatchEvent,
): Promise<DirectiveResult | ParkResult> {
  const db = getDb();
  switch (event.phase) {
    case "load_next":
      return await handleLoadNext(db, event);
    case "dispatch_agent":
      return await handleDispatchAgent(db, event);
    case "record_advance":
      return await handleRecordAdvance(db, event);
    case "await_approval":
      return await handleAwaitApproval(db, event);
    case "record_approval":
      return await handleRecordApproval(db, event);
    default: {
      const exhaustive: never = event;
      throw new Error(
        `unknown workflow step-dispatch phase: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
