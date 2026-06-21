import { and, eq, sql } from "drizzle-orm";
import {
  workflowEngineBindings,
  workflowEvidence,
  workflowRunEvents,
  workflowRuns,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";

type WorkflowDb = any;

export type RoutineWorkflowRoutine = {
  id: string;
  tenant_id: string;
  name?: string | null;
  description?: string | null;
  engine?: string | null;
  status?: string | null;
  visibility?: string | null;
  agent_id?: string | null;
  owning_agent_id?: string | null;
  state_machine_arn?: string | null;
  state_machine_alias_arn?: string | null;
  current_version?: number | null;
};

export type RoutineWorkflowAslVersion = {
  id: string;
  tenant_id?: string | null;
  routine_id?: string | null;
  version_number: number;
  state_machine_arn?: string | null;
  version_arn: string;
  asl_json?: unknown;
  markdown_summary?: string | null;
  step_manifest_json?: unknown;
  published_by_actor_type?: string | null;
  published_by_actor_id?: string | null;
  created_at?: Date | string | null;
};

export type RoutineWorkflowProjection = {
  workflowId: string;
  workflowVersionId: string | null;
  engineBindingId: string;
};

export type RoutineWorkflowRunInput = {
  routine: RoutineWorkflowRoutine;
  aslVersion: RoutineWorkflowAslVersion;
  projection: RoutineWorkflowProjection;
  executionArn: string;
  stateMachineArn: string;
  aliasArn?: string | null;
  routineExecutionId?: string | null;
  triggerFamily: "manual" | "schedule" | "api" | "agent" | "webhook" | "event";
  triggerSource: string;
  actorType?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  inputSummary?: Record<string, unknown> | null;
  startedAt?: Date | null;
};

export type RoutineExecutionWorkflowUpdate = {
  sfn_execution_arn: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  total_llm_cost_usd_cents: number | null;
  error_code: string | null;
  error_message: string | null;
  output_json: unknown;
};

export type RoutineStepWorkflowEvent = {
  tenant_id: string;
  execution_arn: string;
  node_id: string;
  recipe_type: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  input_json: unknown;
  output_json: unknown;
  error_json: unknown;
  llm_cost_usd_cents: number | null;
  retry_count: number;
  stdout_s3_uri: string | null;
  stderr_s3_uri: string | null;
  stdout_preview: string | null;
  truncated: boolean;
};

const ROUTINE_WORKFLOW_CAPABILITIES = {
  start: true,
  monitor: true,
  cancel: true,
  retry: false,
  replay: false,
  evidence: true,
};

const WORKFLOW_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
] as const;
const WORKFLOW_TERMINAL_STATUSES_SQL_LIST = sql.raw(
  WORKFLOW_TERMINAL_STATUSES.map((s) => `'${s}'`).join(","),
);

