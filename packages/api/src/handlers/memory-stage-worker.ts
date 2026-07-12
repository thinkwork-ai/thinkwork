/**
 * memory-stage-worker — async executor for `memory_stage` workflow steps
 * (external memory compounding, THINK-193 U1).
 *
 * Harness only: payload validation, the durable execution claim on the
 * task-token row, stage dispatch (implementations live in
 * lib/memory-sources/stages.ts), result persistence, and task-token resume.
 * Stage failures resume with status "failed" — the run fails visibly; the
 * machine never parks forever behind a crashed worker (bounded by the ASL
 * heartbeat timeout).
 */

import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { consumeTaskToken, getDb } from "@thinkwork/database-pg";
import { workflowTaskTokens } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  assertSharedScope,
  assertTargetInTenant,
  getProcessorConfig,
  getSourceConfig,
  MemoryScopeError,
} from "../lib/memory-sources/repository.js";
import type {
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "../lib/memory-sources/types.js";
import {
  failed,
  runAcquire,
  runCompound,
  runProject,
  runRetain,
  type StageContext,
} from "../lib/memory-sources/stages.js";

// Frozen dispatch<->worker protocol — shared with workflow-step-dispatch via
// @thinkwork/agent-loops-core so the shapes cannot drift.
import type {
  MemoryStageWorkerInvokePayload,
  MemoryStageWorkerResult,
} from "@thinkwork/agent-loops-core";

export type MemoryStageWorkerEvent = MemoryStageWorkerInvokePayload;
export type { MemoryStageWorkerResult };

const _DEFAULT_SFN_CLIENT = new SFNClient({});
const CONSUMED_ERROR_NAMES = new Set(["TaskDoesNotExist", "TaskTimedOut"]);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function executeStage(
  db: Database,
  event: MemoryStageWorkerEvent,
): Promise<MemoryStageWorkerResult> {
  const processor = await getProcessorConfig(db, {
    tenantId: event.tenantId,
    processorConfigId: event.processorConfigId,
  });
  if (!processor) {
    return failed(
      event.stage,
      `processor config ${event.processorConfigId} not found for tenant`,
    );
  }
  if (processor.tenant_id !== event.tenantId) {
    return failed(event.stage, "processor belongs to another tenant");
  }
  if (!processor.enabled || processor.status !== "active") {
    return failed(event.stage, "processor is disabled");
  }
  try {
    assertSharedScope(processor);
    // R11: the target must actually belong to this tenant — never derive a
    // bank id from an unverified target_id.
    await assertTargetInTenant(db, processor);
  } catch (err) {
    if (err instanceof MemoryScopeError) {
      return failed(event.stage, err.message);
    }
    throw err;
  }

  let sources: MemorySourceConfig[];
  if (event.sourceConfigId) {
    const found = await getSourceConfig(db, {
      tenantId: event.tenantId,
      sourceConfigId: event.sourceConfigId,
    });
    if (!found || found.processor.id !== processor.id) {
      return failed(
        event.stage,
        `source config ${event.sourceConfigId} not found on this processor`,
      );
    }
    if (!found.source.enabled) {
      return failed(event.stage, "source config is disabled");
    }
    sources = [found.source];
  } else {
    return failed(
      event.stage,
      "U1 requires an explicit sourceConfigId on the memory_stage step",
    );
  }

  const ctx: StageContext = {
    db,
    event,
    processor: processor as StageContext["processor"],
    sources,
  };

  switch (event.stage) {
    case "acquire":
      return runAcquire(ctx);
    case "project":
      return runProject(ctx);
    case "retain":
      return runRetain(ctx);
    case "compound":
      return runCompound(ctx);
    default:
      return failed(
        event.stage,
        `stage "${event.stage}" is not implemented in U1 (acquire|project|retain|compound)`,
      );
  }
}

async function resumeToken(
  db: Database,
  sfn: SFNClient,
  event: MemoryStageWorkerEvent,
  result: MemoryStageWorkerResult,
): Promise<"resumed" | "already_resolved" | "no_token"> {
  const [pending] = await db
    .select({
      step_id: workflowTaskTokens.step_id,
      iteration: workflowTaskTokens.iteration,
    })
    .from(workflowTaskTokens)
    .where(
      and(
        eq(workflowTaskTokens.workflow_run_id, event.workflowRunId),
        eq(workflowTaskTokens.step_id, event.stepId),
        eq(workflowTaskTokens.iteration, event.iteration),
        eq(workflowTaskTokens.purpose, "memory_stage"),
        eq(workflowTaskTokens.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) return "no_token";

  const consumed = await consumeTaskToken(db, {
    workflowRunId: event.workflowRunId,
    stepId: event.stepId,
    iteration: event.iteration,
    purpose: "memory_stage",
  });
  if (!consumed) return "already_resolved";

  try {
    await sfn.send(
      new SendTaskSuccessCommand({
        taskToken: consumed.token,
        output: JSON.stringify(result),
      }),
    );
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (CONSUMED_ERROR_NAMES.has(name)) return "already_resolved";
    // Consumed-but-unsent window: the token row is already flipped to
    // consumed, so a retry would find no pending row and the run would sit
    // parked until the ASL heartbeat timeout. Revert to pending before
    // rethrowing so a retry (or manual re-invoke) can resume it.
    await db
      .update(workflowTaskTokens)
      .set({ status: "pending" })
      .where(
        and(
          eq(workflowTaskTokens.workflow_run_id, event.workflowRunId),
          eq(workflowTaskTokens.step_id, event.stepId),
          eq(workflowTaskTokens.iteration, event.iteration),
          eq(workflowTaskTokens.purpose, "memory_stage"),
          eq(workflowTaskTokens.status, "consumed"),
        ),
      )
      .catch((revertErr) => {
        console.error(
          `[memory-stage-worker] failed to revert consumed token for run=${event.workflowRunId}: ${(revertErr as Error)?.message}`,
        );
      });
    throw err;
  }
  return "resumed";
}

export interface MemoryStageWorkerOptions {
  db?: Database;
  sfnClient?: SFNClient;
}

export async function runMemoryStageWorker(
  event: MemoryStageWorkerEvent,
  options: MemoryStageWorkerOptions = {},
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  const db = options.db ?? getDb();
  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;

  for (const field of [
    "workflowRunId",
    "tenantId",
    "stepId",
    "stage",
    "processorConfigId",
  ] as const) {
    if (!event?.[field]) {
      throw new Error(`memory-stage-worker event is missing ${field}`);
    }
  }

  let result: MemoryStageWorkerResult;
  try {
    result = await executeStage(db, event);
  } catch (err) {
    // Never leave the machine parked: unexpected errors resume as a visible
    // stage failure. Checkpoints are transactional, so a crashed acquire left
    // no partial advance behind.
    const message = (err as Error)?.message ?? String(err);
    console.error(
      `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} crashed: ${message}`,
    );
    result = failed(event.stage, message.slice(0, 500));
  }

  const resume = await resumeToken(db, sfn, event, result);
  console.log(
    `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} status=${result.status} resume=${resume} counts=${JSON.stringify(result.counts ?? {})}`,
  );
  return { result, resume };
}

export async function handler(
  event: MemoryStageWorkerEvent,
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  return runMemoryStageWorker(event);
}
