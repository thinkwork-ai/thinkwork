import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  rows: vi.fn(),
  ensurePersonalMemoryAutomation: vi.fn(),
  resolveCallerUserId: vi.fn(),
  resolveAgentLoopReadScope: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  lt: (left: unknown, right: unknown) => ({ lt: [left, right] }),
}));

vi.mock("../../utils.js", () => ({
  agentLoops: {
    tenant_id: "agent_loops.tenant_id",
    owner_user_id: "agent_loops.owner_user_id",
    lifecycle_status: "agent_loops.lifecycle_status",
    enabled: "agent_loops.enabled",
    updated_at: "agent_loops.updated_at",
  },
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          mocks.where(condition);
          return {
            orderBy: () => ({ limit: () => Promise.resolve(mocks.rows()) }),
          };
        },
      }),
    }),
  },
}));

vi.mock("../../../lib/memory-sources/provisioning.js", () => ({
  ensurePersonalMemoryAutomation: mocks.ensurePersonalMemoryAutomation,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("./types.js", () => ({
  agentLoopRowToGraphql: (row: unknown) => row,
  clampAgentLoopQueryLimit: (limit?: number | null) => limit ?? 25,
  normalizeAgentLoopEnum: (value?: string | null) => value ?? null,
  resolveAgentLoopTenantId: vi.fn().mockResolvedValue("tenant-1"),
  resolveAgentLoopReadScope: mocks.resolveAgentLoopReadScope,
}));

import { agentLoops } from "./agentLoops.query.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.mockReturnValue([]);
  mocks.resolveCallerUserId.mockResolvedValue("user-1");
  mocks.resolveAgentLoopReadScope.mockResolvedValue({
    tenantId: "tenant-1",
    ownerUserId: "user-1",
  });
  mocks.ensurePersonalMemoryAutomation.mockResolvedValue(undefined);
});

describe("agentLoops query ownership", () => {
  it("adds the signed-in owner to the database predicate by default", async () => {
    await agentLoops(null, { tenantId: "tenant-1", limit: 100 }, {
      auth: {
        authType: "cognito",
        tenantId: "tenant-1",
        principalId: "sub-1",
      },
    } as never);

    expect(mocks.where).toHaveBeenCalledWith({
      and: [
        { eq: ["agent_loops.tenant_id", "tenant-1"] },
        { eq: ["agent_loops.owner_user_id", "user-1"] },
      ],
    });
  });

  it("omits the owner predicate only for the separately authorized operator scope", async () => {
    mocks.resolveAgentLoopReadScope.mockResolvedValue({
      tenantId: "tenant-1",
      ownerUserId: null,
    });

    await agentLoops(
      null,
      { tenantId: "tenant-1", scope: "OPERATOR", limit: 100 },
      {
        auth: {
          authType: "cognito",
          tenantId: "tenant-1",
          principalId: "sub-1",
        },
      } as never,
    );

    expect(mocks.resolveAgentLoopReadScope).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "OPERATOR",
    );
    expect(mocks.where).toHaveBeenCalledWith({
      and: [{ eq: ["agent_loops.tenant_id", "tenant-1"] }],
    });
  });
});
