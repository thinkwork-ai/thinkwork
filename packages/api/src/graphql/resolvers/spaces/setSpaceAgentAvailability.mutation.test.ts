import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, insertValues, conflictOptions, authCalls, resetMocks } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const insertValues: unknown[] = [];
    const conflictOptions: unknown[] = [];
    const authCalls: unknown[] = [];
    return {
      selectQueue,
      insertValues,
      conflictOptions,
      authCalls,
      resetMocks: () => {
        selectQueue.length = 0;
        insertValues.length = 0;
        conflictOptions.length = 0;
        authCalls.length = 0;
      },
    };
  });

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const chain = {
    from: () => ({
      where: () => Promise.resolve(selectQueue.shift() ?? []),
    }),
  };
  return {
    agents: { id: col("agents.id"), tenant_id: col("agents.tenant_id") },
    spaces: { id: col("spaces.id"), tenant_id: col("spaces.tenant_id") },
    spaceAgentAssignments: {
      tenant_id: col("space_agent_assignments.tenant_id"),
      space_id: col("space_agent_assignments.space_id"),
      agent_id: col("space_agent_assignments.agent_id"),
    },
    db: {
      select: () => chain,
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertValues.push(values);
          return {
            onConflictDoUpdate: (options: unknown) => {
              conflictOptions.push(options);
              return {
                returning: () =>
                  Promise.resolve([
                    {
                      id: "assignment-1",
                      ...values,
                      created_at: new Date("2026-05-20T00:00:00Z"),
                      updated_at: values.updated_at,
                    },
                  ]),
              };
            },
          };
        },
      }),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
      ),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

describe("setSpaceAgentAvailability", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("upserts an active Space assignment for an Agent in the tenant", async () => {
    selectQueue.push([{ space: "space-1" }], [{ agent: "agent-1" }]);
    const { setSpaceAgentAvailability } =
      await import("./setSpaceAgentAvailability.mutation.js");

    const result = await setSpaceAgentAvailability(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          agentId: "agent-1",
          enabled: true,
          localRole: "Analyst",
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "set_space_agent_availability",
    ]);
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      space_id: "space-1",
      agent_id: "agent-1",
      local_role: "Analyst",
      status: "active",
      auto_subscribe: true,
    });
    expect(conflictOptions[0]).toMatchObject({
      set: { status: "active", auto_subscribe: true },
    });
    expect(result).toMatchObject({
      id: "assignment-1",
      spaceId: "space-1",
      agentId: "agent-1",
      localRole: "Analyst",
      status: "ACTIVE",
    });
  });

  it("archives the assignment when availability is disabled", async () => {
    selectQueue.push([{ space: "space-1" }], [{ agent: "agent-1" }]);
    const { setSpaceAgentAvailability } =
      await import("./setSpaceAgentAvailability.mutation.js");

    const result = await setSpaceAgentAvailability(
      null,
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          agentId: "agent-1",
          enabled: false,
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(insertValues[0]).toMatchObject({ status: "archived" });
    expect(result).toMatchObject({ status: "ARCHIVED" });
  });

  it("rejects cross-tenant or missing Space/Agent pairs", async () => {
    selectQueue.push([], [{ agent: "agent-1" }]);
    const { setSpaceAgentAvailability } =
      await import("./setSpaceAgentAvailability.mutation.js");

    await expect(
      setSpaceAgentAvailability(
        null,
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            agentId: "agent-1",
            enabled: true,
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space or Agent not found");
    expect(insertValues).toHaveLength(0);
  });
});