export async function ensureRoutineWorkflow(
  database: WorkflowDb,
  input: {
    routine: RoutineWorkflowRoutine;
    aslVersion?: RoutineWorkflowAslVersion | null;
    triggerFamily?: "manual" | "schedule";
  },
): Promise<RoutineWorkflowProjection> {
  const { routine, aslVersion } = input;
  const readiness = routineReadiness(routine, aslVersion);
  const lifecycleStatus = routineLifecycleStatus(routine, aslVersion);
  const visibility =
    routine.visibility === "tenant_shared" ? "tenant_shared" : "agent_private";
  const ownerAgentId = routine.owning_agent_id ?? routine.agent_id ?? null;

  const existingBindings = await dbSelect(database)
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
      workflow_version_id: workflowEngineBindings.workflow_version_id,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, routine.tenant_id),
        eq(workflowEngineBindings.routine_id, routine.id),
      ),
    )
    .limit(1);

  const existingBinding = existingBindings[0];
  if (existingBinding) {
    const version = aslVersion
      ? await ensureWorkflowVersion(database, {
          routine,
          aslVersion,
          workflowId: existingBinding.workflow_id,
        })
      : null;
    await updateWorkflowIdentity(database, {
      routine,
      workflowId: existingBinding.workflow_id,
      workflowVersionId: version?.id ?? existingBinding.workflow_version_id,
      lifecycleStatus,
      readiness,
      visibility,
      ownerAgentId,
    });
    if (version) {
      await dbUpdate(database)
        .update(workflowEngineBindings)
        .set({
          workflow_version_id: version.id,
          routine_asl_version_id: aslVersion?.id ?? null,
          external_workflow_name: routine.name ?? null,
          external_version_id: aslVersion
            ? String(aslVersion.version_number)
            : null,
          connection_ref: {
            stateMachineArn: routine.state_machine_arn ?? null,
            aliasArn: routine.state_machine_alias_arn ?? null,
          },
          binding_status: readiness.bindingStatus,
          capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
          readiness_state: readiness.state,
          readiness_reasons: readiness.reasons,
          updated_at: new Date(),
        })
        .where(eq(workflowEngineBindings.id, existingBinding.id));
    }
    await ensureWorkflowTrigger(database, {
      routine,
      workflowId: existingBinding.workflow_id,
      workflowVersionId: version?.id ?? existingBinding.workflow_version_id,
      triggerFamily: input.triggerFamily ?? "manual",
      readiness,
    });
    return {
      workflowId: existingBinding.workflow_id,
      workflowVersionId: version?.id ?? existingBinding.workflow_version_id,
      engineBindingId: existingBinding.id,
    };
  }

  const workflowRows = await dbInsert(database)
    .insert(workflows)
    .values({
      tenant_id: routine.tenant_id,
      name: routine.name ?? "Untitled routine",
      slug: routineWorkflowSlug(routine.id),
      description: routine.description ?? null,
      lifecycle_status: lifecycleStatus,
      visibility,
      owner_agent_id: ownerAgentId,
      primary_trigger_family: input.triggerFamily ?? "manual",
      capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_state: readiness.state,
      readiness_reasons: readiness.reasons,
    })
    .returning({ id: workflows.id });
  const workflowId = workflowRows[0].id;

  const version = aslVersion
    ? await ensureWorkflowVersion(database, { routine, aslVersion, workflowId })
    : null;

  if (version) {
    await dbUpdate(database)
      .update(workflows)
      .set({
        current_version_id: version.id,
        current_version_number: aslVersion?.version_number ?? null,
        updated_at: new Date(),
      })
      .where(eq(workflows.id, workflowId));
  }

  const bindingRows = await dbInsert(database)
    .insert(workflowEngineBindings)
    .values({
      tenant_id: routine.tenant_id,
      workflow_id: workflowId,
      workflow_version_id: version?.id ?? null,
      binding_type: "step_functions_routine",
      binding_status: readiness.bindingStatus,
      routine_id: routine.id,
      routine_asl_version_id: aslVersion?.id ?? null,
      external_workflow_id: routine.id,
      external_workflow_name: routine.name ?? null,
      external_version_id: aslVersion
        ? String(aslVersion.version_number)
        : routine.current_version
          ? String(routine.current_version)
          : null,
      connection_ref: {
        stateMachineArn: routine.state_machine_arn ?? null,
        aliasArn: routine.state_machine_alias_arn ?? null,
      },
      capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_state: readiness.state,
      readiness_reasons: readiness.reasons,
    })
    .returning({ id: workflowEngineBindings.id });

  await ensureWorkflowTrigger(database, {
    routine,
    workflowId,
    workflowVersionId: version?.id ?? null,
    triggerFamily: input.triggerFamily ?? "manual",
    readiness,
  });

  return {
    workflowId,
    workflowVersionId: version?.id ?? null,
    engineBindingId: bindingRows[0].id,
  };
}

