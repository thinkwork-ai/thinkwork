/**
 * Provisioning tests (THINK-193 U3): idempotent ensure of the personal
 * automation and the operator shared workflow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbPgMocks = vi.hoisted(() => ({
  ensureMemoryBlueprintVersion: vi.fn(async () => ({
    managed: true,
    published: false,
    versionId: "ver-1",
  })),
}));
vi.mock("@thinkwork/database-pg", () => ({
  ensureMemoryBlueprintVersion: dbPgMocks.ensureMemoryBlueprintVersion,
}));

import {
  ensurePersonalMemoryAutomation,
  ensureSharedMemoryWorkflow,
} from "./provisioning.js";

type Rows = Record<string, unknown>[];

function makeDb() {
  const selects: Rows[] = [];
  const insertReturns: Rows[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updateReturns: Rows[] = [];
  const updates: Record<string, unknown>[] = [];
  const nextSelect = () => Promise.resolve(selects.shift() ?? []);
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => nextSelect(),
          orderBy: () => nextSelect(),
        }),
        orderBy: () => nextSelect(),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        const returning = () => Promise.resolve(insertReturns.shift() ?? []);
        return {
          returning,
          onConflictDoNothing: () => ({ returning }),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return {
          where: () => {
            const rows = updateReturns.shift() ?? [];
            return Object.assign(Promise.resolve(rows), {
              returning: () => Promise.resolve(rows),
            });
          },
        };
      },
    }),
  };
  return { db: db as never, selects, insertReturns, inserts, updateReturns };
}

const TENANT = "t1";
const USER = "user-1";

function processorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "proc-1",
    tenant_id: TENANT,
    mode: "personal",
    target_scope: "user",
    target_id: USER,
    workflow_id: null,
    enabled: true,
    status: "active",
    budget: {},
    created_by_user_id: USER,
    created_at: new Date(),
    ...overrides,
  };
}

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wf-1",
    tenant_id: TENANT,
    name: "Personal Memory Processing",
    slug: "personal-memory-user1",
    visibility: "agent_private",
    owner_user_id: USER,
    primary_trigger_family: "manual",
    readiness_state: "ready",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbPgMocks.ensureMemoryBlueprintVersion.mockResolvedValue({
    managed: true,
    published: false,
    versionId: "ver-1",
  });
});

describe("ensurePersonalMemoryAutomation", () => {
  it("creates processor + agent_private user-owned workflow + blueprint on first read", async () => {
    const { db, selects, insertReturns, inserts, updateReturns } = makeDb();
    selects.push([]); // no processor yet
    insertReturns.push([processorRow()]); // processor insert
    // ensureWorkflowLink: workflow insert wins
    insertReturns.push([workflowRow()]);
    updateReturns.push([{ workflow_id: "wf-1" }]); // NULL-CAS claim wins
    selects.push([processorRow({ workflow_id: "wf-1" })]); // fresh processor
    selects.push([]); // sources list

    const result = await ensurePersonalMemoryAutomation(db, {
      tenantId: TENANT,
      userId: USER,
    });

    expect(result.created).toBe(true);
    expect(result.workflow).toMatchObject({
      visibility: "agent_private",
      owner_user_id: USER,
      primary_trigger_family: "manual",
    });
    expect(inserts[0]).toMatchObject({
      mode: "personal",
      target_scope: "user",
      target_id: USER,
    });
    expect(inserts[1]).toMatchObject({
      visibility: "agent_private",
      owner_user_id: USER,
      primary_trigger_family: "manual",
    });
    expect(dbPgMocks.ensureMemoryBlueprintVersion).toHaveBeenCalledWith(db, {
      tenantId: TENANT,
      workflowId: "wf-1",
    });
  });

  it("is idempotent: an existing linked processor re-ensures the blueprint and creates nothing", async () => {
    const { db, selects, inserts } = makeDb();
    selects.push([processorRow({ workflow_id: "wf-1" })]); // processor exists
    selects.push([workflowRow()]); // linked workflow
    selects.push([processorRow({ workflow_id: "wf-1" })]); // fresh processor
    selects.push([]); // sources

    const result = await ensurePersonalMemoryAutomation(db, {
      tenantId: TENANT,
      userId: USER,
    });

    expect(result.created).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(dbPgMocks.ensureMemoryBlueprintVersion).toHaveBeenCalledTimes(1);
  });
});

describe("ensureSharedMemoryWorkflow", () => {
  it("provisions a tenant_shared workflow for a tenant-scope target", async () => {
    const { db, selects, insertReturns, inserts, updateReturns } = makeDb();
    selects.push([]); // no processor
    insertReturns.push([
      processorRow({
        id: "proc-s",
        mode: "shared",
        target_scope: "tenant",
        target_id: TENANT,
      }),
    ]);
    // assertTargetInTenant tenant branch: target_id === tenant_id, no select.
    insertReturns.push([
      workflowRow({
        id: "wf-s",
        visibility: "tenant_shared",
        name: "Company Memory Workflow",
      }),
    ]);
    updateReturns.push([{ workflow_id: "wf-s" }]);
    selects.push([
      processorRow({
        id: "proc-s",
        mode: "shared",
        target_scope: "tenant",
        target_id: TENANT,
        workflow_id: "wf-s",
      }),
    ]);
    selects.push([]); // sources

    const result = await ensureSharedMemoryWorkflow(db, {
      tenantId: TENANT,
      targetScope: "tenant",
      targetId: TENANT,
      actorUserId: "admin-1",
    });

    expect(result.workflow).toMatchObject({ visibility: "tenant_shared" });
    expect(inserts[1]).toMatchObject({
      visibility: "tenant_shared",
      primary_trigger_family: "manual",
    });
  });

  it("rejects and disables a processor whose tenant-scope target mismatches", async () => {
    const { db, selects, insertReturns } = makeDb();
    selects.push([]); // no processor
    insertReturns.push([
      processorRow({
        id: "proc-x",
        mode: "shared",
        target_scope: "tenant",
        target_id: "other-tenant",
      }),
    ]);

    await expect(
      ensureSharedMemoryWorkflow(db, {
        tenantId: TENANT,
        targetScope: "tenant",
        targetId: "other-tenant",
        actorUserId: null,
      }),
    ).rejects.toThrow(/belongs to tenant/);
  });
});
