/**
 * memory-stage-sweeper tests (THINK-193 U3): stalled/redrivable tokens are
 * re-invoked through the worker's claim protocol; unrecoverable parks get
 * ONE terminal stage event and a SendTaskFailure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return { ...actual, getDb: vi.fn() };
});

import {
  sweepMemoryStageTokens,
  type MemoryStageSweeperDeps,
} from "./memory-stage-sweeper.js";

type Rows = Record<string, unknown>[];

function makeDb() {
  const selects: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const next = () => Promise.resolve(selects.shift() ?? []);
  const tail = (): Record<string, unknown> => ({
    limit: () => next(),
    orderBy: () => ({
      limit: () => next(),
      then: (resolve: (rows: Rows) => unknown) => next().then(resolve),
    }),
    then: (resolve: (rows: Rows) => unknown) => next().then(resolve),
  });
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => tail() }),
        where: () => tail(),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        });
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return {
          where: () =>
            Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve([]),
            }),
        };
      },
    }),
  };
  return { db: db as never, selects, inserts, updates };
}

const NOW = new Date("2026-07-12T12:00:00Z");

const DEFINITION = {
  version: 1,
  steps: [
    {
      id: "acquire",
      kind: "memory_stage",
      stage: "acquire",
      processorConfigId: "proc-1",
    },
  ],
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    token_id: "tok-row-1",
    token: "sfn-token-1",
    status: "executing",
    step_id: "acquire",
    iteration: 1,
    workflow_run_id: "run-1",
    tenant_id: "t1",
    run_status: "running",
    workflow_version_id: "ver-1",
    input_summary: {},
    ...overrides,
  };
}

let deps: MemoryStageSweeperDeps & {
  invokeWorker: ReturnType<typeof vi.fn>;
  sendTaskFailure: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  deps = {
    invokeWorker: vi.fn(async () => {}),
    sendTaskFailure: vi.fn(async () => {}),
  };
});

describe("sweepMemoryStageTokens", () => {
  it("no candidates is a clean no-op", async () => {
    const { db, selects } = makeDb();
    selects.push([]);
    const result = await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(result).toMatchObject({ candidates: 0, reinvoked: 0 });
    expect(deps.invokeWorker).not.toHaveBeenCalled();
  });

  it("re-invokes the worker with the reconstructed payload for a stalled executing token", async () => {
    const { db, selects } = makeDb();
    selects.push(
      [candidate()],
      [{ definition_snapshot: DEFINITION }], // version
      [], // step outputs
    );
    const result = await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(result).toMatchObject({ candidates: 1, reinvoked: 1 });
    expect(deps.invokeWorker).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      tenantId: "t1",
      stepId: "acquire",
      iteration: 1,
      stage: "acquire",
      processorConfigId: "proc-1",
      sourceConfigId: null,
      options: null,
    });
    expect(deps.sendTaskFailure).not.toHaveBeenCalled();
  });

  it("keeps the approved-plan override on a redriven payload", async () => {
    const { db, selects } = makeDb();
    selects.push(
      [candidate({ status: "pending" })],
      [{ definition_snapshot: DEFINITION }],
      [
        {
          summary: {
            stepId: "plan-review",
            output: { approvalOverride: { sourceConfigIds: ["src-1"] } },
          },
          created_at: NOW,
        },
      ], // step outputs
    );
    await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(deps.invokeWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { override: { sourceConfigIds: ["src-1"] } },
      }),
    );
  });

  it("unrecoverable park -> one terminal step event, token expired, SendTaskFailure", async () => {
    const { db, selects, inserts, updates } = makeDb();
    selects.push(
      [candidate({ step_id: "gone-step" })],
      [{ definition_snapshot: DEFINITION }], // version has no such step
    );
    const result = await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(result).toMatchObject({ candidates: 1, failed_terminal: 1 });
    const failedEvent = inserts.find(
      (row) => row.event_type === "workflow_step_failed",
    ) as { payload_summary?: Record<string, unknown> };
    expect(failedEvent?.payload_summary).toMatchObject({
      stepId: "gone-step",
      reason: "memory_stage_unrecoverable",
    });
    expect(updates.some((row) => row.status === "expired")).toBe(true);
    expect(deps.sendTaskFailure).toHaveBeenCalledWith({
      token: "sfn-token-1",
      error: "MemoryStageUnrecoverable",
      cause: expect.stringContaining("not a memory_stage step"),
    });
  });

  it("a consumed token never gets SendTaskFailure (its result already resolved the state)", async () => {
    const { db, selects } = makeDb();
    selects.push([
      candidate({ status: "consumed", workflow_version_id: null }),
    ]);
    const result = await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(result.failed_terminal).toBe(1);
    expect(deps.sendTaskFailure).not.toHaveBeenCalled();
  });

  it("one failing item does not stop the batch", async () => {
    const { db, selects } = makeDb();
    deps.invokeWorker
      .mockRejectedValueOnce(new Error("invoke throttled"))
      .mockResolvedValueOnce(undefined);
    selects.push(
      [candidate(), candidate({ token_id: "tok-2", workflow_run_id: "run-2" })],
      [{ definition_snapshot: DEFINITION }],
      [],
      [{ definition_snapshot: DEFINITION }],
      [],
    );
    const result = await sweepMemoryStageTokens(db, { now: NOW, deps });
    expect(result).toMatchObject({ candidates: 2, reinvoked: 1, errors: 1 });
  });
});
