import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeWorkflowEvidence } from "./evidence-redaction.js";
import { createWorkflowRunLedger } from "./run-ledger.js";
import { normalizeWorkflowTriggerContract } from "./trigger-contract.js";

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
        return {
          returning,
          onConflictDoNothing: (options: unknown) => {
            conflictOptions(options);
            return { returning };
          },
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

beforeEach(() => {
  selectRows.mockReset();
  insertRows.mockReset();
  updateRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
  conflictOptions.mockReset();
});

describe("createWorkflowRunLedger", () => {
  it("creates a workflow run, initial event, evidence, and workflow last-run pointer", async () => {
    insertRows
      .mockReturnValueOnce([{ id: "workflow-run-1" }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const result = await createWorkflowRunLedger(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      workflowVersionId: "workflow-version-1",
      engineBindingId: "binding-1",
      trigger: normalizeWorkflowTriggerContract({
        family: "webhook",
        source: "task-event",
        actor: { type: "connected_app", externalId: "twenty" },
        idempotencyKey: "webhook:delivery-1",
        payload: { providerEventId: "delivery-1" },
      }),
      backendExecutionId: "delivery-1",
      backendExecutionRef: { provider: "twenty" },
      capabilitySnapshot: { monitor: true },
      readinessSnapshot: { state: "ready", reasons: [] },
      initialEvent: {
        eventType: "workflow_triggered",
        eventStatus: "running",
        provenance: "native_event",
        message: "Webhook accepted",
      },
      evidence: [
        {
          evidenceType: "webhook_delivery",
          sourceSystem: "task-event",
          sourceId: "delivery-1",
          summary: summarizeWorkflowEvidence({
            payload: { event: "task.completed", token: "secret" },
          }),
        },
      ],
    });

    expect(result).toEqual({ run: { id: "workflow-run-1" }, created: true });
    expect(conflictOptions).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        workflow_id: "workflow-1",
        trigger_family: "webhook",
        trigger_source: "task-event",
        actor_type: "connected_app",
        idempotency_key: "webhook:delivery-1",
        backend_execution_id: "delivery-1",
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({ last_run_id: "workflow-run-1" }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "workflow-run-1",
        event_type: "workflow_triggered",
        provenance: "native_event",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: "workflow-run-1",
        evidence_type: "webhook_delivery",
        source_system: "task-event",
        redaction_state: "redacted",
      }),
    );
  });

  it("loads the existing run when idempotency conflict prevents insert", async () => {
    insertRows.mockReturnValueOnce([]);
    selectRows.mockReturnValueOnce([{ id: "workflow-run-existing" }]);

    const result = await createWorkflowRunLedger(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
      trigger: normalizeWorkflowTriggerContract({
        family: "schedule",
        source: "aws.scheduler",
        actor: { type: "schedule", externalId: "daily" },
        idempotencyKey: "schedule:daily:fire-1",
      }),
    });

    expect(result).toEqual({
      run: { id: "workflow-run-existing" },
      created: false,
    });
    expect(updateValues).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});