export async function createRoutineWorkflowRun(
  database: WorkflowDb,
  input: RoutineWorkflowRunInput,
): Promise<{ id: string }> {
  const startedAt = input.startedAt ?? new Date();
  const idempotencyKey =
    input.idempotencyKey ?? `routine-execution:${input.executionArn}`;
  const runRows = await dbInsert(database)
    .insert(workflowRuns)
    .values({
      tenant_id: input.routine.tenant_id,
      workflow_id: input.projection.workflowId,
      workflow_version_id: input.projection.workflowVersionId,
      engine_binding_id: input.projection.engineBindingId,
      status: "running",
      trigger_family: input.triggerFamily,
      trigger_source: input.triggerSource,
      actor_type: input.actorType ?? null,
      actor_id: input.actorId ?? null,
      idempotency_key: idempotencyKey,
      correlation_id: input.correlationId ?? input.executionArn,
      backend_execution_id: input.executionArn,
      backend_execution_ref: {
        routineId: input.routine.id,
        routineExecutionId: input.routineExecutionId ?? null,
        stateMachineArn: input.stateMachineArn,
        aliasArn: input.aliasArn ?? null,
        versionArn: input.aslVersion.version_arn,
        routineAslVersionId: input.aslVersion.id,
      },
      capability_snapshot: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_snapshot: { state: "ready", reasons: [] },
      input_summary: input.inputSummary ?? null,
      started_at: startedAt,
      last_event_at: startedAt,
    })
    .returning({ id: workflowRuns.id });
  const run = runRows[0];

  await dbUpdate(database)
    .update(workflows)
    .set({
      last_run_id: run.id,
      last_run_at: startedAt,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.projection.workflowId));

  await dbInsert(database)
    .insert(workflowEvidence)
    .values({
      tenant_id: input.routine.tenant_id,
      workflow_id: input.projection.workflowId,
      workflow_run_id: run.id,
      evidence_type: "step_functions_execution",
      source_system: "aws_step_functions",
      source_id: input.executionArn,
      uri: input.executionArn,
      summary: {
        routineId: input.routine.id,
        routineExecutionId: input.routineExecutionId ?? null,
        stateMachineArn: input.stateMachineArn,
        aliasArn: input.aliasArn ?? null,
        versionArn: input.aslVersion.version_arn,
        routineAslVersionId: input.aslVersion.id,
      },
      redaction_state: "summary_only",
    });

  return run;
}

export async function updateRoutineWorkflowRunFromExecution(
  database: WorkflowDb,
  row: RoutineExecutionWorkflowUpdate,
): Promise<void> {
  const status = workflowStatusFromRoutineStatus(row.status);
  const now = new Date();
  const setClause: Record<string, unknown> = {
    status,
    last_event_at: row.finished_at ?? row.started_at ?? now,
    updated_at: now,
  };
  if (row.started_at !== null) setClause.started_at = row.started_at;
  if (row.finished_at !== null) setClause.finished_at = row.finished_at;
  if (row.total_llm_cost_usd_cents !== null) {
    setClause.total_cost_usd_cents = row.total_llm_cost_usd_cents;
  }
  if (row.error_code !== null) setClause.error_code = row.error_code;
  if (row.error_message !== null) setClause.error_message = row.error_message;
  if (row.output_json !== null) {
    setClause.output_summary = summarizeJson(row.output_json);
  }

  const updatedRuns = await dbUpdate(database)
    .update(workflowRuns)
    .set(setClause)
    .where(
      and(
        eq(workflowRuns.backend_execution_id, row.sfn_execution_arn),
        sql`(${workflowRuns.status} NOT IN (${WORKFLOW_TERMINAL_STATUSES_SQL_LIST})
              OR ${workflowRuns.status} = ${status})`,
      ),
    )
    .returning({
      id: workflowRuns.id,
      tenant_id: workflowRuns.tenant_id,
    });

  const run = updatedRuns[0];
  if (!run) return;

  await dbInsert(database)
    .insert(workflowRunEvents)
    .values({
      tenant_id: run.tenant_id,
      workflow_run_id: run.id,
      event_type: "routine_execution",
      event_status: status,
      provenance: "engine_history",
      occurred_at: row.finished_at ?? row.started_at ?? now,
      message: `Routine execution ${status}`,
      payload_summary: {
        executionArn: row.sfn_execution_arn,
        errorCode: row.error_code,
        hasOutput: row.output_json !== null,
      },
      evidence_ref: { sourceSystem: "aws_step_functions" },
    });
}

