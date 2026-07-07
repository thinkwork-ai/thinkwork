/**
 * Unit tests for the workflow interpreter execution-callback Lambda
 * (THINK-219 U5). Fake-db style: handleExecutionCallback takes a db handle so
 * the real updateInterpreterRunFromExecution + recordWorkflowStepEvent run
 * against an in-memory fake.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  handleExecutionCallback,
  type SfnStatusChangeEvent,
} from "../workflow-execution-callback";

type Rows = Record<string, unknown>[];

interface FakeDb {
  db: unknown;
  selectQueue: Rows[];
  updateQueue: Rows[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

function makeDb(): FakeDb {
  const selectQueue: Rows[] = [];
  const updateQueue: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        const rows = Promise.resolve([] as Rows);
        return Object.assign(rows, {
          returning: () => Promise.resolve([] as Rows),
        });
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        const rows = updateQueue.shift() ?? [];
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              returning: () => Promise.resolve(rows),
            }),
        };
      },
    }),
  };

  return { db, selectQueue, updateQueue, inserts, updates };
}

const NOW = new Date("2026-07-07T12:00:00.000Z");

let fake: FakeDb;
beforeEach(() => {
  fake = makeDb();
});

function event(
  status: SfnStatusChangeEvent["detail"]["status"],
  extra: Partial<SfnStatusChangeEvent["detail"]> = {},
): SfnStatusChangeEvent {
  return {
    detail: { executionArn: "arn:exec", status, ...extra },
  };
}

describe("handleExecutionCallback", () => {
  it("FAILED on the current ARN → run failed + step event in ThinkWork terms", async () => {
    fake.selectQueue.push([{ id: "run-1", tenant_id: "t1" }]); // existing run
    fake.updateQueue.push([{ id: "run-1" }]); // guarded terminal update matches

    const result = await handleExecutionCallback(
      fake.db as never,
      event("FAILED", { error: "States.TaskFailed" }),
      NOW,
    );

    expect(result.handled).toBe(true);
    expect(result.runId).toBe("run-1");
    // Run projected to failed.
    expect(fake.updates.some((u) => u.status === "failed")).toBe(true);
    // Step event carries a ThinkWork-terms summary, no ASL vocabulary in the prose.
    const stepEvent = fake.inserts.find(
      (i) => i.event_type === "workflow_step_failed",
    );
    expect(stepEvent).toBeTruthy();
    const summary = stepEvent?.payload_summary as Record<string, unknown>;
    expect(String(summary.errorSummary)).toContain("Workflow execution failed");
  });

  it("SUCCEEDED → unconditional no-op, no db reads or writes (rollover race)", async () => {
    // The old execution's SUCCEEDED can arrive BEFORE the new execution's
    // load_next repoints backend_execution_id; projecting success here would
    // terminalize a live looping run. Success is always written by
    // record_advance/record_approval, so the event carries no information.
    const result = await handleExecutionCallback(
      fake.db as never,
      event("SUCCEEDED"),
      NOW,
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe("non_terminal_status");
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("ABORTED on a superseded ARN → no-op (null), no throw", async () => {
    fake.selectQueue.push([]); // no run for this ARN
    fake.updateQueue.push([]); // guarded update matches nothing → null

    const result = await handleExecutionCallback(
      fake.db as never,
      event("ABORTED"),
      NOW,
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe("superseded_or_already_terminal");
    // No step event on a no-op.
    expect(fake.inserts).toHaveLength(0);
  });

  it("RUNNING → no-op, no db writes", async () => {
    const result = await handleExecutionCallback(
      fake.db as never,
      event("RUNNING"),
      NOW,
    );
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("non_terminal_status");
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });
});
