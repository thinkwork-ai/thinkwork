/**
 * memory-stage-sweeper — scheduled recovery for stalled `memory_stage` task
 * tokens (THINK-193 U3).
 *
 * The worker's durable-claim protocol (pending -> executing -> consumed with
 * a persisted result) makes recovery a matter of RE-INVOKING the worker with
 * the reconstructed payload:
 *   - stalled `pending` (dispatch parked but the Event invoke was lost or
 *     the worker crashed before claiming) -> re-invoke; the claim CAS wins.
 *   - stalled `executing` (crashed worker past its lease + grace) ->
 *     re-invoke; the stale-lease re-claim proceeds.
 *   - `consumed` with a persisted result while the run is still live
 *     (SendTaskSuccess failed transiently after persist, F9) -> re-invoke;
 *     the worker takes the redrive path and re-sends the stored result.
 * A duplicate invoke is always safe: the worker refuses to execute without
 * a claimable token, so exactly one terminal stage event reaches the run.
 *
 * When the payload CANNOT be reconstructed (definition gone, step removed,
 * unresolvable templates), the machine must not park until its 2h timeout:
 * the sweeper records a terminal workflow_step_failed event, marks the token
 * expired, and SendTaskFailure-fails the parked state so the execution ends.
 *
 * Triggered by EventBridge Scheduler (rate(15 minutes)); no HTTP surface.
 */

import { SendTaskFailureCommand, SFNClient } from "@aws-sdk/client-sfn";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  getDb,
  loadWorkflowStepOutputs,
  recordWorkflowStepEvent,
  TASK_TOKEN_LEASE_STALE_AFTER_MS,
} from "@thinkwork/database-pg";
import {
  workflowRuns,
  workflowTaskTokens,
  workflowVersions,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import {
  mergeApprovalOverrideIntoOptions,
  readWorkflowDefinition,
  resolveStepTemplates,
  type MemoryStageWorkerInvokePayload,
} from "@thinkwork/agent-loops-core";

/** pending older than this with no claim = the worker never started. */
export const PENDING_STALL_MS = 15 * 60_000;
/** Extra grace on top of the executing lease before we re-invoke. */
export const EXECUTING_GRACE_MS = 5 * 60_000;
/** consumed-with-result older than this while the run is live = redrive. */
export const CONSUMED_REDRIVE_MS = 15 * 60_000;
/** Bounded batch per sweep. */
export const SWEEP_LIMIT = 25;

const LIVE_RUN_STATUSES = ["queued", "running", "waiting_for_human"];

export interface MemoryStageSweeperDeps {
  invokeWorker: (payload: MemoryStageWorkerInvokePayload) => Promise<void>;
  sendTaskFailure: (input: {
    token: string;
    error: string;
    cause: string;
  }) => Promise<void>;
}

const defaultDeps = (): MemoryStageSweeperDeps => {
  const sfn = new SFNClient({});
  return {
    invokeWorker: async (payload) => {
      const { LambdaClient, InvokeCommand } = await import(
        "@aws-sdk/client-lambda"
      );
      const stage = process.env.STAGE;
      const fnName =
        process.env.MEMORY_STAGE_WORKER_FUNCTION_NAME ??
        (stage ? `thinkwork-${stage}-api-memory-stage-worker` : undefined);
      if (!fnName) {
        throw new Error(
          "memory-stage-sweeper cannot re-invoke: MEMORY_STAGE_WORKER_FUNCTION_NAME / STAGE are unset",
        );
      }
      await new LambdaClient({}).send(
        new InvokeCommand({
          FunctionName: fnName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(payload)),
        }),
      );
    },
    sendTaskFailure: async ({ token, error, cause }) => {
      try {
        await sfn.send(
          new SendTaskFailureCommand({
            taskToken: token,
            error,
            cause: cause.slice(0, 32_000),
          }),
        );
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        if (name === "TaskDoesNotExist" || name === "TaskTimedOut") return;
        throw err;
      }
    },
  };
};

