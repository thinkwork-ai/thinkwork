import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TWENTY_CRM_WORKFLOW_CAPABILITIES,
  ensureTwentyCrmWorkflowBinding,
  recordTwentyCrmWorkflowRun,
  twentyCrmWorkflowReadiness,
} from "./connected-app-bindings.js";

type Rows = Record<string, unknown>[];

const selectQueue: Rows[] = [];
const insertRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => queryResult(),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValues(value);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertRows()),
          }),
          returning: () => Promise.resolve(insertRows()),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

function queryResult() {
  return {
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
    then: (
      resolve: (value: Rows) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
  };
}

const readyTwenty = {
  key: "twenty" as const,
  status: "running" as const,
  provisioned: true,
  runtimeEnabled: true,
  url: "https://crm.example.test",
  managedMcpInstalled: true,
  managedMcpStatus: "installed",
  managedMcpMessage: null,
};

beforeEach(() => {
  selectQueue.length = 0;
  insertRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
});

describe("connected app workflow bindings", () => {
  it("exposes Twenty CRM trigger/action capabilities without Step Functions controls", () => {
    const readiness = twentyCrmWorkflowReadiness({
      managedApplication: readyTwenty,
    });

    expect(readiness.state).toBe("ready");
    expect(TWENTY_CRM_WORKFLOW_CAPABILITIES).toMatchObject({
      triggerFamilies: ["crm"],
      actions: ["create_customer_onboarding_thread", "mirror_checklist_tasks"],
      start: false,
      cancel: false,
      retry: false,
      replay: false,
      monitor: true,
      evidence: true,
    });
  });

  it("keeps parked Twenty workflows visible but blocked by readiness evidence", () => {
    const readiness = twentyCrmWorkflowReadiness({
      managedApplication: {
        ...readyTwenty,
        status: "parked",
        runtimeEnabled: false,
      },
    });

    expect(readiness.state).toBe("blocked_not_ready");
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: "managed_app_parked" }),
    );
  });

  it("blocks user-scoped CRM invocation without tenant credential fallback", () => {
    const readiness = twentyCrmWorkflowReadiness({
      managedApplication: readyTwenty,
      credentialState: "user_missing",
    });

    expect(readiness.state).toBe("blocked_not_ready");
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: "user_oauth_missing" }),
    );
  });

  it("preserves workflow activation while a destroyed app removes runnable readiness", async () => {
    selectQueue.push(
      [
        {
          id: "binding-1",
          workflow_id: "workflow-1",
          workflow_version_id: "version-1",
        },
      ],
      [],
    );

    const result = await ensureTwentyCrmWorkflowBinding(fakeDb(), {
      tenantId: "tenant-1",
      managedApplicationId: "app-twenty",
      managedApplication: {
        ...readyTwenty,
        status: "disabled",
        provisioned: false,
        runtimeEnabled: false,
        managedMcpInstalled: false,
        managedMcpStatus: "missing",
      },
    });

    expect(result).toMatchObject({
      workflowId: "workflow-1",
      bindingId: "binding-1",
      created: false,
      readiness: {
        state: "blocked_not_ready",
        reasons: [expect.objectContaining({ code: "managed_app_destroyed" })],
      },
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: "active",
        readiness_state: "blocked_not_ready",
      }),
    );
  });

  it("records a CRM event run with object evidence and ThinkWork thread evidence", async () => {
    selectQueue.push([], []);
    insertRows
      .mockReturnValueOnce([{ id: "workflow-1" }])
      .mockReturnValueOnce([{ id: "version-1" }])
      .mockReturnValueOnce([{ id: "binding-1" }])
      .mockReturnValueOnce([{ id: "run-1" }])
      .mockReturnValue([]);

    const result = await recordTwentyCrmWorkflowRun(fakeDb(), {
      tenantId: "tenant-1",
      managedApplicationId: "app-twenty",
      managedApplication: readyTwenty,
      opportunity: {
        event: "opportunity.closed_won",
        opportunityId: "opp-123",
        customerId: "cust-123",
        customerName: "Acme Corp",
        occurredAt: "2026-06-20T20:30:00.000Z",
        apiToken: "secret-token",
      },
      thread: {
        id: "thread-1",
        identifier: "HOOK-42",
        title: "Acme Corp onboarding",
      },
      linkedTaskCount: 7,
      missingFields: [],
    });

    expect(result).toEqual({
      runId: "run-1",
      created: true,
      readinessState: "ready",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        trigger_family: "crm",
        trigger_source: "twenty:opportunity",
        backend_execution_id: "opp-123",
        idempotency_key:
          "twenty-crm:opportunity.closed_won:opp-123:2026-06-20T20:30:00.000Z",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: "crm_event",
        source_system: "twenty",
        source_id: "opp-123",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: "thinkwork_thread",
        source_system: "thinkwork",
        source_id: "thread-1",
        uri: "thinkwork://threads/thread-1",
      }),
    );
  });
});
