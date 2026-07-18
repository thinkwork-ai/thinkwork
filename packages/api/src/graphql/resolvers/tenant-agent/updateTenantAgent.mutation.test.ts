import { beforeEach, describe, expect, it, vi } from "vitest";

const { authCalls, updateSets, resetMocks } = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const updateSets: Record<string, unknown>[] = [];
  return {
    authCalls,
    updateSets,
    resetMocks: () => {
      authCalls.length = 0;
      updateSets.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  return {
    agents: {
      id: col("agents.id"),
      tenant_id: col("agents.tenant_id"),
      is_platform_default: col("agents.is_platform_default"),
      runtime: col("agents.runtime"),
      runtime_config: col("agents.runtime_config"),
    },
    tenants: {
      id: col("tenants.id"),
      slug: col("tenants.slug"),
    },
    db: {
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () =>
            Promise.resolve([{ runtime: "pi", runtimeConfig: null }]),
        };
        return chain;
      },
      update: () => ({
        set: (updates: Record<string, unknown>) => {
          updateSets.push(updates);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: "agent-platform" }]),
            }),
          };
        },
      }),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("./shared.js", () => ({
  assertTenantGuardrail: vi.fn(() => Promise.resolve()),
  loadTenantAgentForGraphql: vi.fn(() =>
    Promise.resolve({
      id: "agent-platform",
      tenantId: "tenant-1",
      name: "Platform",
      model: "sonnet",
    }),
  ),
  parseJsonInput: (value: unknown) =>
    typeof value === "string" ? JSON.parse(value) : value,
}));

vi.mock("../../../lib/harness/managed-profile.js", () => ({
  readHarnessReadiness: vi.fn(() =>
    Promise.resolve({ ready: true, reasonCode: "ready" }),
  ),
}));

describe("updateTenantAgent", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("updates the tenant platform agent baseline after admin authorization", async () => {
    const { updateTenantAgent } =
      await import("./updateTenantAgent.mutation.js");

    const result = await updateTenantAgent(
      null,
      {
        tenantId: "tenant-1",
        input: {
          name: "Platform agent",
          runtime: "STRANDS",
          model: "us.anthropic.claude-sonnet-4-5",
          sandbox: '{"enabled":true}',
          webExtract: '{"enabled":true}',
          budgetPaused: true,
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "tenant_agent:update",
    ]);
    expect(updateSets[0]).toMatchObject({
      name: "Platform agent",
      runtime: "pi",
      model: "us.anthropic.claude-sonnet-4-5",
      sandbox: { enabled: true },
      web_extract: { enabled: true },
      budget_paused: true,
      budget_paused_reason: "tenant_agent_update",
    });
    expect(updateSets[0]).toHaveProperty("updated_at");
    expect(updateSets[0]).toHaveProperty("budget_paused_at");
    expect(result).toMatchObject({ id: "agent-platform" });
  });

  it("treats the legacy Harness runtime field as a new-thread default", async () => {
    const { updateTenantAgent } =
      await import("./updateTenantAgent.mutation.js");

    await updateTenantAgent(
      null,
      {
        tenantId: "tenant-1",
        input: {
          runtime: "AGENTCORE",
          runtimeConfig: JSON.stringify({ defaultSpaceId: "space-1" }),
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({
      runtime: "pi",
      runtime_config: {
        defaultSpaceId: "space-1",
        defaultThreadRuntime: "agentcore",
      },
    });
  });

  it("changes the new-thread default back to Pi without restoring enrollments", async () => {
    const { updateTenantAgent } =
      await import("./updateTenantAgent.mutation.js");

    await updateTenantAgent(
      null,
      {
        tenantId: "tenant-1",
        input: { runtime: "FLUE" },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({
      runtime: "pi",
      runtime_config: { defaultThreadRuntime: "pi" },
    });
  });
});
