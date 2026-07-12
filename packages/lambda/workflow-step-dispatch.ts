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
  approvalStepWaits,
  APPROVAL_OVERRIDE_OUTPUT_KEY,
  boundDocumentIdFromTargetSpec,
  buildWorkflowStepWakeupPayload,
  decideWorkflowContinuation,
  mergeApprovalOverrideIntoOptions,
  normalizeTargetSpec,
  planNextStep,
  planRollover,
  readWorkflowDefinition,
  resolveStepTemplates,
  sanitizeApprovalPlanOverride,
  type ExecutableWorkflowStep,
  type InterpreterCursor,
  type StepTemplateContext,
  type WorkflowDefinition,
  type WorkflowGoalEvidence,
} from "@thinkwork/agent-loops-core";
import {
  getDb,
  isTerminalWorkflowRunStatus,
  loadWorkflowStepOutputs,
  recordInterpreterRollover,
  recordWorkflowStepEvent,
  recordWorkflowStepOutput,
  storeTaskToken,
} from "@thinkwork/database-pg";
import {
  agentLoopVersions,
  agentLoops,
  agentWakeupRequests,
  artifacts as artifactsTable,
  workflowRunEvents,
  workflowRuns,
  workflowVersions,
  workflows,
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
  | "execute_step"
  | "await_approval"
  | "await_memory_stage"
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
  | { phase: "execute_step"; cursor: InterpreterCursor }
  | {
      phase: "record_advance";
      cursor: InterpreterCursor;
      stepResult?: AgentStepResult | null;
    }
  | { phase: "await_approval"; cursor: InterpreterCursor; taskToken: string }
  | {
      phase: "record_approval";
      cursor: InterpreterCursor;
      approval: {
        approved: boolean;
        note?: string | null;
        /** THINK-193 U3: approved-plan narrowing override (frozen protocol
         * shape from agent-loops-core; validated upstream by
         * resolveWorkflowApproval and re-sanitized here). */
        override?: unknown;
      };
    }
  | {
      phase: "await_memory_stage";
      cursor: InterpreterCursor;
      taskToken: string;
    }
  | {
      phase: "record_memory_stage";
      cursor: InterpreterCursor;
      result: MemoryStageWorkerResult;
    };

import type {
  MemoryStageWorkerInvokePayload,
  MemoryStageWorkerResult,
} from "@thinkwork/agent-loops-core";
export type { MemoryStageWorkerInvokePayload, MemoryStageWorkerResult };

// ---------------------------------------------------------------------------
// Loaders (ThinkWork-terms errors, never ASL / Step Functions vocabulary).
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  status: string;
  backend_execution_id: string | null;
  workflow_version_id: string | null;
  input_summary: Record<string, unknown> | null;
  /** THINK-193 U3: approval steps with a `when.triggerFamily` predicate gate
   * on this — a run whose family the predicate excludes records a visible
   * skipped approval and advances. */
  trigger_family: string | null;
  /** THINK-227 U4: the deliver step's new-edition gate compares the bound
   * document's last successful refresh against this. */
  started_at: Date | string | null;
}