export async function recordRoutineWorkflowStepEvent(
  database: WorkflowDb,
  shaped: RoutineStepWorkflowEvent,
  routineStepEventId: number,
): Promise<void> {
  const runs = await dbSelect(database)
    .select({
      id: workflowRuns.id,
      tenant_id: workflowRuns.tenant_id,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenant_id, shaped.tenant_id),
        eq(workflowRuns.backend_execution_id, shaped.execution_arn),
      ),
    )
    .limit(1);
  const run = runs[0];
  if (!run) return;

  const occurredAt = shaped.finished_at ?? shaped.started_at ?? new Date();
  await dbInsert(database)
    .insert(workflowRunEvents)
    .values({
      tenant_id: run.tenant_id,
      workflow_run_id: run.id,
      event_type: "routine_step",
      event_status: workflowStatusFromRoutineStatus(shaped.status),
      provenance: "app_callback",
      occurred_at: occurredAt,
      message: `${shaped.node_id} ${shaped.status}`,
      payload_summary: {
        nodeId: shaped.node_id,
        recipeType: shaped.recipe_type,
        retryCount: shaped.retry_count,
        llmCostUsdCents: shaped.llm_cost_usd_cents,
        truncated: shaped.truncated,
        hasInput: shaped.input_json !== null,
        hasOutput: shaped.output_json !== null,
        hasError: shaped.error_json !== null,
        stdoutS3Uri: shaped.stdout_s3_uri,
        stderrS3Uri: shaped.stderr_s3_uri,
      },
      evidence_ref: { routineStepEventId },
    });

  await dbUpdate(database)
    .update(workflowRuns)
    .set({ last_event_at: occurredAt, updated_at: new Date() })
    .where(eq(workflowRuns.id, run.id));
}

export function routineWorkflowSlug(routineId: string): string {
  return `routine-${routineId}`;
}

export function workflowStatusFromRoutineStatus(status: string): string {
  if (status === "cancelled") return "canceled";
  if (status === "awaiting_approval") return "running";
  return status;
}

async function ensureWorkflowVersion(
  database: WorkflowDb,
  input: {
    routine: RoutineWorkflowRoutine;
    aslVersion: RoutineWorkflowAslVersion;
    workflowId: string;
  },
): Promise<{ id: string }> {
  const existing = await dbSelect(database)
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflow_id, input.workflowId),
        eq(workflowVersions.version_number, input.aslVersion.version_number),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const rows = await dbInsert(database)
    .insert(workflowVersions)
    .values({
      tenant_id: input.routine.tenant_id,
      workflow_id: input.workflowId,
      version_number: input.aslVersion.version_number,
      version_status: "active",
      source_kind: "step_functions_routine",
      source_metadata: {
        routineId: input.routine.id,
        stateMachineArn:
          input.aslVersion.state_machine_arn ??
          input.routine.state_machine_arn ??
          null,
        versionArn: input.aslVersion.version_arn,
      },
      definition_snapshot: {
        routineId: input.routine.id,
        routineName: input.routine.name ?? null,
        asl: input.aslVersion.asl_json ?? null,
        markdownSummary: input.aslVersion.markdown_summary ?? null,
        stepManifest: input.aslVersion.step_manifest_json ?? null,
      },
      capability_snapshot: ROUTINE_WORKFLOW_CAPABILITIES,
      routine_asl_version_id: input.aslVersion.id,
      created_by_actor_type: input.aslVersion.published_by_actor_type ?? null,
      created_by_actor_id: input.aslVersion.published_by_actor_id ?? null,
      published_at: input.aslVersion.created_at
        ? new Date(input.aslVersion.created_at)
        : new Date(),
    })
    .returning({ id: workflowVersions.id });
  return rows[0];
}

