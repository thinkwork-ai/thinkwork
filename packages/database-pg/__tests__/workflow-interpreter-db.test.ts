import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeTaskToken,
  createInterpreterWorkflowRun,
  ensureInterpreterBinding,
  markInterpreterRunStarted,
  recordInterpreterRollover,
  recordWorkflowStepEvent,
  storeTaskToken,
  updateInterpreterRunFromExecution,
} from "../src/workflow-interpreter-db";

type Rows = Record<string, unknown>[];

const selectRows = vi.fn<() => Rows>();
const insertRows = vi.fn<() => Rows>();
const updateRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();
const conflictOptions = vi.fn();

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectRows() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValues(value);
        const returning = () => Promise.resolve(insertRows() ?? []);
        const result = Promise.resolve(insertRows() ?? []);
        return Object.assign(result, {
          returning,
          onConflictDoNothing: (options: unknown) => {
            conflictOptions(options);
            return { returning };
          },
          onConflictDoUpdate: (options: unknown) => {
            conflictOptions(options);
            return Promise.resolve(insertRows() ?? []);
          },
        });
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        const wherePromise = () => {
          const rows = updateRows() ?? [];
          const result = Promise.resolve(rows);
          return Object.assign(result, {
            returning: () => Promise.resolve(rows),
          });
        };
        return { where: wherePromise };
      },
    }),
  };
}

beforeEach(() => {
  selectRows.mockReset();
  insertRows.mockReset();
  updateRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
  conflictOptions.mockReset();
  updateRows.mockReturnValue([]);
  insertRows.mockReturnValue([]);
  selectRows.mockReturnValue([]);
});

describe("createInterpreterWorkflowRun", () => {
  const input = {
    tenantId: "tenant-1",
    workflowId: "workflow-1",
    workflowVersionId: "version-1",
    engineBindingId: "binding-1",
    triggerFamily: "schedule" as const,
    triggerSource: "schedule",
    idempotencyKey: "workflow_schedule:trigger-1:fire-1",
  };

  it("creates a queued run with a trigger-scoped idempotency key", async () => {
    insertRows.mockReturnValue([{ id: "run-1", status: "queued" }]);
    const result = await createInterpreterWorkflowRun(fakeDb(), input);
    expect(result.created).toBe(true);
    expect(result.run.id).toBe("run-1");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        idempotency_key: "workflow_schedule:trigger-1:fire-1",
      }),
    );
    // No execution ARN exists at creation time — must not be set.
    expect(insertValues.mock.calls[0][0].backend_execution_id).toBeUndefined();
  });

  it("returns the existing run on a duplicate fire (AE4)", async () => {
    insertRows.mockReturnValue([]);
    selectRows.mockReturnValue([{ id: "run-1", status: "running" }]);
    const result = await createInterpreterWorkflowRun(fakeDb(), input);
    expect(result.created).toBe(false);
    expect(result.run.id).toBe("run-1");
    expect(conflictOptions).toHaveBeenCalled();
  });
});

describe("markInterpreterRunStarted", () => {
  it("records the execution on the run and writes diagnostics evidence", async () => {
    await markInterpreterRunStarted(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      runId: "run-1",
      executionArn: "arn:aws:states:exec-1",
      now: new Date("2026-07-07T00:00:00Z"),
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        backend_execution_id: "arn:aws:states:exec-1",
        correlation_id: "arn:aws:states:exec-1",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: "step_functions_execution",
        source_id: "arn:aws:states:exec-1",
        workflow_run_id: "run-1",
      }),
    );
  });
});

describe("ensureInterpreterBinding", () => {
  it("reuses an existing interpreter binding", async () => {
    selectRows.mockReturnValue([{ id: "binding-1" }]);
    const result = await ensureInterpreterBinding(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      stateMachineArn: "arn:aws:states:us-east-1:1:stateMachine:interp",
    });
    expect(result).toEqual({ id: "binding-1", created: false });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("creates the binding with the interpreter type and machine ARN", async () => {
    selectRows.mockReturnValue([]);
    insertRows.mockReturnValue([{ id: "binding-2" }]);
    const result = await ensureInterpreterBinding(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      stateMachineArn: "arn:machine",
    });
    expect(result.created).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        binding_type: "step_functions_interpreter",
        connection_ref: { stateMachineArn: "arn:machine" },
      }),
    );
  });
});

