/**
 * Tests for the workflow_schedule branch in packages/lambda/job-trigger.ts
 * (THINK-219 U7). Exercises handleWorkflowSchedule directly with a fake db so
 * the REAL @thinkwork/database-pg interpreter adapters
 * (ensureInterpreterBinding / createInterpreterWorkflowRun /
 * markInterpreterRunStarted / recordWorkflowStepEvent) drive the same db chain.
 *
 * Scenarios (per plan):
 *   * happy path: run created → SFN StartExecution → markInterpreterRunStarted;
 *     input_summary carries agentId/workflowName/spaceId; trigger-scoped key.
 *   * duplicate fire (AE4): existing non-queued run → ONE run, no StartExecution.
 *   * half-built repair: existing queued run w/o execution → re-StartExecution.
 *   * missing current version: fails loudly with a workflow_step_failed event,
 *     no StartExecution.
 *
 * Only the AWS SDK boundaries (SFN + SSM) are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSfnSend, mockSsmSend } = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
  mockSsmSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: vi.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: vi.fn((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: vi.fn((input) => ({ input })),
}));

import {
  _resetInterpreterStateMachineArnCache,
  handleWorkflowSchedule,
} from "../job-trigger";

type Rows = Record<string, unknown>[];

function makeDb(opts: { selects: Rows[]; inserts?: Rows[] }) {
  const selects = [...opts.selects];
  const inserts = [...(opts.inserts ?? [])];
  const insertValuesCalls: Record<string, unknown>[] = [];
  const updateSetCalls: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selects.shift() ?? [];
          const p = Promise.resolve(rows);
          return Object.assign(p, { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValuesCalls.push(value);
        const rows = inserts.shift() ?? [];
        const returning = () => Promise.resolve(rows);
        const p = Promise.resolve(rows);
        return Object.assign(p, {
          returning,
          onConflictDoNothing: () => ({ returning }),
          onConflictDoUpdate: () => Promise.resolve(rows),
        });
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateSetCalls.push(value);
        return {
          where: () => {
            const p = Promise.resolve([]);
            return Object.assign(p, { returning: () => Promise.resolve([]) });
          },
        };
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, insertValuesCalls, updateSetCalls };
}

const WORKFLOW = {
  id: "wf-1",
  tenant_id: "tenant-1",
  name: "Nightly Digest",
  current_version_id: "ver-1",
};

const baseArgs = {
  event: {
    triggerId: "trigger-1",
    triggerType: "workflow_schedule",
    tenantId: "tenant-1",
    workflowId: "wf-1",
    fireId: "fire-1",
  },
  job: { space_id: "space-1" },
  tenantId: "tenant-1",
  triggerId: "trigger-1",
  actorId: "user-1",
};

beforeEach(() => {
  mockSfnSend.mockReset();
  mockSsmSend.mockReset();
  _resetInterpreterStateMachineArnCache();
  process.env.STAGE = "dev";
  mockSsmSend.mockResolvedValue({ Parameter: { Value: "arn:sm:interp" } });
});

describe("handleWorkflowSchedule", () => {
  it("creates a run, starts the execution, and stamps agentId/workflowName/spaceId", async () => {
    mockSfnSend.mockResolvedValue({
      executionArn: "arn:aws:states:exec-1",
      startDate: new Date("2026-07-07T00:00:00Z"),
    });
    const { db, insertValuesCalls, updateSetCalls } = makeDb({
      selects: [[WORKFLOW], [{ id: "agent-1" }], []],
      inserts: [[{ id: "binding-1" }], [{ id: "run-1", status: "queued" }], []],
    });

    await handleWorkflowSchedule({ db, ...baseArgs });

    // Exactly one StartExecution, with the deterministic name + cursor input.
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const cmd = mockSfnSend.mock.calls[0][0].input;
    expect(cmd.stateMachineArn).toBe("arn:sm:interp");
    expect(cmd.name).toBe("run-run-1-r0");
    const parsed = JSON.parse(cmd.input);
    expect(parsed.cursor).toMatchObject({
      workflowRunId: "run-1",
      tenantId: "tenant-1",
      stepPointer: 0,
      iteration: 1,
      loopCycleCount: 0,
      rolloverCount: 0,
    });

    // Run creation stamped the interpreter contract fields + trigger-scoped key.
    const runInsert = insertValuesCalls.find(
      (v) => v.idempotency_key === "workflow_schedule:trigger-1:fire-1",
    );
    expect(runInsert).toBeDefined();
    expect(runInsert?.trigger_family).toBe("schedule");
    expect(runInsert?.input_summary).toEqual({
      agentId: "agent-1",
      workflowName: "Nightly Digest",
      spaceId: "space-1",
      // Pi requires a human invoker on each step turn; the dispatcher reads
      // this to stamp requested_by_actor on the step wakeups.
      requestedByUserId: "user-1",
    });
    expect(runInsert?.backend_execution_id).toBeUndefined();

    // markInterpreterRunStarted recorded the execution.
    expect(
      updateSetCalls.some(
        (v) => v.backend_execution_id === "arn:aws:states:exec-1",
      ),
    ).toBe(true);
  });

  it("falls back to the row's workflow_id when the frozen payload has none (THINK-216 migration)", async () => {
    mockSfnSend.mockResolvedValue({
      executionArn: "arn:aws:states:exec-2",
      startDate: new Date("2026-07-07T00:00:00Z"),
    });
    const { db, insertValuesCalls } = makeDb({
      selects: [[WORKFLOW], [{ id: "agent-1" }], []],
      inserts: [[{ id: "binding-1" }], [{ id: "run-2", status: "queued" }], []],
    });

    await handleWorkflowSchedule({
      db,
      ...baseArgs,
      event: {
        triggerId: "trigger-1",
        triggerType: "agent_loop_schedule",
        tenantId: "tenant-1",
        fireId: "fire-2",
      },
      job: { space_id: "space-1", workflow_id: "wf-1" },
    });

    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const runInsert = insertValuesCalls.find(
      (v) => v.idempotency_key === "workflow_schedule:trigger-1:fire-2",
    );
    expect(runInsert).toBeDefined();
    expect(runInsert?.workflow_id).toBe("wf-1");
  });

  it("resolves a duplicate fire to a single run without starting another execution (AE4)", async () => {
    const { db } = makeDb({
      selects: [
        [WORKFLOW],
        [{ id: "agent-1" }],
        [], // no existing binding
        [{ id: "run-1", status: "running" }], // adapter conflict lookup
        [{ status: "running", backend_execution_id: "arn:aws:states:prev" }],
      ],
      inserts: [
        [{ id: "binding-1" }],
        [], // run insert conflicts (duplicate fire)
      ],
    });

    await handleWorkflowSchedule({ db, ...baseArgs });

    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("repairs a half-built queued run by re-starting the execution", async () => {
    mockSfnSend.mockResolvedValue({
      executionArn: "arn:aws:states:exec-repair",
    });
    const { db, updateSetCalls } = makeDb({
      selects: [
        [WORKFLOW],
        [{ id: "agent-1" }],
        [],
        [{ id: "run-1", status: "queued" }], // adapter conflict lookup
        [{ status: "queued", backend_execution_id: null }], // half-built
      ],
      inserts: [
        [{ id: "binding-1" }],
        [], // run insert conflicts
        [], // evidence insert from markInterpreterRunStarted
      ],
    });

    await handleWorkflowSchedule({ db, ...baseArgs });

    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    expect(
      updateSetCalls.some(
        (v) => v.backend_execution_id === "arn:aws:states:exec-repair",
      ),
    ).toBe(true);
  });

  it("fails loudly with a workflow_step_failed event when the workflow has no published version", async () => {
    const { db, insertValuesCalls } = makeDb({
      selects: [
        [{ ...WORKFLOW, current_version_id: null }],
        [{ id: "agent-1" }],
        [],
      ],
      inserts: [
        [{ id: "binding-1" }],
        [{ id: "run-1", status: "queued" }], // run created
        [], // failure event insert
      ],
    });

    await handleWorkflowSchedule({ db, ...baseArgs });

    expect(mockSfnSend).not.toHaveBeenCalled();
    const failureEvent = insertValuesCalls.find(
      (v) => v.event_type === "workflow_step_failed",
    );
    expect(failureEvent).toBeDefined();
    expect(
      (failureEvent?.payload_summary as Record<string, unknown>)?.reason,
    ).toBe("workflow_has_no_published_version");
  });
});