async function loadRun(
  db: WorkflowDb,
  cursor: InterpreterCursor,
): Promise<RunRow> {
  const [run] = await db
    .select({
      id: workflowRuns.id,
      tenant_id: workflowRuns.tenant_id,
      workflow_id: workflowRuns.workflow_id,
      status: workflowRuns.status,
      backend_execution_id: workflowRuns.backend_execution_id,
      workflow_version_id: workflowRuns.workflow_version_id,
      input_summary: workflowRuns.input_summary,
      trigger_family: workflowRuns.trigger_family,
      started_at: workflowRuns.started_at,
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
  if (plan.type === "execute_step") {
    return { directive: "execute_step", cursor };
  }

  // Approval step: mark the run waiting BEFORE the machine parks on the task
  // token, so operators see the pending decision the moment the step starts.
  // A `when.triggerFamily` predicate that excludes this run's family records
  // a VISIBLE skipped approval instead and advances (THINK-193 U3, AE2): the
  // scheduled run proceeds inside its saved envelope with no human pause.
  if (plan.type === "approval_step") {
    if (!approvalStepWaits(plan.step, run.trigger_family)) {
      await recordWorkflowStepEvent(db, {
        tenantId: cursor.tenantId,
        workflowRunId: run.id,
        eventType: "workflow_approval_skipped",
        summary: {
          stepId: plan.step.id,
          stepKind: "approval",
          iteration: cursor.iteration,
          status: "skipped",
          reason: "trigger_family_not_reviewed",
          triggerFamily: run.trigger_family ?? undefined,
          summary: `plan review skipped: ${run.trigger_family} runs proceed inside the saved configuration without human review`,
        },
        runStatus: "running",
        now,
      });
      return await advanceAfterStepOutcome(db, {
        cursor,
        run,
        definition,
        step: plan.step,
        turnStatus: "completed",
        evidence: null,
        stepErrorSummary: undefined,
        // The skip event above IS the step's completion record.
        completionAlreadyRecorded: true,
        now,
      });
    }
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_started",
      summary: {
        stepId: plan.step.id,
        stepKind: "approval",
        iteration: cursor.iteration,
        status: "waiting",
        summary: plan.step.prompt,
      },
      runStatus: "waiting_for_human",
      now,
    });
    return { directive: "await_approval", cursor };
  }

  // Memory-stage step: the run stays running while the machine parks on the
  // task token and the async worker executes the pipeline stage.
  if (plan.type === "memory_stage_step") {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_started",
      summary: {
        stepId: plan.step.id,
        stepKind: "memory_stage",
        iteration: cursor.iteration,
        status: "running",
        summary: `memory pipeline stage "${plan.step.stage}"`,
      },
      runStatus: "running",
      now,
    });
    return { directive: "await_memory_stage", cursor };
  }

  // Step kinds that validate but are not yet executable (`tool` has no
  // headless runner yet) fail the run cleanly, in ThinkWork terms — never a
  // silent misroute.
  if (plan.type === "unsupported_step") {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_failed",
      summary: {
        stepId: plan.step.id,
        stepKind: plan.step.kind,
        iteration: cursor.iteration,
        status: "failed",
        reason: "step_kind_not_executable",
        errorSummary: `step "${plan.step.id}" has kind "${plan.step.kind}", which this workspace cannot execute yet`,
      },
      runStatus: "failed",
      now,
    });
    return { directive: "terminal_failure", cursor };
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
      // THINK-227 U2 (KTD2): the bound document rides the wakeup payload so
      // the emission reader enforces it — resolved LIVE from the source
      // automation's target_spec (KTD1), never from a definition snapshot.
      documentId: await resolveBoundDocumentId(db, run),
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

/**
 * THINK-227 U2: resolve the bound document for a workflow run — the live
 * `target_spec.documentBinding` of the automation this workflow converged
 * from (`workflows.source_agent_loop_id`, U13). Live resolution means run 1's
 * capture (U3) is visible to run 2 without republishing the definition.
 * Returns null for workflows with no source automation or no binding; a
 * malformed spec logs and degrades to unbound rather than failing the step.
 */
