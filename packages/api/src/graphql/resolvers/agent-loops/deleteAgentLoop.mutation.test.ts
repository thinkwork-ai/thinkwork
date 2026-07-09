import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphQLContext } from "../../context.js";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  loopScheduleSyncs: [] as unknown[],
  workflowScheduleSyncs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflows: {
    __table: "workflows",
    tenant_id: "tenant_id",
    source_agent_loop_id: "source_agent_loop_id",
    id: "id",
  },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => {
      const resolve = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => resolve(),
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          mocks.updates.push({ table, set });
          return Promise.resolve();
        },
      }),
    }),
  },
  agentLoops: { __table: "agent_loops" },
}));

vi.mock("../../../lib/agent-loops/schedule-binding.js", () => ({
  syncAgentLoopScheduleBinding: vi.fn(async (input: unknown) => {
    mocks.loopScheduleSyncs.push(input);
  }),
}));

vi.mock("../../../lib/workflows/schedule-binding.js", () => ({
  syncWorkflowScheduleBinding: vi.fn(async (input: Record<string, unknown>) => {
    mocks.workflowScheduleSyncs.push(input);
    return { scheduledJobId: "sj-1", changed: true };
  }),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => "user-1"),
}));

vi.mock("./write-access.js", () => ({
  requireAgentLoopWriteAccess: vi.fn(async () => undefined),
}));

const { deleteAgentLoop } = await import("./deleteAgentLoop.mutation.js");

const CTX = { auth: {} } as unknown as GraphQLContext;

const LOOP_ROW = {
  id: "loop-1",
  tenant_id: "tenant-1",
  name: "Daily report",
  description: null,
  owner_user_id: "user-1",
  run_as_user_id: "user-1",
};

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.updates.length = 0;
  mocks.loopScheduleSyncs.length = 0;
  mocks.workflowScheduleSyncs.length = 0;
});

describe("deleteAgentLoop", () => {
  it("disables the converged workflow schedule and archives the linked workflow (U12 AE7 regression)", async () => {
    mocks.selectQueue.push([LOOP_ROW]); // loop lookup
    mocks.selectQueue.push([{ id: "wf-1" }]); // linked workflow lookup

    const result = await deleteAgentLoop(null, { id: "loop-1" }, CTX);
    expect(result).toEqual({ id: "loop-1", ok: true });

    expect(mocks.workflowScheduleSyncs).toHaveLength(1);
    expect(mocks.workflowScheduleSyncs[0]).toMatchObject({
      tenantId: "tenant-1",
      workflowId: "wf-1",
      schedule: null,
    });

    const workflowUpdate = mocks.updates.find(
      (u) => (u.table as { __table?: string }).__table === "workflows",
    );
    expect(workflowUpdate?.set.lifecycle_status).toBe("archived");
    const loopUpdate = mocks.updates.find(
      (u) => (u.table as { __table?: string }).__table === "agent_loops",
    );
    expect(loopUpdate?.set.lifecycle_status).toBe("archived");
    expect(loopUpdate?.set.enabled).toBe(false);
  });

  it("archives a non-converged loop without touching workflow bindings", async () => {
    mocks.selectQueue.push([LOOP_ROW]);
    mocks.selectQueue.push([]); // no linked workflow

    const result = await deleteAgentLoop(null, { id: "loop-1" }, CTX);
    expect(result).toEqual({ id: "loop-1", ok: true });
    expect(mocks.workflowScheduleSyncs).toHaveLength(0);
    expect(
      mocks.updates.filter(
        (u) => (u.table as { __table?: string }).__table === "workflows",
      ),
    ).toHaveLength(0);
  });
});