async function updateWorkflowIdentity(
  database: WorkflowDb,
  input: {
    routine: RoutineWorkflowRoutine;
    workflowId: string;
    workflowVersionId: string | null;
    lifecycleStatus: string;
    readiness: RoutineReadiness;
    visibility: "agent_private" | "tenant_shared";
    ownerAgentId: string | null;
  },
): Promise<void> {
  await dbUpdate(database)
    .update(workflows)
    .set({
      name: input.routine.name ?? "Untitled routine",
      description: input.routine.description ?? null,
      lifecycle_status: input.lifecycleStatus,
      visibility: input.visibility,
      owner_agent_id: input.ownerAgentId,
      current_version_id: input.workflowVersionId,
      current_version_number: input.routine.current_version ?? null,
      capability_flags: ROUTINE_WORKFLOW_CAPABILITIES,
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.workflowId));
}

async function ensureWorkflowTrigger(
  database: WorkflowDb,
  input: {
    routine: RoutineWorkflowRoutine;
    workflowId: string;
    workflowVersionId: string | null;
    triggerFamily: "manual" | "schedule";
    readiness: RoutineReadiness;
  },
): Promise<void> {
  const existing = await dbSelect(database)
    .select({ id: workflowTriggers.id })
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.workflow_id, input.workflowId),
        eq(workflowTriggers.trigger_family, input.triggerFamily),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await dbUpdate(database)
      .update(workflowTriggers)
      .set({
        workflow_version_id: input.workflowVersionId,
        enabled: input.readiness.state === "ready",
        trigger_config: { routineId: input.routine.id },
        actor_contract: {
          agentVisible: input.routine.visibility === "tenant_shared",
        },
        readiness_state: input.readiness.state,
        readiness_reasons: input.readiness.reasons,
        updated_at: new Date(),
      })
      .where(eq(workflowTriggers.id, existing[0].id));
    return;
  }

  await dbInsert(database)
    .insert(workflowTriggers)
    .values({
      tenant_id: input.routine.tenant_id,
      workflow_id: input.workflowId,
      workflow_version_id: input.workflowVersionId,
      trigger_family: input.triggerFamily,
      source_system: "routine",
      enabled: input.readiness.state === "ready",
      idempotency_required: input.triggerFamily !== "manual",
      trigger_config: { routineId: input.routine.id },
      actor_contract: {
        agentVisible: input.routine.visibility === "tenant_shared",
      },
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
    });
}

type RoutineReadiness = {
  state: "ready" | "blocked_not_ready" | "disabled";
  bindingStatus: "ready" | "blocked_not_ready" | "disabled" | "archived";
  reasons: unknown[];
};

function routineReadiness(
  routine: RoutineWorkflowRoutine,
  aslVersion?: RoutineWorkflowAslVersion | null,
): RoutineReadiness {
  if (routine.engine !== "step_functions") {
    return {
      state: "disabled",
      bindingStatus: "archived",
      reasons: [{ code: "legacy_python", message: "Legacy Python routine" }],
    };
  }
  if (routine.status && routine.status !== "active") {
    return {
      state: "disabled",
      bindingStatus: "disabled",
      reasons: [{ code: "routine_inactive", message: "Routine is inactive" }],
    };
  }
  if (!routine.state_machine_arn || !routine.state_machine_alias_arn) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        {
          code: "missing_state_machine",
          message: "Routine is missing Step Functions ARNs",
        },
      ],
    };
  }
  if (!aslVersion) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        {
          code: "missing_current_asl_version",
          message: "Routine current ASL version was not found",
        },
      ],
    };
  }
  return { state: "ready", bindingStatus: "ready", reasons: [] };
}

function routineLifecycleStatus(
  routine: RoutineWorkflowRoutine,
  aslVersion?: RoutineWorkflowAslVersion | null,
): "active" | "archived" | "deprecated" {
  if (routine.engine !== "step_functions") return "archived";
  if (routine.status === "archived") return "archived";
  if (!aslVersion) return "deprecated";
  return "active";
}

function summarizeJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function dbSelect(database: WorkflowDb): any {
  return database as any;
}

function dbInsert(database: WorkflowDb): any {
  return database as any;
}

function dbUpdate(database: WorkflowDb): any {
  return database as any;
}