export async function resolveBoundDocumentId(
  db: WorkflowDb,
  run: Pick<RunRow, "id" | "workflow_id">,
): Promise<string | null> {
  const [workflow] = await db
    .select({ source_agent_loop_id: workflows.source_agent_loop_id })
    .from(workflows)
    .where(eq(workflows.id, run.workflow_id))
    .limit(1);
  if (!workflow?.source_agent_loop_id) return null;

  const [loop] = await db
    .select({ current_version_id: agentLoops.current_version_id })
    .from(agentLoops)
    .where(eq(agentLoops.id, workflow.source_agent_loop_id))
    .limit(1);
  if (!loop?.current_version_id) return null;

  const [version] = await db
    .select({ target_spec: agentLoopVersions.target_spec })
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.id, loop.current_version_id))
    .limit(1);
  if (!version?.target_spec) return null;

  try {
    return boundDocumentIdFromTargetSpec(
      normalizeTargetSpec(version.target_spec),
    );
  } catch (error) {
    console.warn(
      `[workflow-step-dispatch] run ${run.id}: source automation target_spec did not normalize (${(error as Error).message}); dispatching unbound`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 2b: execute_step — routine / http / emit_event run synchronously here
// (THINK-215). The step executes, its output lands as run evidence (feeding
// {{ steps.<id>.output.* }} for later steps), and the shared advance tail
// emits the next directive.
// ---------------------------------------------------------------------------

export interface StepExecutionOutcome {
  turnStatus: "completed" | "failed";
  errorSummary?: string;
  output?: unknown;
}

/** Default / ceiling for http step timeouts (seconds). */
const HTTP_STEP_DEFAULT_TIMEOUT_S = 30;
const HTTP_STEP_MAX_TIMEOUT_S = 300;
const HTTP_BODY_PREVIEW_CHARS = 2_000;

async function buildTemplateContext(
  db: WorkflowDb,
  run: RunRow,
): Promise<StepTemplateContext> {
  const input = (run.input_summary ?? {}) as Record<string, unknown>;
  return {
    // The trigger's caller payload folds into input_summary at trigger time
    // (buildInputSummary), so both roots read from the same record.
    trigger: { payload: input },
    run: { input },
    steps: await loadWorkflowStepOutputs(db, { workflowRunId: run.id }),
  };
}

export async function handleExecuteStep(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "execute_step" }>,
  now: Date = new Date(),
  executors: StepExecutors = defaultStepExecutors,
): Promise<DirectiveResult> {
  const { cursor } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  if (
    !step ||
    (step.kind !== "routine" &&
      step.kind !== "http" &&
      step.kind !== "emit_event" &&
      step.kind !== "deliver")
  ) {
    throw new Error(
      `workflow run ${run.id} step pointer ${cursor.stepPointer} is not an executable step — cannot run it`,
    );
  }

  // Idempotent retry: a prior completion event for this (step, iteration)
  // means the step already ran — do not execute side effects again; replay
  // the recorded outcome through the shared advance tail.
  const [priorCompletion] = await db
    .select({ event_type: workflowRunEvents.event_type })
    .from(workflowRunEvents)
    .where(
      and(
        eq(workflowRunEvents.workflow_run_id, run.id),
        sql`${workflowRunEvents.event_type} IN ('workflow_step_finished', 'workflow_step_failed')`,
        sql`${workflowRunEvents.payload_summary}->>'stepId' = ${step.id}`,
        sql`${workflowRunEvents.payload_summary}->>'iteration' = ${String(cursor.iteration)}`,
      ),
    )
    .limit(1);
  if (priorCompletion) {
    const replayedStatus =
      priorCompletion.event_type === "workflow_step_finished"
        ? ("completed" as const)
        : ("failed" as const);
    return await advanceAfterStepOutcome(db, {
      cursor,
      run,
      definition,
      step,
      turnStatus: replayedStatus,
      evidence: null,
      stepErrorSummary:
        replayedStatus === "failed" ? "step failed (recorded)" : undefined,
      completionAlreadyRecorded: true,
      now,
    });
  }

  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_step_started",
    summary: {
      stepId: step.id,
      stepKind: step.kind,
      iteration: cursor.iteration,
      status: "running",
    },
    runStatus: "running",
    now,
  });

  const context = await buildTemplateContext(db, run);
  const outcome =
    step.kind === "deliver"
      ? await executeDeliverStep(db, { run, step, executors, now })
      : await executeStep(step, context, executors);

  if (outcome.turnStatus === "completed" && outcome.output !== undefined) {
    await recordWorkflowStepOutput(db, {
      tenantId: cursor.tenantId,
      workflowId: run.workflow_id,
      workflowRunId: run.id,
      stepId: step.id,
      stepKind: step.kind,
      iteration: cursor.iteration,
      output: outcome.output,
      now,
    });
  }

  return await advanceAfterStepOutcome(db, {
    cursor,
    run,
    definition,
    step,
    turnStatus: outcome.turnStatus,
    evidence: null,
    stepErrorSummary: outcome.errorSummary,
    now,
  });
}

/**
 * Injectable side-effect boundary so unit tests never invoke Lambdas or the
 * network. Production uses defaultStepExecutors.
 */