interface CandidateRow {
  token_id: string;
  token: string;
  status: string;
  step_id: string;
  iteration: number;
  workflow_run_id: string;
  tenant_id: string;
  run_status: string;
  workflow_version_id: string | null;
  input_summary: Record<string, unknown> | null;
}

async function findCandidates(
  db: Database,
  now: Date,
): Promise<CandidateRow[]> {
  const pendingBefore = new Date(now.getTime() - PENDING_STALL_MS);
  const executingBefore = new Date(
    now.getTime() - TASK_TOKEN_LEASE_STALE_AFTER_MS - EXECUTING_GRACE_MS,
  );
  const consumedBefore = new Date(now.getTime() - CONSUMED_REDRIVE_MS);

  const rows = await db
    .select({
      token_id: workflowTaskTokens.id,
      token: workflowTaskTokens.token,
      status: workflowTaskTokens.status,
      step_id: workflowTaskTokens.step_id,
      iteration: workflowTaskTokens.iteration,
      workflow_run_id: workflowTaskTokens.workflow_run_id,
      tenant_id: workflowTaskTokens.tenant_id,
      run_status: workflowRuns.status,
      workflow_version_id: workflowRuns.workflow_version_id,
      input_summary: workflowRuns.input_summary,
    })
    .from(workflowTaskTokens)
    .innerJoin(
      workflowRuns,
      eq(workflowTaskTokens.workflow_run_id, workflowRuns.id),
    )
    .where(
      and(
        eq(workflowTaskTokens.purpose, "memory_stage"),
        inArray(workflowRuns.status, LIVE_RUN_STATUSES),
        sql`(
          (${workflowTaskTokens.status} = 'pending' AND ${workflowTaskTokens.created_at} < ${pendingBefore})
          OR (${workflowTaskTokens.status} = 'executing' AND ${workflowTaskTokens.locked_at} IS NOT NULL AND ${workflowTaskTokens.locked_at} < ${executingBefore})
          OR (${workflowTaskTokens.status} = 'consumed' AND ${workflowTaskTokens.result} IS NOT NULL AND ${workflowTaskTokens.consumed_at} IS NOT NULL AND ${workflowTaskTokens.consumed_at} < ${consumedBefore})
        )`,
      ),
    )
    .orderBy(workflowTaskTokens.created_at)
    .limit(SWEEP_LIMIT);
  return rows as CandidateRow[];
}

/**
 * Rebuild the worker payload the same way workflow-step-dispatch built it at
 * park time: definition step + template resolution over run input / step
 * outputs + approval-override merge. Returns a reason string when the
 * payload cannot be reconstructed.
 */
async function reconstructPayload(
  db: Database,
  candidate: CandidateRow,
): Promise<
  { payload: MemoryStageWorkerInvokePayload } | { unrecoverable: string }
> {
  if (!candidate.workflow_version_id) {
    return { unrecoverable: "run has no pinned workflow version" };
  }
  const [version] = await db
    .select({ definition_snapshot: workflowVersions.definition_snapshot })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, candidate.workflow_version_id))
    .limit(1);
  const definition = version
    ? readWorkflowDefinition(version.definition_snapshot)
    : null;
  if (!definition) {
    return { unrecoverable: "pinned workflow version has no valid definition" };
  }
  const step = definition.steps.find((s) => s.id === candidate.step_id);
  if (!step || step.kind !== "memory_stage") {
    return {
      unrecoverable: `step ${candidate.step_id} is not a memory_stage step in the pinned definition`,
    };
  }

  const input = (candidate.input_summary ?? {}) as Record<string, unknown>;
  const stepOutputs = await loadWorkflowStepOutputs(db, {
    workflowRunId: candidate.workflow_run_id,
  });
  const resolved = resolveStepTemplates(
    {
      processorConfigId: step.processorConfigId,
      ...(step.sourceConfigId !== undefined
        ? { sourceConfigId: step.sourceConfigId }
        : {}),
      ...(step.options !== undefined ? { options: step.options } : {}),
    },
    {
      trigger: { payload: input },
      run: { input },
      steps: stepOutputs,
    },
  );
  if (!resolved.ok) {
    return {
      unrecoverable: `step references did not resolve: ${resolved.missing.join(", ")}`,
    };
  }
  const { processorConfigId, sourceConfigId, options } = resolved.value as {
    processorConfigId: unknown;
    sourceConfigId?: unknown;
    options?: Record<string, unknown>;
  };
  if (typeof processorConfigId !== "string" || !processorConfigId.trim()) {
    return {
      unrecoverable: "processorConfigId did not resolve to a non-empty string",
    };
  }

  return {
    payload: {
      workflowRunId: candidate.workflow_run_id,
      tenantId: candidate.tenant_id,
      stepId: candidate.step_id,
      iteration: candidate.iteration,
      stage: step.stage,
      processorConfigId,
      sourceConfigId:
        typeof sourceConfigId === "string" && sourceConfigId
          ? sourceConfigId
          : null,
      // Keep the reviewer's approved narrowing on redrive (same merge the
      // dispatch layer applies at park time).
      options: mergeApprovalOverrideIntoOptions(stepOutputs, options ?? null),
    },
  };
}

