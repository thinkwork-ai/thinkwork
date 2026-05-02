import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  startSystemWorkflow,
  systemWorkflowExecutionName,
  systemWorkflowStateMachineArn,
} from "./start.js";

function createDb() {
  const rows: Array<Record<string, any>> = [];
  let conflict = false;
  return {
    rows,
    conflictNextInsert() {
      conflict = true;
    },
    insert: () => ({
      values: (values: Record<string, any>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (conflict) {
              conflict = false;
              return [];
            }
            const row = { id: "sw-run-1", ...values };
            rows.push(row);
            return [row];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, any>) => ({
        where: () => ({
          returning: async () => {
            Object.assign(rows[0], values);
            return [rows[0]];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

describe("startSystemWorkflow", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses configured state machine ARN maps", () => {
    vi.stubEnv(
      "SYSTEM_WORKFLOW_STATE_MACHINE_ARNS",
      JSON.stringify({ "evaluation-runs": "arn:evaluation" }),
    );

    expect(systemWorkflowStateMachineArn("evaluation-runs")).toBe(
      "arn:evaluation",
    );
  });

  it("builds Step Functions-safe execution names", () => {
    expect(
      systemWorkflowExecutionName({
        workflowId: "evaluation-runs",
        domainRef: { type: "eval_run", id: "abc/123" },
        runId: "run-id",
      }),
    ).toBe("evaluation-runs-eval_run-abc-123");
  });

  it("inserts a run before starting Step Functions and stores the execution ARN", async () => {
    const db = createDb();
    const sfnClient = {
      send: vi.fn(async () => ({
        executionArn: "arn:aws:states:execution:evaluation:sw-run-1",
        startDate: new Date("2026-05-02T12:00:00Z"),
      })),
    };

    const result = await startSystemWorkflow(
      {
        workflowId: "evaluation-runs",
        tenantId: "tenant-1",
        triggerSource: "graphql",
        domainRef: { type: "eval_run", id: "eval-1" },
        input: { evalRunId: "eval-1" },
      },
      {
        dbClient: db as any,
        sfnClient: sfnClient as any,
        stateMachineArnForWorkflow: () =>
          "arn:aws:states:stateMachine:evaluation",
      },
    );

    expect(result.started).toBe(true);
    expect(result.run.sfn_execution_arn).toBe(
      "arn:aws:states:execution:evaluation:sw-run-1",
    );
    expect(sfnClient.send).toHaveBeenCalledOnce();
    expect(db.rows[0].domain_ref_id).toBe("eval-1");
  });

  it("returns the existing domain-ref run when insert dedupes", async () => {
    const db = createDb();
    db.rows.push({
      id: "existing-run",
      tenant_id: "tenant-1",
      workflow_id: "evaluation-runs",
      domain_ref_type: "eval_run",
      domain_ref_id: "eval-1",
      status: "running",
    });
    db.conflictNextInsert();
    const sfnClient = { send: vi.fn() };

    const result = await startSystemWorkflow(
      {
        workflowId: "evaluation-runs",
        tenantId: "tenant-1",
        triggerSource: "graphql",
        domainRef: { type: "eval_run", id: "eval-1" },
      },
      {
        dbClient: db as any,
        sfnClient: sfnClient as any,
        stateMachineArnForWorkflow: () =>
          "arn:aws:states:stateMachine:evaluation",
      },
    );

    expect(result.deduped).toBe(true);
    expect(result.run.id).toBe("existing-run");
    expect(sfnClient.send).not.toHaveBeenCalled();
  });

  it("marks the pre-inserted run failed when StartExecution fails", async () => {
    const db = createDb();

    await expect(
      startSystemWorkflow(
        {
          workflowId: "evaluation-runs",
          tenantId: "tenant-1",
          triggerSource: "graphql",
          domainRef: { type: "eval_run", id: "eval-1" },
        },
        {
          dbClient: db as any,
          sfnClient: {
            send: vi.fn(async () => {
              throw new Error("boom");
            }),
          } as any,
          stateMachineArnForWorkflow: () =>
            "arn:aws:states:stateMachine:evaluation",
        },
      ),
    ).rejects.toThrow("Failed to start System Workflow evaluation-runs");

    expect(db.rows[0].status).toBe("failed");
    expect(db.rows[0].error_message).toBe("boom");
  });
});