export interface StepExecutors {
  invokeRoutine: (input: {
    routineId: string;
    input: Record<string, unknown>;
  }) => Promise<{
    status: string;
    executionId?: string | null;
    outputJson?: unknown;
    errorClass?: string;
    errorMessage?: string | null;
  }>;
  httpFetch: typeof fetch;
  /** THINK-227 U5 (KTD3): RequestResponse invoke of the artifact-deliver
   * Lambda's workflow-delivery mode. Never fire-and-forget. */
  invokeArtifactDeliver: (input: {
    tenantId: string;
    artifactId: string;
    recipients: string[];
    subjectTemplate?: string | null;
    idempotencyKey: string;
    workflowRunId: string;
  }) => Promise<{
    ok: boolean;
    delivery?: string;
    recipients?: string[];
    subject?: string | null;
    shareUrl?: string | null;
    error?: string | null;
  }>;
  /** External-memory-compounding U1: async Event invoke of the memory-stage
   * worker; the worker resumes the parked task token when the stage ends. */
  invokeMemoryStageWorker: (
    payload: MemoryStageWorkerInvokePayload,
  ) => Promise<void>;
}

export const defaultStepExecutors: StepExecutors = {
  invokeRoutine: async ({ routineId, input }) => {
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const explicit = process.env.ROUTINE_EXEC_GIT_FUNCTION_NAME;
    const stage = process.env.STAGE;
    const fnName =
      explicit ??
      (stage ? `thinkwork-${stage}-api-routine-exec-git` : undefined);
    if (!fnName) {
      throw new Error(
        "routine step cannot dispatch: ROUTINE_EXEC_GIT_FUNCTION_NAME / STAGE are unset",
      );
    }
    // RequestResponse and surface errors — never fire-and-forget.
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({ routineId, input, triggerSource: "workflow_step" }),
        ),
      }),
    );
    if (response.FunctionError) {
      return {
        status: "failed",
        errorClass: "routine_invoke_failed",
        errorMessage: `executor function error: ${response.FunctionError}`,
      };
    }
    const text = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : "";
    try {
      return text ? JSON.parse(text) : { status: "failed" };
    } catch {
      return {
        status: "failed",
        errorClass: "routine_invoke_failed",
        errorMessage: "executor returned malformed JSON",
      };
    }
  },
  httpFetch: fetch,
  invokeArtifactDeliver: async (input) => {
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const explicit = process.env.ARTIFACT_DELIVER_FUNCTION_NAME;
    const stage = process.env.STAGE;
    const fnName =
      explicit ??
      (stage ? `thinkwork-${stage}-api-artifact-deliver` : undefined);
    if (!fnName) {
      throw new Error(
        "deliver step cannot dispatch: ARTIFACT_DELIVER_FUNCTION_NAME / STAGE are unset",
      );
    }
    // RequestResponse and surface errors — never fire-and-forget (KTD3/KTD8).
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({ workflowDelivery: input }),
        ),
      }),
    );
    if (response.FunctionError) {
      return {
        ok: false,
        error: `delivery function error: ${response.FunctionError}`,
      };
    }
    const text = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : "";
    try {
      return text ? JSON.parse(text) : { ok: false, error: "empty response" };
    } catch {
      return { ok: false, error: "delivery returned malformed JSON" };
    }
  },
  invokeMemoryStageWorker: async (payload) => {
    const { LambdaClient, InvokeCommand } =
      await import("@aws-sdk/client-lambda");
    const lambda = new LambdaClient({});
    const explicit = process.env.MEMORY_STAGE_WORKER_FUNCTION_NAME;
    const stage = process.env.STAGE;
    const fnName =
      explicit ??
      (stage ? `thinkwork-${stage}-api-memory-stage-worker` : undefined);
    if (!fnName) {
      throw new Error(
        "memory_stage step cannot dispatch: MEMORY_STAGE_WORKER_FUNCTION_NAME / STAGE are unset",
      );
    }
    // Async Event invoke — the worker resumes the task token itself, so this
    // call only has to be accepted, never awaited to completion.
    await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
  },
};

/**
 * Deliver step (THINK-227 U4/U5). Sequence:
 *   1. Resolve the bound document from the source automation's live
 *      target_spec — no binding is a definition-level defect (validated at
 *      publish), so a missing one here fails loudly.
 *   2. New-edition gate (KTD4): the document's last successful refresh must
 *      postdate the run's start — a run whose agent step never finalized a
 *      new edition records `skipped_no_new_edition` and SUCCEEDS the step
 *      without sending (no new edition ⇒ nothing to mail; readers keep the
 *      last good edition).
 *   3. Invoke the artifact-deliver Lambda (RequestResponse) with the run id
 *      as idempotency key (KTD8) and convert its response into step evidence.
 */