export interface SweepResult {
  sweptAt: string;
  candidates: number;
  reinvoked: number;
  failed_terminal: number;
  errors: number;
}

export async function sweepMemoryStageTokens(
  db: Database,
  options: { now?: Date; deps?: MemoryStageSweeperDeps } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const deps = options.deps ?? defaultDeps();
  const candidates = await findCandidates(db, now);

  let reinvoked = 0;
  let failedTerminal = 0;
  let errors = 0;
  for (const candidate of candidates) {
    try {
      const outcome = await reconstructPayload(db, candidate);
      if ("payload" in outcome) {
        await deps.invokeWorker(outcome.payload);
        reinvoked += 1;
        console.log(
          `[memory-stage-sweeper] re-invoked worker: run=${candidate.workflow_run_id} step=${candidate.step_id} token_status=${candidate.status}`,
        );
        continue;
      }
      // Unrecoverable: ONE terminal stage event + fail the parked state so
      // the run ends failed/resumable instead of waiting out the timeout.
      const errorSummary = `memory stage could not be recovered: ${outcome.unrecoverable}`;
      await recordWorkflowStepEvent(db, {
        tenantId: candidate.tenant_id,
        workflowRunId: candidate.workflow_run_id,
        eventType: "workflow_step_failed",
        summary: {
          stepId: candidate.step_id,
          stepKind: "memory_stage",
          iteration: candidate.iteration,
          status: "failed",
          reason: "memory_stage_unrecoverable",
          errorSummary,
        },
        runStatus: "failed",
        now,
      });
      await db
        .update(workflowTaskTokens)
        .set({ status: "expired" })
        .where(
          and(
            eq(workflowTaskTokens.id, candidate.token_id),
            // Never expire a row a worker resolved in the meantime.
            inArray(workflowTaskTokens.status, ["pending", "executing"]),
          ),
        );
      if (candidate.status !== "consumed") {
        await deps.sendTaskFailure({
          token: candidate.token,
          error: "MemoryStageUnrecoverable",
          cause: errorSummary,
        });
      }
      failedTerminal += 1;
      console.error(
        `[memory-stage-sweeper] terminal failure recorded: run=${candidate.workflow_run_id} step=${candidate.step_id} — ${outcome.unrecoverable}`,
      );
    } catch (err) {
      errors += 1;
      console.error(
        `[memory-stage-sweeper] sweep item failed: run=${candidate.workflow_run_id} step=${candidate.step_id}: ${(err as Error)?.message}`,
      );
    }
  }

  const result: SweepResult = {
    sweptAt: now.toISOString(),
    candidates: candidates.length,
    reinvoked,
    failed_terminal: failedTerminal,
    errors,
  };
  console.log(`[memory-stage-sweeper] ${JSON.stringify(result)}`);
  return result;
}

export async function handler(): Promise<SweepResult> {
  return sweepMemoryStageTokens(getDb());
}
