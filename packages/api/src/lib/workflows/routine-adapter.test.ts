import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoutineWorkflowRun,
  ensureRoutineWorkflow,
  recordRoutineWorkflowStepEvent,
  updateRoutineWorkflowRunFromExecution,
  workflowStatusFromRoutineStatus,
} from "./routine-adapter.js";

type Rows = Record<string, unknown>[];

const selectRows = vi.fn<() => Rows>();
const insertRows = vi.fn<() => Rows>();
const updateRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();

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
        return {
          returning: () => Promise.resolve(insertRows() ?? []),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        return {
          where: () => ({
            returning: () => Promise.resolve(updateRows() ?? []),
          }),
        };
      },
    }),
  };
}

const routine = {
  id: "routine-1",
  tenant_id: "tenant-1",
  name: "Daily digest",
  description: "Send a digest",
  engine: "step_functions",
  status: "active",
  visibility: "tenant_shared",
  agent_id: "agent-1",
  owning_agent_id: null,
  state_machine_arn:
    "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
  state_machine_alias_arn:
    "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:live",
  current_version: 3,
};

const aslVersion = {
  id: "asl-version-3",
  version_number: 3,
  state_machine_arn:
    "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
  version_arn: "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:3",
  asl_json: { StartAt: "Done", States: { Done: { Type: "Succeed" } } },
  markdown_summary: "One step",
  step_manifest_json: [{ nodeId: "Done", recipeType: "sequence" }],
  published_by_actor_type: "user",
  published_by_actor_id: "user-1",
  created_at: new Date("2026-06-20T16:00:00Z"),
};

beforeEach(() => {
  selectRows.mockReset();
  insertRows.mockReset();
  updateRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
});

describe("ensureRoutineWorkflow", () => {
  it("creates workflow identity, version, binding, and trigger for a routine", async () => {
    selectRows
      .mockReturnValueOnce([]) // existing binding
      .mockReturnValueOnce([]) // existing version
      .mockReturnValueOnce([]); // existing trigger
    insertRows
      .mockReturnValueOnce([{ id: "workflow-1" }])
      .mockReturnValueOnce([{ id: "workflow-version-3" }])
      .mockReturnValueOnce([{ id: "binding-1" }])
      .mockReturnValueOnce([]);

    const projection = await ensureRoutineWorkflow(fakeDb(), {
      routine,
      aslVersion,
      triggerFamily: "manual",
    });

    expect(projection).toEqual({
      workflowId: "workflow-1",
      workflowVersionId: "workflow-version-3",
      engineBindingId: "binding-1",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        name: "Daily digest",
        slug: "routine-routine-1",
        lifecycle_status: "active",
        visibility: "tenant_shared",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-1",
        version_number: 3,
        source_kind: "step_functions_routine",
        routine_asl_version_id: "asl-version-3",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-1",
        workflow_version_id: "workflow-version-3",
        binding_type: "step_functions_routine",
        routine_id: "routine-1",
      }),
    );
  });

  it("refreshes binding and trigger metadata for an existing routine workflow", async () => {
    const nextVersion = {
      ...aslVersion,
      id: "asl-version-4",
      version_number: 4,
      version_arn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:4",
    };
    selectRows
      .mockReturnValueOnce([
        {
          id: "binding-1",
          workflow_id: "workflow-1",
          workflow_version_id: "workflow-version-3",
        },
      ])
      .mockReturnValueOnce([{ id: "workflow-version-4" }])
      .mockReturnValueOnce([{ id: "trigger-1" }]);

    const projection = await ensureRoutineWorkflow(fakeDb(), {
      routine: { ...routine, current_version: 4 },
      aslVersion: nextVersion,
      triggerFamily: "schedule",
    });

    expect(projection).toEqual({
      workflowId: "workflow-1",
      workflowVersionId: "workflow-version-4",
      engineBindingId: "binding-1",
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_version_id: "workflow-version-4",
        routine_asl_version_id: "asl-version-4",
        external_version_id: "4",
        connection_ref: expect.objectContaining({
          aliasArn: routine.state_machine_alias_arn,
        }),
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_version_id: "workflow-version-4",
        enabled: true,
        trigger_config: { routineId: "routine-1" },
      }),
    );
  });
});

describe("createRoutineWorkflowRun", () => {
  it("records workflow run correlation and SFN evidence", async () => {
    insertRows
      .mockReturnValueOnce([{ id: "workflow-run-1" }])
      .mockReturnValueOnce([]);

    await createRoutineWorkflowRun(fakeDb(), {
      routine,
      aslVersion,
      projection: {
        workflowId: "workflow-1",
        workflowVersionId: "workflow-version-3",
        engineBindingId: "binding-1",
      },
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      stateMachineArn: routine.state_machine_arn,
      aliasArn: routine.state_machine_alias_arn,
      routineExecutionId: "routine-execution-1",
      triggerFamily: "manual",
      triggerSource: "manual",
      inputSummary: { customer: "ABC" },
      startedAt: new Date("2026-06-20T16:10:00Z"),
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-1",
        workflow_version_id: "workflow-version-3",
        engine_binding_id: "binding-1",
        backend_execution_id:
          "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
        idempotency_key:
          "routine-execution:arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "workflow-run-1",
        evidence_type: "step_functions_execution",
        source_system: "aws_step_functions",
        source_id:
          "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      }),
    );
  });
});

describe("workflowStatusFromRoutineStatus", () => {
  it("maps routine cancelled spelling to workflow canceled spelling", () => {
    expect(workflowStatusFromRoutineStatus("cancelled")).toBe("canceled");
    expect(workflowStatusFromRoutineStatus("awaiting_approval")).toBe(
      "running",
    );
    expect(workflowStatusFromRoutineStatus("succeeded")).toBe("succeeded");
  });
});

describe("callback projection", () => {
  it("updates workflow run state and appends an execution event", async () => {
    updateRows.mockReturnValueOnce([
      { id: "workflow-run-1", tenant_id: "tenant-1" },
    ]);

    await updateRoutineWorkflowRunFromExecution(fakeDb(), {
      sfn_execution_arn:
        "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      status: "cancelled",
      started_at: null,
      finished_at: new Date("2026-06-20T16:20:00Z"),
      total_llm_cost_usd_cents: 15,
      error_code: "States.TaskFailed",
      error_message: "failed",
      output_json: { ok: false },
    });

    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "canceled",
        total_cost_usd_cents: 15,
        error_code: "States.TaskFailed",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "workflow-run-1",
        event_type: "routine_execution",
        event_status: "canceled",
      }),
    );
  });

  it("records routine step callbacks as workflow run events", async () => {
    selectRows.mockReturnValueOnce([
      { id: "workflow-run-1", tenant_id: "tenant-1" },
    ]);

    await recordRoutineWorkflowStepEvent(
      fakeDb(),
      {
        tenant_id: "tenant-1",
        execution_arn:
          "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
        node_id: "FetchEmail",
        recipe_type: "python",
        status: "succeeded",
        started_at: new Date("2026-06-20T16:20:00Z"),
        finished_at: new Date("2026-06-20T16:21:00Z"),
        input_json: { prompt: "go" },
        output_json: { ok: true },
        error_json: null,
        llm_cost_usd_cents: 5,
        retry_count: 1,
        stdout_s3_uri: "s3://bucket/stdout",
        stderr_s3_uri: null,
        stdout_preview: "done",
        truncated: false,
      },
      42,
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "workflow-run-1",
        event_type: "routine_step",
        event_status: "succeeded",
        evidence_ref: { routineStepEventId: 42 },
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ last_event_at: expect.any(Date) }),
    );
  });
});