async function executeDeliverStep(
  db: WorkflowDb,
  input: {
    run: RunRow;
    step: Extract<ExecutableWorkflowStep, { kind: "deliver" }>;
    executors: StepExecutors;
    now: Date;
  },
): Promise<StepExecutionOutcome> {
  const { run, step, executors } = input;
  const artifactId = await resolveBoundDocumentId(db, run);
  if (!artifactId) {
    return {
      turnStatus: "failed",
      errorSummary:
        "deliver step found no bound document — the automation's binding is unset or not yet captured",
    };
  }

  const [artifact] = await db
    .select({ last_refresh_at: artifactsTable.last_refresh_at })
    .from(artifactsTable)
    .where(
      and(
        eq(artifactsTable.id, artifactId),
        eq(artifactsTable.tenant_id, run.tenant_id),
      ),
    )
    .limit(1);
  if (!artifact) {
    return {
      turnStatus: "failed",
      errorSummary: `deliver step's bound document ${artifactId} no longer exists`,
    };
  }

  const startedAt = run.started_at ? new Date(run.started_at) : null;
  const refreshedAt = artifact.last_refresh_at
    ? new Date(artifact.last_refresh_at)
    : null;
  const hasNewEdition = Boolean(
    refreshedAt && (!startedAt || refreshedAt >= startedAt),
  );
  if (!hasNewEdition) {
    return {
      turnStatus: "completed",
      output: {
        delivery: "skipped_no_new_edition",
        artifactId,
        recipients: step.recipients.length,
      },
    };
  }

  let result: Awaited<ReturnType<StepExecutors["invokeArtifactDeliver"]>>;
  try {
    result = await executors.invokeArtifactDeliver({
      tenantId: run.tenant_id,
      artifactId,
      recipients: step.recipients,
      subjectTemplate: step.subjectTemplate ?? null,
      idempotencyKey: `workflow-run:${run.id}`,
      workflowRunId: run.id,
    });
  } catch (error) {
    return {
      turnStatus: "failed",
      errorSummary: `delivery invocation failed: ${boundedMessage(error)}`,
    };
  }
  if (!result.ok) {
    return {
      turnStatus: "failed",
      errorSummary: result.error ?? "delivery failed",
      output: {
        delivery: "failed",
        artifactId,
        recipients: step.recipients.length,
      },
    };
  }
  return {
    turnStatus: "completed",
    output: {
      delivery: result.delivery ?? "sent",
      artifactId,
      recipients: result.recipients?.length ?? step.recipients.length,
      subject: result.subject ?? null,
      shareUrl: result.shareUrl ?? null,
    },
  };
}

