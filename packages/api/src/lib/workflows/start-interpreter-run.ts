/**
 * Shared "start a workflow run on the interpreter" service (THINK-216).
 *
 * The non-manual trigger paths (webhook today; event triggers later) start
 * runs here: run row BEFORE StartExecution (trigger-scoped idempotency), the
 * caller payload folded into input_summary (feeding `{{ trigger.payload.* }}`
 * and `{{ run.input.* }}`), the tenant's platform agent as the acting agent,
 * and a duplicate/half-built repair identical to triggerWorkflowRun's manual
 * path. Returns null in ThinkWork terms when the interpreter cannot start
 * (no machine ARN / no platform agent / no published version) so the caller
 * can surface its own error.
 */
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { and, eq } from "drizzle-orm";
import {
  createInterpreterWorkflowRun,
  ensureInterpreterBinding,
  markInterpreterRunStarted,
} from "@thinkwork/database-pg";
import { agents, workflowRuns, workflows } from "@thinkwork/database-pg/schema";
import { db } from "../../graphql/utils.js";
import { resolveInterpreterStateMachineArn } from "./interpreter-state-machine.js";

const _SFN_CLIENT = new SFNClient({});

export interface StartInterpreterRunInput {
  tenantId: string;
  workflowId: string;
  triggerFamily: "webhook" | "schedule" | "manual" | "api" | "event";
  triggerSource: string;
  idempotencyKey: string;
  actorType: string | null;
  actorId: string | null;
  /** Caller payload — folded into input_summary for template resolution. */
  payload: Record<string, unknown>;
  /** Human invoker for Pi agent steps (wakeups require a user). */
  requestedByUserId: string | null;
  spaceId?: string | null;
}

export type StartInterpreterRunResult =
  { ok: true; runId: string; created: boolean } | { ok: false; reason: string };

export async function startInterpreterRun(
  input: StartInterpreterRunInput,
): Promise<StartInterpreterRunResult> {
  const [workflow] = await db
    .select({
      id: workflows.id,
      tenant_id: workflows.tenant_id,
      name: workflows.name,
      lifecycle_status: workflows.lifecycle_status,
      current_version_id: workflows.current_version_id,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.id, input.workflowId),
        eq(workflows.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!workflow) {
    return { ok: false, reason: "workflow_not_found" };
  }
  if (workflow.lifecycle_status !== "active") {
    return { ok: false, reason: `workflow_${workflow.lifecycle_status}` };
  }
  if (!workflow.current_version_id) {
    return { ok: false, reason: "workflow_has_no_published_version" };
  }

  const stateMachineArn = await resolveInterpreterStateMachineArn();
  if (!stateMachineArn) {
    return { ok: false, reason: "interpreter_unavailable" };
  }

  const [platformAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, input.tenantId),
        eq(agents.is_platform_default, true),
      ),
    )
    .limit(1);
  if (!platformAgent) {
    return { ok: false, reason: "no_platform_agent" };
  }

  const binding = await ensureInterpreterBinding(db, {
    tenantId: input.tenantId,
    workflowId: workflow.id,
    workflowVersionId: workflow.current_version_id,
    stateMachineArn,
  });

  const { run, created } = await createInterpreterWorkflowRun(db, {
    tenantId: input.tenantId,
    workflowId: workflow.id,
    workflowVersionId: workflow.current_version_id,
    engineBindingId: binding.id,
    triggerFamily: input.triggerFamily,
    triggerSource: input.triggerSource,
    idempotencyKey: input.idempotencyKey,
    actorType: input.actorType,
    actorId: input.actorId,
    inputSummary: {
      ...input.payload,
      agentId: platformAgent.id,
      workflowName: workflow.name ?? null,
      spaceId: input.spaceId ?? null,
      requestedByUserId: input.requestedByUserId,
    },
  });

  // Duplicate / half-built repair: re-start ONLY a queued run with no
  // execution; anything past that is a genuine duplicate.
  if (!created) {
    const [existing] = await db
      .select({
        status: workflowRuns.status,
        backend_execution_id: workflowRuns.backend_execution_id,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id))
      .limit(1);
    const repairable =
      existing &&
      existing.status === "queued" &&
      !existing.backend_execution_id;
    if (!repairable) return { ok: true, runId: run.id, created: false };
  }

  const startResp = await _SFN_CLIENT.send(
    new StartExecutionCommand({
      stateMachineArn,
      name: `run-${run.id}-r0`,
      input: JSON.stringify({
        cursor: {
          workflowRunId: run.id,
          tenantId: input.tenantId,
          stepPointer: 0,
          iteration: 1,
          loopCycleCount: 0,
          rolloverCount: 0,
        },
      }),
    }),
  );
  if (!startResp.executionArn) {
    throw new Error(
      "Workflow interpreter execution started without a backend execution id",
    );
  }
  await markInterpreterRunStarted(db, {
    tenantId: input.tenantId,
    workflowId: workflow.id,
    runId: run.id,
    executionArn: startResp.executionArn,
    now: startResp.startDate ?? undefined,
  });

  return { ok: true, runId: run.id, created };
}
