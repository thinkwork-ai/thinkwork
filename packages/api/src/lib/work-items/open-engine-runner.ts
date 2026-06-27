import {
  dispatchAgentLoop,
  workerAgentId,
  type AgentLoopDispatchInput,
  type AgentLoopDispatchLedger,
  type AgentLoopDispatchResult,
  type DispatchableAgentLoop,
  type DispatchableAgentLoopVersion,
} from "@thinkwork/agent-loops-core";

import {
  claimNextOpenEngineWorkItem,
  type OpenEngineWorkItem,
} from "./open-engine-queue-service.js";
import {
  recordOpenEngineReceipt,
  type OpenEngineWorkItemEvent,
} from "./open-engine-receipt-service.js";

export const OPEN_ENGINE_RUNNER_TRIGGER_SOURCE = "open_engine_queue";

type ClaimNextOpenEngineWorkItem = typeof claimNextOpenEngineWorkItem;
type RecordOpenEngineReceipt = typeof recordOpenEngineReceipt;
type DispatchAgentLoop = typeof dispatchAgentLoop;

export interface RunOpenEngineQueueOnceInput {
  tenantId: string;
  queueKey?: string | null;
  loop: DispatchableAgentLoop;
  version: DispatchableAgentLoopVersion | null;
  ledger: AgentLoopDispatchLedger;
  threadId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  leaseSeconds?: number | null;
  scheduleGate?: AgentLoopDispatchInput["scheduleGate"];
  now?: Date;
  deps?: {
    claimNextOpenEngineWorkItem?: ClaimNextOpenEngineWorkItem;
    recordOpenEngineReceipt?: RecordOpenEngineReceipt;
    dispatchAgentLoop?: DispatchAgentLoop;
  };
}

export type OpenEngineRunnerResult =
  | { status: "no_work" }
  | { status: "skipped"; reason: string }
  | {
      status: "queued";
      workItemId: string;
      claimReceiptId: string;
      runId: string;
      iterationId: string;
      wakeupId: string;
    }
  | {
      status: "reused";
      workItemId: string;
      claimReceiptId: string;
      runId: string;
      runStatus: string;
    }
  | {
      status: "failed";
      workItemId?: string;
      claimReceiptId?: string;
      runId?: string;
      iterationId?: string;
      error: string;
    };

export async function runOpenEngineQueueOnce(
  input: RunOpenEngineQueueOnceInput,
): Promise<OpenEngineRunnerResult> {
  const now = input.now ?? new Date();
  const preflight = evaluateRunnerPreflight(input);
  if (!preflight.ok) return { status: "skipped", reason: preflight.reason };

  const deps = {
    claimNextOpenEngineWorkItem:
      input.deps?.claimNextOpenEngineWorkItem ?? claimNextOpenEngineWorkItem,
    recordOpenEngineReceipt:
      input.deps?.recordOpenEngineReceipt ?? recordOpenEngineReceipt,
    dispatchAgentLoop: input.deps?.dispatchAgentLoop ?? dispatchAgentLoop,
  };

  const workItem = await deps.claimNextOpenEngineWorkItem({
    tenantId: input.tenantId,
    queueKey: input.queueKey ?? null,
    agentId: preflight.workerAgentId,
    leaseSeconds: input.leaseSeconds,
    now,
  });
  if (!workItem) return { status: "no_work" };

  let claimReceipt: OpenEngineWorkItemEvent;
  try {
    claimReceipt = await deps.recordOpenEngineReceipt({
      tenantId: input.tenantId,
      workItemId: workItem.id,
      agentId: preflight.workerAgentId,
      receiptType: "claimed",
      threadId: input.threadId ?? null,
      message: `Open Engine claimed Work Item ${workItem.id}.`,
      evidence: {
        queueKey: input.queueKey ?? null,
        claimExpiresAt:
          workItem.open_engine_claim_expires_at?.toISOString?.() ?? null,
      },
      metadata: {
        runner: "thin_smoke",
      },
      now,
    });
  } catch (error) {
    return {
      status: "failed",
      workItemId: workItem.id,
      error: boundedError(error),
    };
  }

  const inputSummary = buildOpenEngineInputSummary({
    workItem,
    queueKey: input.queueKey ?? null,
    claimReceiptId: claimReceipt.id,
  });
  const dispatchInput: AgentLoopDispatchInput = {
    tenantId: input.tenantId,
    loop: input.loop,
    version: input.version,
    trigger: {
      family: "api",
      source: OPEN_ENGINE_RUNNER_TRIGGER_SOURCE,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null,
      threadId: input.threadId ?? null,
      spaceId: workItem.space_id,
      idempotencyKey: buildOpenEngineDispatchIdempotencyKey({
        tenantId: input.tenantId,
        workItem,
        now,
      }),
      correlationId:
        input.correlationId ?? `open-engine:${input.tenantId}:${workItem.id}`,
      inputSummary,
    },
    scheduleGate: input.scheduleGate,
    now,
  };

  let dispatchResult: AgentLoopDispatchResult;
  try {
    dispatchResult = await deps.dispatchAgentLoop(dispatchInput, input.ledger);
  } catch (error) {
    const message = boundedError(error);
    await recordFailedDispatchReceipt({
      deps,
      input,
      workItem,
      workerAgentId: preflight.workerAgentId,
      claimReceipt,
      now,
      message,
    });
    return {
      status: "failed",
      workItemId: workItem.id,
      claimReceiptId: claimReceipt.id,
      error: message,
    };
  }

  if (dispatchResult.status === "queued") {
    return {
      status: "queued",
      workItemId: workItem.id,
      claimReceiptId: claimReceipt.id,
      runId: dispatchResult.runId,
      iterationId: dispatchResult.iterationId,
      wakeupId: dispatchResult.wakeupId,
    };
  }

  if (dispatchResult.status === "reused") {
    return {
      status: "reused",
      workItemId: workItem.id,
      claimReceiptId: claimReceipt.id,
      runId: dispatchResult.runId,
      runStatus: dispatchResult.runStatus,
    };
  }

  const message =
    dispatchResult.status === "failed"
      ? dispatchResult.error
      : dispatchResult.reason;
  await recordFailedDispatchReceipt({
    deps,
    input,
    workItem,
    workerAgentId: preflight.workerAgentId,
    claimReceipt,
    now,
    message,
  });
  return {
    status: "failed",
    workItemId: workItem.id,
    claimReceiptId: claimReceipt.id,
    runId: dispatchResult.runId,
    iterationId: dispatchResult.iterationId,
    error: message,
  };
}

