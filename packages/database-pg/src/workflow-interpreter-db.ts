/**
 * DB adapter for the shared workflow interpreter (THINK-219). Lives in
 * database-pg (not packages/api) so packages/lambda and packages/api both
 * consume it without crossing the lambda->api boundary — the same seam as
 * ledger-db.ts.
 *
 * Semantics mirror packages/api/src/lib/workflows/routine-adapter.ts with two
 * deliberate differences:
 *  - Run creation happens BEFORE StartExecution, so idempotency is
 *    trigger-scoped (never the execution ARN).
 *  - Terminal projection only fires when the reported execution ARN matches
 *    the run's CURRENT backend_execution_id, so a rolled-over (superseded)
 *    execution's SUCCEEDED event can never terminalize a live run.
 */
import { and, eq, sql } from "drizzle-orm";

import {
  workflowEngineBindings,
  workflowEvidence,
  workflowRunEvents,
  workflowRuns,
  workflowTaskTokens,
  workflows,
} from "./schema";

// Same untyped-db convention as the api-side adapters: callable with either
// the resolver db or a Lambda getDb().
type WorkflowDb = any;

export const INTERPRETER_BINDING_TYPE = "step_functions_interpreter";

export const INTERPRETER_WORKFLOW_CAPABILITIES = {
  start: true,
  monitor: true,
  cancel: true,
  retry: false,
  replay: false,
  evidence: true,
};

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
]);

export const WORKFLOW_STEP_EVENT_TYPES = [
  "workflow_step_started",
  "workflow_step_finished",
  "workflow_step_failed",
  "workflow_policy_decision",
  "workflow_run_rollover",
  "workflow_approval_decision",
] as const;

export type WorkflowStepEventType = (typeof WORKFLOW_STEP_EVENT_TYPES)[number];

/**
 * Redaction-safe by construction: only these explicit scalar fields ever
 * reach payload_summary. Arbitrary nested payloads are dropped, not
 * serialized.
 */
export interface WorkflowStepEventSummary {
  stepId?: string;
  stepKind?: string;
  iteration?: number;
  status?: string;
  reason?: string;
  decision?: string;
  summary?: string;
  errorSummary?: string;
  durationMs?: number;
  nextIteration?: number;
  tokensUsed?: number;
  supersededExecutionArn?: string;
}

function safeSummary(
  input: WorkflowStepEventSummary | null | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  const scalarKeys: (keyof WorkflowStepEventSummary)[] = [
    "stepId",
    "stepKind",
    "iteration",
    "status",
    "reason",
    "decision",
    "summary",
    "errorSummary",
    "durationMs",
    "nextIteration",
    "tokensUsed",
    "supersededExecutionArn",
  ];
  for (const key of scalarKeys) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim().slice(0, 1000);
      if (trimmed) out[key] = trimmed;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export async function ensureInterpreterBinding(
  db: WorkflowDb,
  input: {
    tenantId: string;
    workflowId: string;
    workflowVersionId?: string | null;
    stateMachineArn: string;
    now?: Date;
  },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: workflowEngineBindings.id })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.workflow_id, input.workflowId),
        eq(workflowEngineBindings.binding_type, INTERPRETER_BINDING_TYPE),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const [row] = await db
    .insert(workflowEngineBindings)
    .values({
      tenant_id: input.tenantId,
      workflow_id: input.workflowId,
      workflow_version_id: input.workflowVersionId ?? null,
      binding_type: INTERPRETER_BINDING_TYPE,
      binding_status: "ready",
      readiness_state: "ready",
      connection_ref: { stateMachineArn: input.stateMachineArn },
      capability_flags: INTERPRETER_WORKFLOW_CAPABILITIES,
    })
    .returning({ id: workflowEngineBindings.id });
  return { id: row.id, created: true };
}

export interface CreateInterpreterRunInput {
  tenantId: string;
  workflowId: string;
  workflowVersionId: string | null;
  engineBindingId: string;
  triggerFamily: "manual" | "schedule" | "api" | "agent" | "webhook" | "event";
  triggerSource: string;
  /** Trigger-scoped basis, e.g. workflow_schedule:${triggerId}:${fireId}. */
  idempotencyKey: string;
  actorType?: string | null;
  actorId?: string | null;
  inputSummary?: Record<string, unknown> | null;
  now?: Date;
}