describe("recordWorkflowStepEvent", () => {
  it("drops non-scalar payload fields (redaction-safe by construction)", async () => {
    await recordWorkflowStepEvent(fakeDb(), {
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      eventType: "workflow_step_finished",
      summary: {
        stepId: "work",
        iteration: 2,
        status: "succeeded",
        // @ts-expect-error — hostile caller shoving a nested object through
        rawPayload: { secret: "hunter2", nested: { token: "tok" } },
      },
    });
    const event = insertValues.mock.calls[0][0];
    expect(event.payload_summary).toEqual({
      stepId: "work",
      iteration: 2,
      status: "succeeded",
    });
    expect(JSON.stringify(event)).not.toContain("hunter2");
  });

  it("bumps last_event_at and can set the run status", async () => {
    await recordWorkflowStepEvent(fakeDb(), {
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      eventType: "workflow_policy_decision",
      summary: { decision: "human_needed" },
      runStatus: "waiting_for_human",
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "waiting_for_human" }),
    );
  });
});

describe("task tokens", () => {
  it("stores tokens as pending with upsert semantics", async () => {
    await storeTaskToken(fakeDb(), {
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      stepId: "work",
      iteration: 1,
      purpose: "agent_step",
      token: "tok-1",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", token: "tok-1" }),
    );
    expect(conflictOptions).toHaveBeenCalled();
  });

  it("consume returns the token exactly once (CAS)", async () => {
    updateRows.mockReturnValueOnce([{ token: "tok-1" }]);
    const key = {
      workflowRunId: "run-1",
      stepId: "work",
      iteration: 1,
      purpose: "agent_step" as const,
    };
    const first = await consumeTaskToken(fakeDb(), key);
    expect(first).toEqual({ token: "tok-1" });

    updateRows.mockReturnValueOnce([]);
    const second = await consumeTaskToken(fakeDb(), key);
    expect(second).toBeNull();
  });
});

describe("updateInterpreterRunFromExecution", () => {
  it("projects a terminal status with a ThinkWork-terms error summary", async () => {
    updateRows.mockReturnValueOnce([{ id: "run-1" }]);
    const result = await updateInterpreterRunFromExecution(fakeDb(), {
      executionArn: "arn:exec-current",
      status: "failed",
      errorSummary: "Step work failed: agent turn errored",
    });
    expect(result).toEqual({ runId: "run-1" });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "Step work failed: agent turn errored",
      }),
    );
  });

  it("returns null for a superseded (rolled-over) execution ARN", async () => {
    updateRows.mockReturnValueOnce([]);
    const result = await updateInterpreterRunFromExecution(fakeDb(), {
      executionArn: "arn:exec-old-rolled-over",
      status: "succeeded",
    });
    expect(result).toBeNull();
  });
});

describe("recordInterpreterRollover", () => {
  it("repoints the run via CAS on the old ARN and records the event", async () => {
    updateRows.mockReturnValue([{ id: "run-1" }]);
    const ok = await recordInterpreterRollover(fakeDb(), {
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      oldExecutionArn: "arn:old",
      newExecutionArn: "arn:new",
      iteration: 3,
    });
    expect(ok).toBe(true);
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ backend_execution_id: "arn:new" }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "workflow_run_rollover" }),
    );
  });

  it("returns false when the old ARN no longer matches (late duplicate)", async () => {
    updateRows.mockReturnValue([]);
    const ok = await recordInterpreterRollover(fakeDb(), {
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      oldExecutionArn: "arn:stale",
      newExecutionArn: "arn:new",
      iteration: 3,
    });
    expect(ok).toBe(false);
  });
});
