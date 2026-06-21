import { and, eq, sql } from "drizzle-orm";
import {
  workflowEvidence,
  workflowRunEvents,
  workflowRuns,
  workflows,
} from "@thinkwork/database-pg/schema";
import type { NormalizedWorkflowTrigger } from "./trigger-contract.js";
import { workflowRunTriggerColumns } from "./trigger-contract.js";
import type { WorkflowEvidenceSummary } from "./evidence-redaction.js";

type WorkflowDb = any;

export type WorkflowRunLedgerInput = {
  tenantId: string;
  workflowId: string;
  workflowVersionId?: string | null;
  engineBindingId?: string | null;
  trigger: NormalizedWorkflowTrigger;
  status?: string;
  backendExecutionId?: string | null;
  backendExecutionRef?: Record<string, unknown>;
  capabilitySnapshot?: Record<string, unknown>;
  readinessSnapshot?: Record<string, unknown>;
  startedAt?: Date | null;
  initialEvent?: WorkflowRunEventInput | null;
  evidence?: WorkflowEvidenceInput[];
};

export type WorkflowRunEventInput = {
  eventType: string;
  eventStatus?: string | null;
  provenance:
    | "native_event"
    | "app_callback"
    | "engine_history"
    | "output_inferred"
    | "operator_decision";
  occurredAt?: Date | null;
  message?: string | null;
  payloadSummary?: Record<string, unknown>;
  evidenceRef?: Record<string, unknown>;
};

export type WorkflowEvidenceInput = {
  evidenceType: string;
  sourceSystem: string;
  sourceId?: string | null;
  uri?: string | null;
  summary: WorkflowEvidenceSummary;
};

export type WorkflowRunLedgerResult = {
  run: { id: string };
  created: boolean;
};

export async function createWorkflowRunLedger(
  database: WorkflowDb,
  input: WorkflowRunLedgerInput,
): Promise<WorkflowRunLedgerResult> {
  const startedAt = input.startedAt ?? new Date();
  const triggerColumns = workflowRunTriggerColumns(input.trigger);
  const insertValues = {
    tenant_id: input.tenantId,
    workflow_id: input.workflowId,
    workflow_version_id: input.workflowVersionId ?? null,
    engine_binding_id: input.engineBindingId ?? null,
    status: input.status ?? "running",
    ...triggerColumns,
    backend_execution_id: input.backendExecutionId ?? null,
    backend_execution_ref: input.backendExecutionRef ?? {},
    capability_snapshot: input.capabilitySnapshot ?? {},
    readiness_snapshot: input.readinessSnapshot ?? {},
    started_at: startedAt,
    last_event_at: startedAt,
  };

  const insert = dbInsert(database).insert(workflowRuns).values(insertValues);
  const rows = input.trigger.idempotencyKey
    ? await insert
        .onConflictDoNothing({
          target: [workflowRuns.tenant_id, workflowRuns.idempotency_key],
          where: sql`${workflowRuns.idempotency_key} IS NOT NULL`,
        })
        .returning({ id: workflowRuns.id })
    : await insert.returning({ id: workflowRuns.id });

  if (rows.length === 0 && input.trigger.idempotencyKey) {
    const existing = await loadRunByIdempotencyKey(database, {
      tenantId: input.tenantId,
      idempotencyKey: input.trigger.idempotencyKey,
    });
    return { run: existing, created: false };
  }

  const run = rows[0];
  await dbUpdate(database)
    .update(workflows)
    .set({
      last_run_id: run.id,
      last_run_at: startedAt,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.workflowId));

  if (input.initialEvent) {
    await appendWorkflowRunEvent(database, {
      tenantId: input.tenantId,
      workflowRunId: run.id,
      ...input.initialEvent,
      occurredAt: input.initialEvent.occurredAt ?? startedAt,
    });
  }

  for (const evidence of input.evidence ?? []) {
    await attachWorkflowEvidence(database, {
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      workflowRunId: run.id,
      ...evidence,
    });
  }

  return { run, created: true };
}

export async function appendWorkflowRunEvent(
  database: WorkflowDb,
  input: WorkflowRunEventInput & {
    tenantId: string;
    workflowRunId: string;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  await dbInsert(database)
    .insert(workflowRunEvents)
    .values({
      tenant_id: input.tenantId,
      workflow_run_id: input.workflowRunId,
      event_type: input.eventType,
      event_status: input.eventStatus ?? null,
      provenance: input.provenance,
      occurred_at: occurredAt,
      message: input.message ?? null,
      payload_summary: input.payloadSummary ?? {},
      evidence_ref: input.evidenceRef ?? {},
    });
  await dbUpdate(database)
    .update(workflowRuns)
    .set({ last_event_at: occurredAt, updated_at: new Date() })
    .where(eq(workflowRuns.id, input.workflowRunId));
}

export async function attachWorkflowEvidence(
  database: WorkflowDb,
  input: WorkflowEvidenceInput & {
    tenantId: string;
    workflowId: string;
    workflowRunId?: string | null;
  },
): Promise<void> {
  await dbInsert(database)
    .insert(workflowEvidence)
    .values({
      tenant_id: input.tenantId,
      workflow_id: input.workflowId,
      workflow_run_id: input.workflowRunId ?? null,
      evidence_type: input.evidenceType,
      source_system: input.sourceSystem,
      source_id: input.sourceId ?? null,
      uri: input.uri ?? input.summary.uri,
      summary: input.summary.summary,
      redaction_state: input.summary.redactionState,
      sensitivity: input.summary.sensitivity,
    });
}

async function loadRunByIdempotencyKey(
  database: WorkflowDb,
  input: { tenantId: string; idempotencyKey: string },
): Promise<{ id: string }> {
  const rows = await dbSelect(database)
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenant_id, input.tenantId),
        eq(workflowRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  const run = rows[0];
  if (!run) {
    throw new Error(
      `workflow run idempotency conflict raised but no matching row was found for tenant ${input.tenantId}`,
    );
  }
  return run;
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
