/**
 * memory-stage-worker — async executor for `memory_stage` workflow steps
 * (external memory compounding, THINK-193 U1).
 *
 * Harness only: payload validation, the durable pre-execution claim on the
 * task-token row (Codex F1 — no stage side effects until a pending token is
 * proven and claimed), run/definition binding validation, stage dispatch
 * (implementations live in lib/memory-sources/stages.ts), persist-then-send
 * completion (Codex F9 — the result is durable before SendTaskSuccess so a
 * transient send failure is redrivable), and task-token resume. Stage
 * failures resume with status "failed" — the run fails visibly; the machine
 * never parks forever behind a crashed worker (bounded by the ASL heartbeat
 * timeout).
 */

import { randomUUID } from "node:crypto";
import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import {
  claimTaskTokenExecution,
  getDb,
  persistTaskTokenResult,
  renewTaskTokenLease,
} from "@thinkwork/database-pg";
import { workflowRuns, workflowVersions } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import { readWorkflowDefinition } from "@thinkwork/agent-loops-core";
import {
  assertStageAllowedForScope,
  assertTargetInTenant,
  getProcessorConfig,
  getSourceConfig,
  listEnabledSourceConfigs,
  MemoryScopeError,
} from "../lib/memory-sources/repository.js";
import type { MemorySourceConfig } from "../lib/memory-sources/types.js";
import {
  failed,
  overrideFrom,
  runAcquire,
  runCompound,
  runExtract,
  runGraph,
  runProject,
  runResolve,
  runRetain,
  type StageContext,
} from "../lib/memory-sources/stages.js";
import { runPreflight } from "../lib/memory-sources/preflight.js";

// Frozen dispatch<->worker protocol — shared with workflow-step-dispatch via
// @thinkwork/agent-loops-core so the shapes cannot drift.
import type {
  MemoryStageWorkerInvokePayload,
  MemoryStageWorkerResult,
} from "@thinkwork/agent-loops-core";

export type MemoryStageWorkerEvent = MemoryStageWorkerInvokePayload;
export type { MemoryStageWorkerResult };

const _DEFAULT_SFN_CLIENT = new SFNClient({});

/** Event-invoke this same worker with the identical payload (F7
 * continuation). The shared api role may invoke every api Lambda,
 * including this one. */
async function defaultSelfInvoke(event: MemoryStageWorkerEvent): Promise<void> {
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const stage = process.env.STAGE;
  const fnName =
    process.env.MEMORY_STAGE_WORKER_FUNCTION_NAME ??
    (stage ? `thinkwork-${stage}-api-memory-stage-worker` : undefined);
  if (!fnName) {
    throw new Error(
      "continuation self-invoke unavailable: MEMORY_STAGE_WORKER_FUNCTION_NAME / STAGE are unset",
    );
  }
  await new LambdaClient({}).send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    }),
  );
}
const CONSUMED_ERROR_NAMES = new Set(["TaskDoesNotExist", "TaskTimedOut"]);

/** Lease handle passed to stages so long-running/continuation work can keep
 * its execution claim fresh (Codex F7). */
export interface MemoryStageLease {
  lockedBy: string;
  renew(): Promise<boolean>;
}

/** Injectable token operations — defaults are the real durable-claim
 * functions from @thinkwork/database-pg; tests supply in-memory versions. */
export interface MemoryStageTokenOps {
  claim: typeof claimTaskTokenExecution;
  persist: typeof persistTaskTokenResult;
  renewLease: typeof renewTaskTokenLease;
}

const DEFAULT_TOKEN_OPS: MemoryStageTokenOps = {
  claim: claimTaskTokenExecution,
  persist: persistTaskTokenResult,
  renewLease: renewTaskTokenLease,
};

// ---------------------------------------------------------------------------
// Binding validation (Codex F1): the claimed token only proves a park exists
// for (run, step, iteration). Before executing, the payload must also match
// what the workflow definition actually says this step is — a forged/stale
// direct invocation must not run an arbitrary stage or processor.
// ---------------------------------------------------------------------------

