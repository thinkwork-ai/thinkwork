import { describe, expect, it, vi } from "vitest";
import type {
  AgentLoopCreateIterationInput,
  AgentLoopCreateRunInput,
  AgentLoopDispatchLedger,
  AgentLoopEnqueueWakeupInput,
  DispatchableAgentLoop,
  DispatchableAgentLoopVersion,
} from "@thinkwork/agent-loops-core";

import {
  runOpenEngineQueueOnce,
  type RunOpenEngineQueueOnceInput,
} from "./open-engine-runner.js";
import type { OpenEngineWorkItem } from "./open-engine-queue-service.js";

const now = new Date("2026-06-27T13:00:00.000Z");

const baseLoop: DispatchableAgentLoop = {
  id: "loop-1",
  tenantId: "tenant-1",
  name: "Open Engine worker",
  enabled: true,
  lifecycleStatus: "active",
};

const baseVersion: DispatchableAgentLoopVersion = {
  id: "version-1",
  versionStatus: "active",
  goalSpec: {
    objective: "Work exactly one Open Engine item.",
    completionCriteria: ["One Work Item has evidence or a blocker receipt."],
  },
  workerSpec: {
    type: "agent" as const,
    id: "agent-1",
    toolHints: [],
    config: {},
  },
  judgeSpec: {
    mode: "self_check",
    criteria: ["The Work Item has a receipt."],
    config: {},
  },
  loopPolicy: {
    maxIterations: 1,
    maxTokens: 12_000,
    failBehavior: "return_blocker",
    escalateOnFailure: false,
  },
};

function workItem(
  overrides: Partial<OpenEngineWorkItem> = {},
): OpenEngineWorkItem {
  return {
    id: "work-item-1",
    tenant_id: "tenant-1",
    space_id: "space-1",
    status_id: "status-1",
    title: "Collect onboarding details",
    notes: null,
    priority: "high",
    owner_user_id: null,
    owner_agent_id: null,
    due_at: null,
    required: true,
    applicable: true,
    blocked: false,
    completed_at: null,
    completed_by_user_id: null,
    completed_by_agent_id: null,
    template_source_id: null,
    metadata: {},
    created_by_user_id: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    external_provider: null,
    external_ref_id: null,
    external_ref_url: null,
    open_engine_enabled: true,
    open_engine_queue_key: "default",
    open_engine_claimed_by_agent_id: "agent-1",
    open_engine_claimed_at: now,
    open_engine_claim_expires_at: new Date("2026-06-27T13:15:00.000Z"),
    open_engine_human_hold: false,
    open_engine_human_hold_reason: null,
    open_engine_scheduled_at: null,
    open_engine_dependency_state: "ready",
    open_engine_routing: {},
    ...overrides,
  } as OpenEngineWorkItem;
}

function fakeLedger(
  overrides: Partial<AgentLoopDispatchLedger> = {},
): AgentLoopDispatchLedger & {
  runs: AgentLoopCreateRunInput[];
  iterations: AgentLoopCreateIterationInput[];
  wakeups: AgentLoopEnqueueWakeupInput[];
} {
  const ledger = {
    runs: [] as AgentLoopCreateRunInput[],
    iterations: [] as AgentLoopCreateIterationInput[],
    wakeups: [] as AgentLoopEnqueueWakeupInput[],
    findRunByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createRun: vi.fn(async (input: AgentLoopCreateRunInput) => {
      ledger.runs.push(input);
      return { id: "run-1", status: input.status };
    }),
    createIteration: vi.fn(async (input: AgentLoopCreateIterationInput) => {
      ledger.iterations.push(input);
      return { id: "iteration-1" };
    }),
    enqueueWakeup: vi.fn(async (input: AgentLoopEnqueueWakeupInput) => {
      ledger.wakeups.push(input);
      return { id: "wakeup-1" };
    }),
    markIterationWakeup: vi.fn(),
    markDispatchFailed: vi.fn(),
    updateLoopAfterDispatch: vi.fn(),
    ...overrides,
  };
  return ledger;
}

function baseInput(
  overrides: Partial<RunOpenEngineQueueOnceInput> = {},
  deps: Parameters<typeof runOpenEngineQueueOnce>[0]["deps"] = {},
): RunOpenEngineQueueOnceInput {
  return {
    tenantId: "tenant-1",
    queueKey: "default",
    loop: baseLoop,
    version: baseVersion,
    ledger: fakeLedger(),
    threadId: "thread-1",
    actorType: "system",
    actorId: "open-engine-runner",
    now,
    deps,
    ...overrides,
  };
}