async function executeStep(
  step: Exclude<ExecutableWorkflowStep, { kind: "deliver" }>,
  context: StepTemplateContext,
  executors: StepExecutors,
): Promise<StepExecutionOutcome> {
  if (step.kind === "emit_event") {
    const resolved = resolveStepTemplates(step.payload ?? {}, context);
    if (!resolved.ok) return missingTemplates(resolved.missing);
    return {
      turnStatus: "completed",
      output: { eventType: step.eventType, payload: resolved.value },
    };
  }

  if (step.kind === "routine") {
    const resolved = resolveStepTemplates(step.input ?? {}, context);
    if (!resolved.ok) return missingTemplates(resolved.missing);
    let result: Awaited<ReturnType<StepExecutors["invokeRoutine"]>>;
    try {
      result = await executors.invokeRoutine({
        routineId: step.routineId,
        input: (resolved.value ?? {}) as Record<string, unknown>,
      });
    } catch (error) {
      return {
        turnStatus: "failed",
        errorSummary: `routine invocation failed: ${boundedMessage(error)}`,
      };
    }
    if (result.status !== "succeeded") {
      return {
        turnStatus: "failed",
        errorSummary:
          result.errorMessage ??
          result.errorClass ??
          `routine ended with status "${result.status}"`,
      };
    }
    return {
      turnStatus: "completed",
      output: {
        executionId: result.executionId ?? null,
        result: result.outputJson ?? null,
      },
    };
  }

  // http
  const resolved = resolveStepTemplates(
    {
      url: step.url,
      headers: step.headers ?? {},
      body: step.body,
    },
    context,
  );
  if (!resolved.ok) return missingTemplates(resolved.missing);
  const { url, headers, body } = resolved.value as {
    url: unknown;
    headers: Record<string, string>;
    body?: unknown;
  };
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return {
      turnStatus: "failed",
      errorSummary: `http step url did not resolve to an absolute http(s) URL`,
    };
  }
  const timeoutS = Math.min(
    step.timeoutSeconds ?? HTTP_STEP_DEFAULT_TIMEOUT_S,
    HTTP_STEP_MAX_TIMEOUT_S,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  try {
    const hasBody = body !== undefined && step.method !== "GET";
    const response = await executors.httpFetch(url, {
      method: step.method,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(hasBody
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    const bodyPreview = text.slice(0, HTTP_BODY_PREVIEW_CHARS);
    if (!response.ok) {
      return {
        turnStatus: "failed",
        errorSummary: `http step got ${response.status} from the endpoint`,
        output: { status: response.status, bodyPreview },
      };
    }
    return {
      turnStatus: "completed",
      output: { status: response.status, bodyPreview },
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      turnStatus: "failed",
      errorSummary: aborted
        ? `http step timed out after ${timeoutS}s`
        : `http step request failed: ${boundedMessage(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function missingTemplates(missing: string[]): StepExecutionOutcome {
  return {
    turnStatus: "failed",
    errorSummary: `step input references that did not resolve: ${missing.join(", ")}`,
  };
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
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

  return await advanceAfterStepOutcome(db, {
    cursor,
    run,
    definition,
    step,
    turnStatus,
    evidence,
    stepErrorSummary,
    now,
  });
}

/**
 * The shared tail of every step's lifecycle: record the completion, evaluate
 * the continuation policy at iteration end, and emit the next directive.
 * Consumed by record_advance (agent/wait), execute_step (routine/http/
 * emit_event), and record_approval's approval-step path.
 */
async function advanceAfterStepOutcome(
  db: WorkflowDb,
  input: {
    cursor: InterpreterCursor;
    run: RunRow;
    definition: WorkflowDefinition;
    step: WorkflowDefinition["steps"][number];
    turnStatus: "completed" | "failed";
    evidence: WorkflowGoalEvidence | null;
    stepErrorSummary: string | undefined;
    /** Replay path: the completion event already exists — never re-insert it. */
    completionAlreadyRecorded?: boolean;
    now: Date;
  },
): Promise<DirectiveResult> {
  const {
    cursor,
    run,
    definition,
    step,
    turnStatus,
    evidence,
    stepErrorSummary,
    completionAlreadyRecorded,
    now,
  } = input;
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

  // Non-final step: record the outcome, then either fail the run (a failed
  // step mid-pass must never silently continue) or advance the pointer. No
  // policy evaluation happens mid-pass.
  if (!isLastStep) {
    if (turnStatus === "failed") {
      if (record && !completionAlreadyRecorded) {
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
          runStatus: "failed",
          now,
        });
      }
      return { directive: "terminal_failure", cursor };
    }
    if (record && !completionAlreadyRecorded) {
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
  if (record && !completionAlreadyRecorded) {
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
  // An approval STEP stores its definition step id; the policy-driven
  // human_needed park (no approval step at the cursor) keeps the legacy
  // "approval" marker. Purpose stays "approval" for both so workflow-resume
  // finds the token the same way.
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  await storeTaskToken(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    stepId: step?.kind === "approval" ? step.id : "approval",
    iteration: cursor.iteration,
    purpose: "approval",
    token: taskToken,
    now,
  });
  // Run status stays waiting_for_human (set by the policy decision or the
  // approval step's load_next).
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
  // Two distinct approvals share this phase: an approval STEP (the cursor
  // points at a kind:"approval" step — the workflow moves to the NEXT step on
  // approve) and the policy-driven human_needed checkpoint (cursor points at
  // the iteration's last step — approve starts the next ITERATION).
  const step = definition.steps[cursor.stepPointer];
  const isApprovalStep = step?.kind === "approval";

  if (!approval.approved) {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_approval_decision",
      provenance: "operator_decision",
      summary: {
        stepId: isApprovalStep ? step.id : undefined,
        iteration: cursor.iteration,
        decision: "rejected",
        summary: approval.note ?? undefined,
      },
      runStatus: "canceled",
      now,
    });
    return { directive: "terminal_canceled", cursor };
  }

  // Approved-plan override (THINK-193 U3): a reviewer's narrowing rides the
  // resume payload. Sanitize into the frozen protocol shape; a malformed
  // override degrades to none (the mutation validated it — this is a second
  // fence, not the primary validator) and the stages' narrow-only semantics
  // hold regardless.
  let override: ReturnType<typeof sanitizeApprovalPlanOverride> = null;
  if (isApprovalStep && approval.override != null) {
    try {
      override = sanitizeApprovalPlanOverride(approval.override);
    } catch (error) {
      console.warn(
        `[workflow-step-dispatch] run ${run.id}: dropping malformed approval override: ${boundedMessage(error)}`,
      );
    }
  }

  await recordWorkflowStepEvent(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    eventType: "workflow_approval_decision",
    provenance: "operator_decision",
    summary: {
      stepId: isApprovalStep ? step.id : undefined,
      iteration: cursor.iteration,
      decision: "approved",
      summary: approval.note ?? undefined,
      ...(override
        ? {
            overrideSourceCount: override.sourceConfigIds?.length,
            overrideFocusCount: override.focusKeys?.length,
            overrideTimeFrom: override.timeRange?.from,
            overrideTimeTo: override.timeRange?.to,
            overrideMaxRecords: override.maxRecords,
          }
        : {}),
    },
    runStatus: "running",
    now,
  });

  // Persist the override as the approval step's OUTPUT so downstream
  // memory_stage dispatches (and the sweeper's payload reconstruction) merge
  // it into stage options — a skipped approval simply records no output.
  if (isApprovalStep && override) {
    await recordWorkflowStepOutput(db, {
      tenantId: cursor.tenantId,
      workflowId: run.workflow_id,
      workflowRunId: run.id,
      stepId: step.id,
      stepKind: step.kind,
      iteration: cursor.iteration,
      output: { [APPROVAL_OVERRIDE_OUTPUT_KEY]: override },
      now,
    });
  }

  if (isApprovalStep) {
    return await advanceAfterStepOutcome(db, {
      cursor,
      run,
      definition,
      step,
      turnStatus: "completed",
      evidence: null,
      stepErrorSummary: undefined,
      now,
    });
  }

  return await planContinue(db, {
    definition,
    cursor,
    run,
    record: true,
    now,
  });
}

// ---------------------------------------------------------------------------
// Phase 6: await_memory_stage (waitForTaskToken; parks) — external-memory-
// compounding U1. Stores the token FIRST (so the worker's SendTaskSuccess
// always finds it), then async-Event-invokes the memory-stage worker. An
// invoke failure records a step-failed event and rethrows — the machine must
// never park forever on a worker that was never started.
// ---------------------------------------------------------------------------

export async function handleAwaitMemoryStage(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "await_memory_stage" }>,
  now: Date = new Date(),
  executors: StepExecutors = defaultStepExecutors,
): Promise<ParkResult> {
  const { cursor, taskToken } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  if (!step || step.kind !== "memory_stage") {
    throw new Error(
      `workflow run ${run.id} step pointer ${cursor.stepPointer} is not a memory_stage step — cannot dispatch`,
    );
  }

  await storeTaskToken(db, {
    tenantId: cursor.tenantId,
    workflowRunId: run.id,
    stepId: step.id,
    iteration: cursor.iteration,
    purpose: "memory_stage",
    token: taskToken,
    now,
  });

  const failStep = async (errorSummary: string): Promise<never> => {
    await recordWorkflowStepEvent(db, {
      tenantId: cursor.tenantId,
      workflowRunId: run.id,
      eventType: "workflow_step_failed",
      summary: {
        stepId: step.id,
        stepKind: "memory_stage",
        iteration: cursor.iteration,
        status: "failed",
        errorSummary,
      },
      runStatus: "failed",
      now,
    });
    throw new Error(errorSummary);
  };

  // Resolve {{ }} templates in the step's config references the same way
  // executable steps resolve their inputs at dispatch time.
  const context = await buildTemplateContext(db, run);
  const resolved = resolveStepTemplates(
    {
      processorConfigId: step.processorConfigId,
      ...(step.sourceConfigId !== undefined
        ? { sourceConfigId: step.sourceConfigId }
        : {}),
      ...(step.options !== undefined ? { options: step.options } : {}),
    },
    context,
  );
  if (!resolved.ok) {
    return await failStep(
      `memory_stage step references that did not resolve: ${resolved.missing.join(", ")}`,
    );
  }
  const { processorConfigId, sourceConfigId, options } = resolved.value as {
    processorConfigId: unknown;
    sourceConfigId?: unknown;
    options?: Record<string, unknown>;
  };
  if (typeof processorConfigId !== "string" || !processorConfigId.trim()) {
    return await failStep(
      "memory_stage step's processorConfigId did not resolve to a non-empty string",
    );
  }

  // THINK-193 U3: fold an approved-plan override (persisted as an approval
  // step's output) into the stage options. Narrow-only enforcement happens
  // in the worker/stages; a skipped approval recorded no output, so
  // scheduled runs pass through unchanged.
  const optionsWithOverride = mergeApprovalOverrideIntoOptions(
    context.steps,
    options ?? null,
  );

  try {
    await executors.invokeMemoryStageWorker({
      workflowRunId: run.id,
      tenantId: cursor.tenantId,
      stepId: step.id,
      iteration: cursor.iteration,
      stage: step.stage,
      processorConfigId,
      sourceConfigId:
        typeof sourceConfigId === "string" && sourceConfigId
          ? sourceConfigId
          : null,
      options: optionsWithOverride,
    });
  } catch (error) {
    return await failStep(
      `memory stage worker could not be started: ${boundedMessage(error)}`,
    );
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 7: record_memory_stage — the worker's SendTaskSuccess result lands
// here. Succeeded records step output evidence (feeding
// {{ steps.<id>.output.* }}) and advances; failed records a step-failed event
// and fails the run through the shared advance tail.
// ---------------------------------------------------------------------------

export async function handleRecordMemoryStage(
  db: WorkflowDb,
  event: Extract<WorkflowStepDispatchEvent, { phase: "record_memory_stage" }>,
  now: Date = new Date(),
): Promise<DirectiveResult> {
  const { cursor, result } = event;
  const run = await loadRun(db, cursor);
  const definition = await loadDefinition(db, run);
  const step = definition.steps[cursor.stepPointer];
  if (!step || step.kind !== "memory_stage") {
    throw new Error(
      `workflow run ${run.id} step pointer ${cursor.stepPointer} is not a memory_stage step — cannot record its result`,
    );
  }

  const succeeded = result?.status === "succeeded";
  if (succeeded) {
    await recordWorkflowStepOutput(db, {
      tenantId: cursor.tenantId,
      workflowId: run.workflow_id,
      workflowRunId: run.id,
      stepId: step.id,
      stepKind: step.kind,
      iteration: cursor.iteration,
      output: {
        stage: result.stage,
        counts: result.counts ?? {},
        ...(result.output ?? {}),
      },
      now,
    });
  }

  return await advanceAfterStepOutcome(db, {
    cursor,
    run,
    definition,
    step,
    turnStatus: succeeded ? "completed" : "failed",
    evidence: null,
    stepErrorSummary: succeeded
      ? undefined
      : (result?.error ??
        `memory stage "${result?.stage ?? step.stage}" failed without an error summary`),
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
    case "execute_step":
      return await handleExecuteStep(db, event);
    case "record_advance":
      return await handleRecordAdvance(db, event);
    case "await_approval":
      return await handleAwaitApproval(db, event);
    case "record_approval":
      return await handleRecordApproval(db, event);
    case "await_memory_stage":
      return await handleAwaitMemoryStage(db, event);
    case "record_memory_stage":
      return await handleRecordMemoryStage(db, event);
    default: {
      const exhaustive: never = event;
      throw new Error(
        `unknown workflow step-dispatch phase: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