async function validateMemoryStageBinding(
  db: Database,
  event: MemoryStageWorkerEvent,
): Promise<string | null> {
  const [run] = await db
    .select({
      tenant_id: workflowRuns.tenant_id,
      workflow_version_id: workflowRuns.workflow_version_id,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, event.workflowRunId))
    .limit(1);
  if (!run) return `workflow run ${event.workflowRunId} not found`;
  if (run.tenant_id !== event.tenantId) {
    return "workflow run belongs to another tenant — refusing cross-tenant execution";
  }
  if (!run.workflow_version_id) {
    return "workflow run has no published workflow version — cannot validate the memory_stage step";
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
    return `workflow version ${run.workflow_version_id} does not hold a valid workflow definition`;
  }
  const step = definition.steps.find((s) => s.id === event.stepId);
  if (!step || step.kind !== "memory_stage") {
    return `step ${event.stepId} is not a memory_stage step in this workflow definition`;
  }
  if (step.stage !== event.stage) {
    return `stage mismatch: definition binds step ${event.stepId} to stage "${step.stage}", payload says "${event.stage}"`;
  }
  // The definition may hold a {{ }} template that dispatch resolved at park
  // time — we cannot recompute the resolution here, so skip the equality
  // check; tenant ownership of the concrete processor row is still enforced
  // by executeStage (getProcessorConfig + tenant check) before any side
  // effects.
  if (
    !step.processorConfigId.includes("{{") &&
    step.processorConfigId !== event.processorConfigId
  ) {
    return `processorConfigId mismatch: definition binds step ${event.stepId} to ${step.processorConfigId}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function executeStage(
  db: Database,
  event: MemoryStageWorkerEvent,
  lease: MemoryStageLease,
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
    // U3: personal processors (mode personal, target_scope user) run the
    // pipeline; graph/wiki remain shared-only and hard-reject user_* (AE7).
    assertStageAllowedForScope(processor, event.stage);
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
    // U3 blueprint steps omit sourceConfigId: the stage runs the processor's
    // full ENABLED source set. Zero sources is a stage-level visible no-op.
    sources = await listEnabledSourceConfigs(db, {
      tenantId: event.tenantId,
      processorConfigId: processor.id,
    });
  }

  // U3: every implemented source family writes shared banks; a personal
  // processor carrying one is a mis-configuration, rejected before any read.
  if (processor.mode === "personal") {
    const sharedOnly = sources.filter((s) =>
      SHARED_ONLY_SOURCE_FAMILIES.has(s.source_family),
    );
    if (sharedOnly.length > 0) {
      return failed(
        event.stage,
        `personal processor ${processor.id} is bound to shared-only source famil${sharedOnly.length > 1 ? "ies" : "y"} (${[...new Set(sharedOnly.map((s) => s.source_family))].join(", ")}) — personal source families arrive with the Gmail tracer (U6)`,
      );
    }
  }

  // Approved-plan override (U3): a reviewer's source selection NARROWS the
  // configured set by intersection — ids outside the processor's own sources
  // simply select nothing; nothing can be added.
  const override = overrideFrom(event.options);
  if (override?.sourceConfigIds) {
    const allowed = new Set(override.sourceConfigIds);
    sources = sources.filter((source) => allowed.has(source.id));
  }

  const ctx: StageContext = {
    db,
    event,
    processor,
    sources,
    lease,
  };

  switch (event.stage) {
    case "preflight":
      return runPreflight(ctx);
    case "acquire":
      return runAcquire(ctx);
    case "extract":
      return runExtract(ctx);
    case "project":
      return runProject(ctx);
    case "resolve":
      return runResolve(ctx);
    case "retain":
      return runRetain(ctx);
    case "compound":
      return runCompound(ctx);
    case "graph":
      return runGraph(ctx);
    // "wiki" remains in MEMORY_RUN_ITEM_STAGES for historic run-item rows,
    // but the compile pipeline it drove is retired — it dispatches nowhere.
    default:
      return failed(
        event.stage,
        `unknown memory stage "${event.stage}" — supported: preflight|acquire|extract|project|resolve|retain|compound|graph`,
      );
  }
}

/** Source families whose evidence/claims write shared scopes only (U3). */
const SHARED_ONLY_SOURCE_FAMILIES = new Set([
  "twenty",
  "firecrawl",
  "bedrock_kb",
]);

async function sendTaskSuccess(
  sfn: SFNClient,
  token: string,
  result: unknown,
): Promise<"sent" | "already_resolved" | "send_failed"> {
  try {
    await sfn.send(
      new SendTaskSuccessCommand({
        taskToken: token,
        output: JSON.stringify(result),
      }),
    );
    return "sent";
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (CONSUMED_ERROR_NAMES.has(name)) return "already_resolved";
    console.error(
      `[memory-stage-worker] SendTaskSuccess failed (${name}): ${(err as Error)?.message}`,
    );
    return "send_failed";
  }
}

export interface MemoryStageWorkerOptions {
  db?: Database;
  sfnClient?: SFNClient;
  tokenOps?: Partial<MemoryStageTokenOps>;
  /** Claim identity; defaults to the Lambda request id (handler) or a
   * random id. */
  lockedBy?: string;
  /** Test seam for the F7 continuation self-invoke. */
  selfInvoke?: (event: MemoryStageWorkerEvent) => Promise<void>;
}

export async function runMemoryStageWorker(
  event: MemoryStageWorkerEvent,
  options: MemoryStageWorkerOptions = {},
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  const db = options.db ?? getDb();
  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;
  const tokenOps: MemoryStageTokenOps = {
    ...DEFAULT_TOKEN_OPS,
    ...options.tokenOps,
  };
  const lockedBy = options.lockedBy ?? `memory-stage-worker:${randomUUID()}`;

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

  const tokenKey = {
    workflowRunId: event.workflowRunId,
    stepId: event.stepId,
    iteration: event.iteration,
    purpose: "memory_stage" as const,
  };

  // Pre-execution durable claim (Codex F1): prove a matching parked token
  // exists and win it BEFORE touching sources or banks. A duplicate Event
  // delivery or a direct invocation finds nothing claimable and performs
  // zero side effects. A stale `executing` claim (> lease window) is
  // re-claimable so a crashed worker's retry can proceed (Codex F7).
  const claim = await tokenOps.claim(db, { ...tokenKey, lockedBy });
  if (!claim) {
    console.warn(
      `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} step=${event.stepId} iter=${event.iteration}: no claimable task token — duplicate or direct invocation, refusing to execute`,
    );
    return {
      result: failed(
        event.stage,
        "no claimable task token for this step — duplicate or direct invocation refused",
      ),
      resume: "no_claim",
    };
  }
  if ("redrive" in claim) {
    // Codex F9: a prior invocation persisted the completion result but its
    // SendTaskSuccess failed transiently. Re-send the durable result without
    // re-executing anything.
    const outcome = await sendTaskSuccess(
      sfn,
      claim.redrive.token,
      claim.redrive.result,
    );
    const resume =
      outcome === "sent"
        ? "redriven"
        : outcome === "already_resolved"
          ? "already_resolved"
          : "persisted_unsent";
    console.log(
      `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} redrive of persisted result: ${resume}`,
    );
    return {
      result: claim.redrive.result as MemoryStageWorkerResult,
      resume,
    };
  }

  let result: MemoryStageWorkerResult;
  // Binding validation (Codex F1): the payload must match what the run's
  // workflow definition says this step is. On mismatch, fail visibly with
  // zero stage side effects.
  let bindingError: string | null;
  try {
    bindingError = await validateMemoryStageBinding(db, event);
  } catch (err) {
    bindingError = `binding validation crashed: ${(err as Error)?.message ?? String(err)}`;
  }
  if (bindingError) {
    console.error(
      `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} binding mismatch: ${bindingError}`,
    );
    result = failed(event.stage, bindingError.slice(0, 500));
  } else {
    const lease: MemoryStageLease = {
      lockedBy,
      renew: () => tokenOps.renewLease(db, { ...tokenKey, lockedBy }),
    };
    try {
      result = await executeStage(db, event, lease);
    } catch (err) {
      // Never leave the machine parked: unexpected errors resume as a visible
      // stage failure. Checkpoints are transactional, so a crashed acquire
      // left no partial advance behind.
      const message = (err as Error)?.message ?? String(err);
      console.error(
        `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} crashed: ${message}`,
      );
      result = failed(event.stage, message.slice(0, 500));
    }
  }

  // Continuation (Codex F7): a bounded stage that stopped with work left
  // re-invokes this same Lambda with the identical payload instead of
  // resuming the state machine. The lease stays held (renewed), the token
  // stays `executing`, and the staleness-based work lists resume where the
  // batch stopped. Only genuinely-succeeded-with-remaining results continue.
  if (
    result.status === "succeeded" &&
    (result.output as Record<string, unknown> | undefined)?.continuation ===
      true
  ) {
    const renewed = await tokenOps.renewLease(db, { ...tokenKey, lockedBy });
    if (renewed) {
      try {
        await (options.selfInvoke ?? defaultSelfInvoke)(event);
        console.log(
          `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} continuing (remaining=${(result.output as Record<string, unknown>).remaining ?? "?"})`,
        );
        return { result, resume: "continuation" };
      } catch (err) {
        console.error(
          `[memory-stage-worker] continuation self-invoke failed — resuming with partial progress: ${(err as Error)?.message}`,
        );
        // Fall through: resume the machine with the partial (still
        // successful, idempotently resumable) result rather than parking.
      }
    }
    // Lease lost: another invocation took over; it owns the continuation.
    if (!renewed) return { result, resume: "continuation_superseded" };
  }

  // Persist-then-send (Codex F9): the completion result becomes durable
  // (executing -> consumed) BEFORE SendTaskSuccess. If the send fails
  // transiently, the token stays consumed with its result attached — a retry
  // or manual re-invoke takes the redrive path above and re-sends. The old
  // revert-to-pending on send failure is gone: it could re-run side effects.
  const persisted = await tokenOps.persist(db, { ...tokenKey, result });
  let resume: string;
  if (!persisted) {
    // Claim was taken over (stale-lease re-claim) or resolved elsewhere; the
    // winner owns the resume.
    resume = "claim_lost";
  } else {
    const outcome = await sendTaskSuccess(sfn, persisted.token, result);
    resume =
      outcome === "sent"
        ? "resumed"
        : outcome === "already_resolved"
          ? "already_resolved"
          : "persisted_unsent";
  }

  console.log(
    `[memory-stage-worker] stage=${event.stage} run=${event.workflowRunId} status=${result.status} resume=${resume} counts=${JSON.stringify(result.counts ?? {})}`,
  );
  return { result, resume };
}

export async function handler(
  event: MemoryStageWorkerEvent,
  context?: { awsRequestId?: string },
): Promise<{ result: MemoryStageWorkerResult; resume: string }> {
  return runMemoryStageWorker(event, {
    lockedBy: context?.awsRequestId
      ? `lambda:${context.awsRequestId}`
      : undefined,
  });
}
