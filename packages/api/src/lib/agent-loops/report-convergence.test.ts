import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  updates: [] as { table: unknown; values: Record<string, unknown> }[],
  insertReturning: [] as Record<string, unknown>[][],
  syncWorkflowScheduleBinding: vi.fn(),
}));

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => {
      const resolve = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => resolve(),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserts.push({ table, values });
        return {
          returning: () =>
            Promise.resolve(mocks.insertReturning.shift() ?? [{ id: "gen" }]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mocks.updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflows: { table: "workflows" },
  workflowVersions: { table: "workflow_versions" },
}));

vi.mock("../workflows/schedule-binding.js", () => ({
  syncWorkflowScheduleBinding: mocks.syncWorkflowScheduleBinding,
}));

// eslint-disable-next-line import/first
import {
  isReportAutomation,
  syncReportAutomationConvergence,
} from "./report-convergence.js";
// eslint-disable-next-line import/first
import { normalizeTargetSpec } from "@thinkwork/agent-loops-core";

const boundTargetSpec = normalizeTargetSpec({
  kind: "agent_thread",
  agentThread: {
    instructions: "Refresh the pipeline report",
    threadMode: "new_per_run",
  },
  documentBinding: {
    mode: "create",
    genre: "report",
    title: "Weekly Pipeline Report",
    spaceId: "space-1",
  },
});

const unboundTargetSpec = normalizeTargetSpec({
  kind: "agent_thread",
  agentThread: { instructions: "Do the thing", threadMode: "new_per_run" },
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    loop: { id: "loop-12345678-rest", name: "Weekly Pipeline Report" },
    version: {
      id: "version-1",
      routineActionsSpec: null,
      targetSpec: boundTargetSpec,
    },
    triggerSpec: {
      family: "schedule",
      enabled: true,
      config: {
        scheduleExpression: "cron(0 9 * * ? *)",
        timezone: "America/Chicago",
      },
    },
    loopEnabled: true,
    actorId: "user-1",
    ...overrides,
  } as Parameters<typeof syncReportAutomationConvergence>[0];
}

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.inserts.length = 0;
  mocks.updates.length = 0;
  mocks.insertReturning.length = 0;
  mocks.syncWorkflowScheduleBinding.mockReset();
  mocks.syncWorkflowScheduleBinding.mockResolvedValue({
    scheduledJobId: "sched-1",
    changed: true,
  });
});

describe("isReportAutomation", () => {
  it("is true only for an agent-turn target carrying a document binding", () => {
    expect(isReportAutomation(boundTargetSpec)).toBe(true);
    expect(isReportAutomation(unboundTargetSpec)).toBe(false);
    expect(isReportAutomation(null)).toBe(false);
  });
});

describe("syncReportAutomationConvergence", () => {
  it("returns null for a non-report automation and touches nothing", async () => {
    const result = await syncReportAutomationConvergence(
      baseInput({
        version: {
          id: "version-1",
          routineActionsSpec: null,
          targetSpec: unboundTargetSpec,
        },
      }),
    );
    expect(result).toBeNull();
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.syncWorkflowScheduleBinding).not.toHaveBeenCalled();
  });

  it("creates the linked workflow, publishes v1, and syncs the workflow schedule", async () => {
    mocks.selectQueue.push([]); // no existing workflow
    mocks.selectQueue.push([]); // no current version
    mocks.insertReturning.push([{ id: "wf-1" }]); // workflow insert
    mocks.insertReturning.push([{ id: "wfv-1" }]); // version insert

    const result = await syncReportAutomationConvergence(baseInput());

    expect(result).toEqual({
      workflowId: "wf-1",
      workflowVersionId: "wfv-1",
      published: true,
    });

    const workflowInsert = mocks.inserts[0].values;
    expect(workflowInsert).toMatchObject({
      tenant_id: "tenant-1",
      name: "Weekly Pipeline Report",
      slug: "automation-loop-123",
      lifecycle_status: "active",
      readiness_state: "ready",
      primary_trigger_family: "schedule",
      source_agent_loop_id: "loop-12345678-rest",
    });

    const versionInsert = mocks.inserts[1].values;
    expect(versionInsert).toMatchObject({
      workflow_id: "wf-1",
      version_number: 1,
      version_status: "active",
      source_kind: "workflow_interpreter",
    });
    const definition = versionInsert.definition_snapshot as {
      steps: { kind: string }[];
      documentBinding?: unknown;
    };
    expect(definition.steps.map((s) => s.kind)).toEqual(["agent"]);
    expect(definition.documentBinding).toMatchObject({ mode: "create" });

    expect(mocks.syncWorkflowScheduleBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workflowId: "wf-1",
        schedule: {
          scheduleExpression: "cron(0 9 * * ? *)",
          timezone: "America/Chicago",
          enabled: true,
        },
      }),
    );
  });

  it("does not publish a duplicate version when the definition is unchanged", async () => {
    // First run to learn the definition snapshot this input produces.
    mocks.selectQueue.push([], []);
    mocks.insertReturning.push([{ id: "wf-1" }], [{ id: "wfv-1" }]);
    await syncReportAutomationConvergence(baseInput());
    const snapshot = mocks.inserts[1].values.definition_snapshot;

    mocks.inserts.length = 0;
    mocks.updates.length = 0;
    mocks.selectQueue.push([{ id: "wf-1", name: "Weekly Pipeline Report" }]);
    mocks.selectQueue.push([
      { id: "wfv-1", version_number: 1, definition_snapshot: snapshot },
    ]);

    const result = await syncReportAutomationConvergence(baseInput());
    expect(result).toEqual({
      workflowId: "wf-1",
      workflowVersionId: "wfv-1",
      published: false,
    });
    expect(mocks.inserts).toHaveLength(0);
    // Schedule still syncs (idempotent downstream).
    expect(mocks.syncWorkflowScheduleBinding).toHaveBeenCalledTimes(2);
  });

  it("publishes the next version and supersedes the old one when the definition changed", async () => {
    mocks.selectQueue.push([{ id: "wf-1", name: "Weekly Pipeline Report" }]);
    mocks.selectQueue.push([
      { id: "wfv-1", version_number: 3, definition_snapshot: { stale: true } },
    ]);
    mocks.insertReturning.push([{ id: "wfv-2" }]);

    const result = await syncReportAutomationConvergence(baseInput());
    expect(result).toEqual({
      workflowId: "wf-1",
      workflowVersionId: "wfv-2",
      published: true,
    });
    expect(mocks.inserts[0].values).toMatchObject({ version_number: 4 });
    // supersede + pointer update
    expect(mocks.updates.map((u) => u.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version_status: "superseded" }),
        expect.objectContaining({
          current_version_id: "wfv-2",
          current_version_number: 4,
        }),
      ]),
    );
  });

  it("passes a null schedule for non-schedule trigger families", async () => {
    mocks.selectQueue.push([], []);
    mocks.insertReturning.push([{ id: "wf-1" }], [{ id: "wfv-1" }]);
    await syncReportAutomationConvergence(
      baseInput({
        triggerSpec: { family: "manual", enabled: true, config: {} },
      }),
    );
    expect(mocks.inserts[0].values.primary_trigger_family).toBe("manual");
    expect(mocks.syncWorkflowScheduleBinding).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: null }),
    );
  });
});