export async function createInterpreterWorkflowRun(
  db: WorkflowDb,
  input: CreateInterpreterRunInput,
): Promise<{ run: { id: string; status: string }; created: boolean }> {
  const now = input.now ?? new Date();
  const rows = await db
    .insert(workflowRuns)
    .values({
      tenant_id: input.tenantId,
      workflow_id: input.workflowId,
      workflow_version_id: input.workflowVersionId,
      engine_binding_id: input.engineBindingId,
      status: "queued",
      trigger_family: input.triggerFamily,
      trigger_source: input.triggerSource,
      idempotency_key: input.idempotencyKey,
      actor_type: input.actorType ?? null,
      actor_id: input.actorId ?? null,
      capability_snapshot: INTERPRETER_WORKFLOW_CAPABILITIES,
      readiness_snapshot: { state: "ready", reasons: [] },
      input_summary: input.inputSummary ?? {},
      last_event_at: now,
      created_at: now,
    })
    .onConflictDoNothing({
      target: [workflowRuns.tenant_id, workflowRuns.idempotency_key],
      // workflow_runs_tenant_idempotency_uidx is a PARTIAL unique index;
      // Postgres only matches ON CONFLICT to it when the target repeats the
      // index predicate. Without this, every insert errors with "no unique or
      // exclusion constraint matching the ON CONFLICT specification".
      targetWhere: sql`${workflowRuns.idempotency_key} IS NOT NULL`,
    })
    .returning({ id: workflowRuns.id, status: workflowRuns.status });

  if (rows.length > 0) {
    await db
      .update(workflows)
      .set({ last_run_id: rows[0].id, last_run_at: now, updated_at: now })
      .where(eq(workflows.id, input.workflowId));
    return { run: rows[0], created: true };
  }

  const [existing] = await db
    .select({ id: workflowRuns.id, status: workflowRuns.status })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenant_id, input.tenantId),
        eq(workflowRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(
      `workflow run insert conflicted but no existing row found for key ${input.idempotencyKey}`,
    );
  }
  return { run: existing, created: false };
}

