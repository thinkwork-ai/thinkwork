import { and, eq } from "drizzle-orm";
import {
  workflowEngineBindings,
  workflowRuns,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { createWorkflowRunLedger } from "../../../lib/workflows/run-ledger.js";
import { triggerRoutineRun } from "../routines/triggerRoutineRun.mutation.js";
import { assertCanReadWorkflowTenant } from "./types.js";

type TriggerWorkflowRunArgs = {
  input: {
    workflowId: string;
    input?: unknown;
    idempotencyKey?: string | null;
    triggerSource?: string | null;
    actorType?: string | null;
    actorId?: string | null;
    agentId?: string | null;
  };
};

type WorkflowRow = {
  id: string;
  tenant_id: string;
  visibility: string;
  owner_agent_id?: string | null;
  lifecycle_status: string;
  current_version_id?: string | null;
  readiness_state: string;
  readiness_reasons: unknown[];
  capability_flags: Record<string, unknown>;
};

export async function triggerWorkflowRun(
  _parent: unknown,
  args: TriggerWorkflowRunArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const [workflow] = (await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, args.input.workflowId))
    .limit(1)) as WorkflowRow[];

  if (!workflow) {
    throw new Error(`Workflow ${args.input.workflowId} not found`);
  }

  await assertCanReadWorkflowTenant(ctx, workflow.tenant_id);
  assertWorkflowCallableByActor(workflow, {
    agentId: args.input.agentId ?? ctx.auth.agentId ?? null,
  });

  if (args.input.idempotencyKey) {
    const existing = await loadWorkflowRunByIdempotencyKey({
      tenantId: workflow.tenant_id,
      idempotencyKey: args.input.idempotencyKey,
    });
    if (existing) return existing;
  }

  const normalizedInput = normalizeAwsJsonObject(args.input.input);
  const actor = resolveWorkflowActor(ctx, args.input);
  const triggerSource = args.input.triggerSource ?? "workflow_contract";
  const binding = await loadReadyStepFunctionsBinding(workflow.id);

  if (!isWorkflowReady(workflow) || !binding) {
    const reasons = !isWorkflowReady(workflow)
      ? workflow.readiness_reasons
      : [
          {
            code: "no_ready_step_functions_binding",
            message:
              "Workflow does not have a ready Step Functions routine binding.",
          },
        ];
    const ledger = await createWorkflowRunLedger(db, {
      tenantId: workflow.tenant_id,
      workflowId: workflow.id,
      workflowVersionId: workflow.current_version_id ?? null,
      engineBindingId: binding?.id ?? null,
      trigger: {
        triggerFamily: actor.triggerFamily,
        triggerSource,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorExternalId: null,
        actorDisplayName: null,
        idempotencyKey: args.input.idempotencyKey ?? null,
        correlationId:
          args.input.idempotencyKey ??
          `workflow-blocked:${workflow.id}:${Date.now()}`,
        idempotencyRequired: false,
        inputSummary: normalizedInput,
        occurredAt: null,
      },
      status: "blocked_not_ready",
      capabilitySnapshot: workflow.capability_flags,
      readinessSnapshot: { state: workflow.readiness_state, reasons },
      initialEvent: {
        eventType: "workflow_invocation_blocked",
        eventStatus: "blocked_not_ready",
        provenance: "operator_decision",
        message: "Workflow invocation blocked before backend execution.",
        payloadSummary: {
          workflowId: workflow.id,
          readinessState: workflow.readiness_state,
          reasons,
        },
      },
    });
    return await loadWorkflowRunById(ledger.run.id);
  }

  const execution = (await triggerRoutineRun(
    null,
    {
      routineId: binding.routine_id,
      input: normalizedInput,
      triggerFamily: actor.triggerFamily,
      triggerSource,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: args.input.idempotencyKey ?? null,
      workflowRunIdempotencyKey: args.input.idempotencyKey ?? null,
    },
    ctx,
  )) as { sfnExecutionArn?: string };

  if (!execution.sfnExecutionArn) {
    throw new Error(
      "Workflow execution started without a backend execution id",
    );
  }

  const run = await loadWorkflowRunByBackendExecution({
    workflowId: workflow.id,
    backendExecutionId: execution.sfnExecutionArn,
  });
  if (!run) {
    throw new Error(
      `Workflow run ledger not found for backend execution ${execution.sfnExecutionArn}`,
    );
  }
  return run;
}

function assertWorkflowCallableByActor(
  workflow: WorkflowRow,
  caller: { agentId: string | null },
): void {
  if (workflow.visibility === "tenant_shared") return;
  if (workflow.owner_agent_id && workflow.owner_agent_id === caller.agentId) {
    return;
  }
  throw new Error(
    `workflow invocation denied: private_to_other_agent (workflowId=${workflow.id})`,
  );
}

function isWorkflowReady(workflow: WorkflowRow): boolean {
  return (
    workflow.lifecycle_status === "active" &&
    workflow.readiness_state === "ready" &&
    workflow.capability_flags?.start !== false
  );
}

async function loadReadyStepFunctionsBinding(
  workflowId: string,
): Promise<{ id: string; routine_id: string } | null> {
  const rows = await db
    .select({
      id: workflowEngineBindings.id,
      routine_id: workflowEngineBindings.routine_id,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.workflow_id, workflowId),
        eq(workflowEngineBindings.binding_type, "step_functions_routine"),
        eq(workflowEngineBindings.binding_status, "ready"),
        eq(workflowEngineBindings.readiness_state, "ready"),
      ),
    )
    .limit(1);
  const row = rows[0] as { id: string; routine_id?: string | null } | undefined;
  return row?.routine_id ? { id: row.id, routine_id: row.routine_id } : null;
}

async function loadWorkflowRunById(id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Workflow run ${id} not found after ledger creation`);
  }
  return snakeToCamel(row);
}

async function loadWorkflowRunByIdempotencyKey(input: {
  tenantId: string;
  idempotencyKey: string;
}): Promise<unknown | null> {
  const rows = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenant_id, input.tenantId),
        eq(workflowRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ? snakeToCamel(rows[0]) : null;
}

async function loadWorkflowRunByBackendExecution(input: {
  workflowId: string;
  backendExecutionId: string;
}): Promise<unknown | null> {
  const rows = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflow_id, input.workflowId),
        eq(workflowRuns.backend_execution_id, input.backendExecutionId),
      ),
    )
    .limit(1);
  return rows[0] ? snakeToCamel(rows[0]) : null;
}

function resolveWorkflowActor(
  ctx: GraphQLContext,
  input: TriggerWorkflowRunArgs["input"],
): {
  triggerFamily: "api" | "agent";
  actorType: "agent" | "api_key";
  actorId: string | null;
} {
  const agentId = input.agentId ?? ctx.auth.agentId ?? null;
  const actorType = agentId ? "agent" : "api_key";
  const actorId = input.actorId ?? agentId ?? ctx.auth.principalId ?? null;
  return {
    triggerFamily: actorType === "agent" ? "agent" : "api",
    actorType,
    actorId,
  };
}

function normalizeAwsJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("triggerWorkflowRun input must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