describe("runOpenEngineQueueOnce", () => {
  it("claims one eligible Work Item, records a receipt, and queues one wakeup with Work Item context", async () => {
    const claimed = workItem();
    const recordOpenEngineReceipt = vi.fn(async () => ({
      id: "receipt-1",
    })) as never;
    const claimNextOpenEngineWorkItem = vi.fn(async () => claimed) as never;
    const ledger = fakeLedger();

    const result = await runOpenEngineQueueOnce(
      baseInput(
        { ledger },
        {
          claimNextOpenEngineWorkItem,
          recordOpenEngineReceipt,
        },
      ),
    );

    expect(result).toEqual({
      status: "queued",
      workItemId: "work-item-1",
      claimReceiptId: "receipt-1",
      runId: "run-1",
      iterationId: "iteration-1",
      wakeupId: "wakeup-1",
    });
    expect(claimNextOpenEngineWorkItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      queueKey: "default",
      agentId: "agent-1",
      leaseSeconds: undefined,
      now,
    });
    expect(recordOpenEngineReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workItemId: "work-item-1",
        agentId: "agent-1",
        receiptType: "claimed",
        threadId: "thread-1",
      }),
    );
    expect(ledger.runs[0]).toMatchObject({
      triggerFamily: "api",
      triggerSource: "open_engine_queue",
      idempotencyKey:
        "open-engine:tenant-1:work-item-1:2026-06-27T13:00:00.000Z",
      inputSummary: {
        source: "open_engine",
        queueKey: "default",
        workItem: {
          id: "work-item-1",
          title: "Collect onboarding details",
          spaceId: "space-1",
          priority: "high",
          claimReceiptId: "receipt-1",
        },
      },
    });
    expect(ledger.wakeups).toHaveLength(1);
    expect(ledger.wakeups[0]).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      source: "agent_loop",
      payload: {
        threadId: "thread-1",
        spaceId: "space-1",
        inputSummary: {
          source: "open_engine",
          workItem: {
            id: "work-item-1",
            claimReceiptId: "receipt-1",
          },
        },
        agentLoop: {
          triggerFamily: "api",
          triggerSource: "open_engine_queue",
        },
      },
    });
  });

  it("returns no_work and enqueues nothing when the queue has no eligible Work Item", async () => {
    const claimNextOpenEngineWorkItem = vi.fn(async () => null) as never;
    const dispatchAgentLoop = vi.fn() as never;
    const ledger = fakeLedger();

    await expect(
      runOpenEngineQueueOnce(
        baseInput(
          { ledger },
          {
            claimNextOpenEngineWorkItem,
            dispatchAgentLoop,
          },
        ),
      ),
    ).resolves.toEqual({ status: "no_work" });

    expect(ledger.wakeups).toHaveLength(0);
    expect(dispatchAgentLoop).not.toHaveBeenCalled();
  });

  it("does not enqueue a second action after the queue reports a held item as ineligible", async () => {
    const claimNextOpenEngineWorkItem = vi
      .fn()
      .mockResolvedValueOnce(workItem())
      .mockResolvedValueOnce(null) as never;
    const recordOpenEngineReceipt = vi.fn(async () => ({
      id: "receipt-1",
    })) as never;
    const ledger = fakeLedger();

    await runOpenEngineQueueOnce(
      baseInput(
        { ledger },
        {
          claimNextOpenEngineWorkItem,
          recordOpenEngineReceipt,
        },
      ),
    );
    const second = await runOpenEngineQueueOnce(
      baseInput(
        { ledger },
        {
          claimNextOpenEngineWorkItem,
          recordOpenEngineReceipt,
        },
      ),
    );

    expect(second).toEqual({ status: "no_work" });
    expect(ledger.wakeups).toHaveLength(1);
  });

  it("records a failed receipt and releases the claim when dispatch cannot enqueue", async () => {
    const recordOpenEngineReceipt = vi
      .fn()
      .mockResolvedValueOnce({ id: "receipt-1" })
      .mockResolvedValueOnce({ id: "receipt-failed" }) as never;
    const ledger = fakeLedger({
      enqueueWakeup: vi.fn(async () => {
        throw new Error("queue unavailable");
      }),
    });

    const result = await runOpenEngineQueueOnce(
      baseInput(
        { ledger },
        {
          claimNextOpenEngineWorkItem: vi.fn(async () => workItem()) as never,
          recordOpenEngineReceipt,
        },
      ),
    );

    expect(result).toMatchObject({
      status: "failed",
      workItemId: "work-item-1",
      claimReceiptId: "receipt-1",
      error: "queue unavailable",
    });
    expect(recordOpenEngineReceipt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        receiptType: "failed",
        evidence: {
          claimReceiptId: "receipt-1",
          error: "queue unavailable",
        },
      }),
    );
  });

  it("reuses an existing dispatch for the same Work Item claim idempotency key", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.findRunByIdempotencyKey).mockResolvedValueOnce({
      id: "run-existing",
      status: "queued",
    });

    const result = await runOpenEngineQueueOnce(
      baseInput(
        { ledger },
        {
          claimNextOpenEngineWorkItem: vi.fn(async () => workItem()) as never,
          recordOpenEngineReceipt: vi.fn(async () => ({
            id: "receipt-1",
          })) as never,
        },
      ),
    );

    expect(result).toEqual({
      status: "reused",
      workItemId: "work-item-1",
      claimReceiptId: "receipt-1",
      runId: "run-existing",
      runStatus: "queued",
    });
    expect(ledger.enqueueWakeup).not.toHaveBeenCalled();
  });
});