/** Record the SFN execution once StartExecution succeeds. */
export async function markInterpreterRunStarted(
  db: WorkflowDb,
  input: {
    tenantId: string;
    workflowId: string;
    runId: string;
    executionArn: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(workflowRuns)
    .set({
      status: "running",
      backend_execution_id: input.executionArn,
      correlation_id: input.executionArn,
      started_at: now,
      last_event_at: now,
      updated_at: now,
    })
    .where(eq(workflowRuns.id, input.runId));

  await db.insert(workflowEvidence).values({
    tenant_id: input.tenantId,
    workflow_id: input.workflowId,
    workflow_run_id: input.runId,
    evidence_type: "step_functions_execution",
    source_system: "aws_step_functions",
    source_id: input.executionArn,
    uri: input.executionArn,
    summary: { role: "diagnostics", executionArn: input.executionArn },
    redaction_state: "summary_only",
  });
}

export async function recordWorkflowStepEvent(
  db: WorkflowDb,
  input: {
    tenantId: string;
    workflowRunId: string;
    eventType: WorkflowStepEventType;
    summary?: WorkflowStepEventSummary | null;
    runStatus?: string | null;
    /** Defaults to native_event; approval decisions pass operator_decision. */
    provenance?: "native_event" | "operator_decision";
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.insert(workflowRunEvents).values({
    tenant_id: input.tenantId,
    workflow_run_id: input.workflowRunId,
    event_type: input.eventType,
    event_status: input.summary?.status ?? null,
    provenance: input.provenance ?? "native_event",
    occurred_at: now,
    payload_summary: safeSummary(input.summary),
    created_at: now,
  });

  const patch: Record<string, unknown> = {
    last_event_at: now,
    updated_at: now,
  };
  if (input.runStatus) patch.status = input.runStatus;
  await db
    .update(workflowRuns)
    .set(patch)
    .where(eq(workflowRuns.id, input.workflowRunId));
}

export async function storeTaskToken(
  db: WorkflowDb,
  input: {
    tenantId: string;
    workflowRunId: string;
    stepId: string;
    iteration: number;
    purpose: "agent_step" | "approval";
    token: string;
    now?: Date;
  },
): Promise<void> {
  await db
    .insert(workflowTaskTokens)
    .values({
      tenant_id: input.tenantId,
      workflow_run_id: input.workflowRunId,
      step_id: input.stepId,
      iteration: input.iteration,
      purpose: input.purpose,
      token: input.token,
      status: "pending",
      created_at: input.now ?? new Date(),
    })
    .onConflictDoUpdate({
      target: [
        workflowTaskTokens.workflow_run_id,
        workflowTaskTokens.step_id,
        workflowTaskTokens.iteration,
        workflowTaskTokens.purpose,
      ],
      set: {
        token: input.token,
        status: "pending",
        consumed_at: null,
      },
    });
}

/**
 * Single-winner CAS consume: flips pending -> consumed and returns the token.
 * A second concurrent consumer gets null (already consumed).
 */
export async function consumeTaskToken(
  db: WorkflowDb,
  input: {
    workflowRunId: string;
    stepId: string;
    iteration: number;
    purpose: "agent_step" | "approval";
    now?: Date;
  },
): Promise<{ token: string } | null> {
  const rows = await db
    .update(workflowTaskTokens)
    .set({ status: "consumed", consumed_at: input.now ?? new Date() })
    .where(
      and(
        eq(workflowTaskTokens.workflow_run_id, input.workflowRunId),
        eq(workflowTaskTokens.step_id, input.stepId),
        eq(workflowTaskTokens.iteration, input.iteration),
        eq(workflowTaskTokens.purpose, input.purpose),
        eq(workflowTaskTokens.status, "pending"),
      ),
    )
    .returning({ token: workflowTaskTokens.token });
  if (!rows || rows.length === 0) return null;
  return { token: rows[0].token };
}

/**
 * Project an execution status change into the run — guarded twice: a terminal
 * run is never un-terminalized, and only the run's CURRENT execution ARN may
 * terminalize it (a superseded rollover ARN never can).
 */
export async function updateInterpreterRunFromExecution(
  db: WorkflowDb,
  input: {
    executionArn: string;
    status: "succeeded" | "failed" | "canceled" | "timed_out";
    errorSummary?: string | null;
    now?: Date;
  },
): Promise<{ runId: string } | null> {
  const now = input.now ?? new Date();
  const rows = await db
    .update(workflowRuns)
    .set({
      status: input.status,
      finished_at: now,
      last_event_at: now,
      updated_at: now,
      ...(input.errorSummary
        ? { error_message: input.errorSummary.slice(0, 1000) }
        : {}),
    })
    .where(
      and(
        eq(workflowRuns.backend_execution_id, input.executionArn),
        sql`${workflowRuns.status} NOT IN ('succeeded','failed','canceled','timed_out')`,
      ),
    )
    .returning({ id: workflowRuns.id });
  if (!rows || rows.length === 0) return null;
  return { runId: rows[0].id };
}

export function isTerminalWorkflowRunStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Repoint the run at the continue-as-new execution. CAS on the old ARN so a
 * late duplicate rollover cannot double-repoint.
 */
export async function recordInterpreterRollover(
  db: WorkflowDb,
  input: {
    tenantId: string;
    workflowRunId: string;
    oldExecutionArn: string;
    newExecutionArn: string;
    iteration: number;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const rows = await db
    .update(workflowRuns)
    .set({
      backend_execution_id: input.newExecutionArn,
      last_event_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(workflowRuns.id, input.workflowRunId),
        eq(workflowRuns.backend_execution_id, input.oldExecutionArn),
      ),
    )
    .returning({ id: workflowRuns.id });
  if (!rows || rows.length === 0) return false;

  await recordWorkflowStepEvent(db, {
    tenantId: input.tenantId,
    workflowRunId: input.workflowRunId,
    eventType: "workflow_run_rollover",
    summary: {
      iteration: input.iteration,
      supersededExecutionArn: input.oldExecutionArn,
      reason: "history_budget_rollover",
    },
    now,
  });
  return true;
}
