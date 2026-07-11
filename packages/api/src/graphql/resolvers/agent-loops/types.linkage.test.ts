import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
const where = vi.fn();

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where,
      }),
    }),
  },
  agentWakeupRequests: {},
  agentLoopIterations: {},
  agentLoopRuns: {},
  agentLoopVersions: {},
  agentLoops: {},
  threadTurns: {},
  webhookDeliveries: {},
  webhooks: {},
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
        value,
      ]),
    ),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflows: {
    source_agent_loop_id: "workflows.source_agent_loop_id",
    tenant_id: "workflows.tenant_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: vi.fn(),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  lt: (left: unknown, right: unknown) => ({ lt: [left, right] }),
}));

import { agentLoopTypeResolvers } from "./types.js";

beforeEach(() => {
  rows.mockReset();
  where.mockReset();
  where.mockReturnValue({ limit: () => Promise.resolve(rows()) });
});

describe("AgentLoop linked Workflow", () => {
  it("resolves the tenant-scoped converged Workflow", async () => {
    rows.mockReturnValueOnce([
      {
        id: "workflow-1",
        tenant_id: "tenant-a",
        source_agent_loop_id: "loop-1",
      },
    ]);

    const result = await agentLoopTypeResolvers.linkedWorkflow({
      id: "loop-1",
      tenantId: "tenant-a",
    });

    expect(result).toEqual({
      id: "workflow-1",
      tenantId: "tenant-a",
      sourceAgentLoopId: "loop-1",
    });
    expect(where).toHaveBeenCalledWith({
      and: [
        { eq: ["workflows.source_agent_loop_id", "loop-1"] },
        { eq: ["workflows.tenant_id", "tenant-a"] },
      ],
    });
  });

  it("returns null without an Automation id", async () => {
    expect(await agentLoopTypeResolvers.linkedWorkflow({})).toBeNull();
    expect(where).not.toHaveBeenCalled();
  });
});
