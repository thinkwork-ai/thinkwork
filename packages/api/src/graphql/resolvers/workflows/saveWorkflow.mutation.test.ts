/**
 * saveWorkflow (THINK-218): validation-error surfacing (R4 over GraphQL),
 * create + version publish, and version supersede on definition change.
 * Sequential fake-db so the REAL validator drives the outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireTenantAdmin = vi.fn();
const mockResolveCallerTenantId = vi.fn();
const mockSyncSchedule = vi.fn();

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));
vi.mock("../../../lib/workflows/schedule-binding.js", () => ({
  syncWorkflowScheduleBinding: mockSyncSchedule,
}));
vi.mock("../../utils.js", () => ({
  db: {},
  snakeToCamel: (row: unknown) => row,
}));

type Rows = Record<string, unknown>[];

function makeDb() {
  const selects: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const insertReturns: Rows[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selects.shift() ?? [];
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return {
          returning: () => Promise.resolve(insertReturns.shift() ?? []),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db, selects, inserts, insertReturns, updates };
}

let resolver: typeof import("./saveWorkflow.mutation.js");

beforeEach(async () => {
  mockRequireTenantAdmin.mockReset().mockResolvedValue("admin");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockSyncSchedule.mockReset().mockResolvedValue({ scheduledJobId: "job-1" });
  vi.resetModules();
  resolver = await import("./saveWorkflow.mutation.js");
});

const ctx = { auth: { tenantId: "tenant-1", principalId: "user-1" } } as never;

const VALID_DEFINITION = {
  version: 1,
  steps: [{ id: "work", kind: "agent", objective: "Do the weekly digest" }],
};

describe("saveWorkflow", () => {
  it("returns ThinkWork-terms validation errors without touching the db", async () => {
    const { db, inserts } = makeDb();
    const result = (await resolver.saveWorkflow(
      null,
      {
        input: {
          name: "Bad",
          definition: {
            version: 1,
            steps: [{ id: "x", kind: "teleport" }],
          },
        },
      },
      ctx,
      { db: db as never },
    )) as { workflow: unknown; errors: Array<Record<string, unknown>> };
    expect(result.workflow).toBeNull();
    expect(result.errors[0]).toMatchObject({
      stepId: "x",
      field: "steps[0].kind",
    });
    expect(inserts).toHaveLength(0);
  });

  it("creates a workflow, publishes version 1, and syncs a schedule trigger", async () => {
    const { db, selects, inserts, insertReturns } = makeDb();
    insertReturns.push([{ id: "wf-1" }], [{ id: "ver-1" }]);
    selects.push(
      [], // no current active version
      [{ name: "Digest" }], // name lookup for trigger sync
      [], // webhook binding lookup (family schedule → disable path)
      [{ id: "wf-1", tenant_id: "tenant-1", name: "Digest" }], // final read
    );

    const result = (await resolver.saveWorkflow(
      null,
      {
        input: {
          name: "Digest",
          definition: VALID_DEFINITION,
          trigger: {
            family: "schedule",
            schedule: { scheduleExpression: "rate(1 day)" },
          },
        },
      },
      ctx,
      { db: db as never },
    )) as { workflow: Record<string, unknown>; errors: unknown[] };

    expect(result.errors).toHaveLength(0);
    expect(result.workflow).toMatchObject({ id: "wf-1" });
    const workflowInsert = inserts.find((v) => v.slug);
    expect(workflowInsert).toMatchObject({
      tenant_id: "tenant-1",
      primary_trigger_family: "schedule",
    });
    const versionInsert = inserts.find((v) => v.definition_snapshot);
    expect(versionInsert).toMatchObject({
      workflow_id: "wf-1",
      version_number: 1,
      version_status: "active",
    });
    expect(mockSyncSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-1",
        schedule: expect.objectContaining({
          scheduleExpression: "rate(1 day)",
        }),
      }),
    );
  });

  it("supersedes the active version when the definition changes", async () => {
    const { db, selects, inserts, insertReturns, updates } = makeDb();
    selects.push(
      [
        {
          id: "wf-1",
          tenant_id: "tenant-1",
          name: "Digest",
          current_version_number: 3,
        },
      ], // existing workflow
      [
        {
          id: "ver-3",
          version_number: 3,
          definition_snapshot: { version: 1, steps: [] },
        },
      ], // current active version (different definition)
      [{ id: "wf-1", tenant_id: "tenant-1", name: "Digest" }], // final read
    );
    insertReturns.push([{ id: "ver-4" }]);

    const result = (await resolver.saveWorkflow(
      null,
      { input: { id: "wf-1", definition: VALID_DEFINITION } },
      ctx,
      { db: db as never },
    )) as { errors: unknown[] };

    expect(result.errors).toHaveLength(0);
    expect(updates.some((u) => u.version_status === "superseded")).toBe(true);
    const versionInsert = inserts.find((v) => v.definition_snapshot);
    expect(versionInsert).toMatchObject({ version_number: 4 });
  });

  it("returns webhookToken when the trigger family is webhook", async () => {
    const { db, selects, inserts, insertReturns } = makeDb();
    insertReturns.push([{ id: "wf-2" }], [{ id: "ver-1" }]);
    selects.push(
      [], // no current version
      [{ name: "Inbound" }], // trigger sync name lookup
      [], // no existing webhook row
      [{ id: "wf-2", tenant_id: "tenant-1" }], // final read
    );
    const result = (await resolver.saveWorkflow(
      null,
      {
        input: {
          name: "Inbound",
          definition: VALID_DEFINITION,
          trigger: { family: "webhook" },
        },
      },
      ctx,
      { db: db as never },
    )) as { webhookToken: string | null };
    expect(typeof result.webhookToken).toBe("string");
    const webhookInsert = inserts.find((v) => v.target_type === "workflow");
    expect(webhookInsert).toMatchObject({ workflow_id: "wf-2", enabled: true });
  });
});