function evaluateRunnerPreflight(
  input: RunOpenEngineQueueOnceInput,
): { ok: true; workerAgentId: string } | { ok: false; reason: string } {
  if (!input.loop.enabled)
    return { ok: false, reason: "AgentLoop is disabled." };
  if (input.loop.lifecycleStatus !== "active") {
    return {
      ok: false,
      reason: `AgentLoop lifecycle is ${input.loop.lifecycleStatus}.`,
    };
  }
  if (!input.version) return { ok: false, reason: "AgentLoop has no version." };
  if (input.version.versionStatus !== "active") {
    return {
      ok: false,
      reason: `AgentLoop version is ${input.version.versionStatus}.`,
    };
  }
  if (input.version.loopPolicy.maxIterations < 1) {
    return {
      ok: false,
      reason: "AgentLoop policy allows no iterations.",
    };
  }
  if (input.scheduleGate?.enabled === false) {
    return { ok: false, reason: "AgentLoop schedule is disabled." };
  }
  if (input.scheduleGate?.budgetPaused) {
    return {
      ok: false,
      reason:
        input.scheduleGate.reason ??
        "AgentLoop schedule is paused because its budget is exhausted.",
    };
  }
  const id = workerAgentId(input.version.workerSpec);
  if (!id)
    return { ok: false, reason: "AgentLoop v1 requires a worker agent." };
  return { ok: true, workerAgentId: id };
}

function buildOpenEngineInputSummary(input: {
  workItem: OpenEngineWorkItem;
  queueKey: string | null;
  claimReceiptId: string;
}): Record<string, unknown> {
  return {
    source: "open_engine",
    queueKey: input.queueKey,
    workItem: {
      id: input.workItem.id,
      title: input.workItem.title,
      spaceId: input.workItem.space_id,
      priority: input.workItem.priority,
      claimReceiptId: input.claimReceiptId,
    },
  };
}

function buildOpenEngineDispatchIdempotencyKey(input: {
  tenantId: string;
  workItem: OpenEngineWorkItem;
  now: Date;
}) {
  const claimedAt = input.workItem.open_engine_claimed_at ?? input.now;
  return `open-engine:${input.tenantId}:${input.workItem.id}:${claimedAt.toISOString()}`;
}

async function recordFailedDispatchReceipt(input: {
  deps: Required<NonNullable<RunOpenEngineQueueOnceInput["deps"]>>;
  input: RunOpenEngineQueueOnceInput;
  workItem: OpenEngineWorkItem;
  workerAgentId: string;
  claimReceipt: OpenEngineWorkItemEvent;
  now: Date;
  message: string;
}) {
  await input.deps.recordOpenEngineReceipt({
    tenantId: input.input.tenantId,
    workItemId: input.workItem.id,
    agentId: input.workerAgentId,
    receiptType: "failed",
    threadId: input.input.threadId ?? null,
    message: `Open Engine dispatch failed: ${input.message}`,
    evidence: {
      claimReceiptId: input.claimReceipt.id,
      error: input.message,
    },
    metadata: {
      runner: "thin_smoke",
    },
    now: input.now,
  });
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}
