import { beforeEach, describe, expect, it, vi } from "vitest";

const { authCalls, updateSets, selectRows, resetMocks } = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const updateSets: Record<string, unknown>[] = [];
  const selectRows: unknown[][] = [];
  return {
    authCalls,
    updateSets,
    selectRows,
    resetMocks: () => {
      authCalls.length = 0;
      updateSets.length = 0;
      selectRows.length = 0;
      selectRows.push([{ tenant_id: "tenant-1" }]);
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  return {
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(selectRows.shift() ?? []),
        }),
      }),
      update: () => ({
        set: (updates: Record<string, unknown>) => {
          updateSets.push(updates);
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    id: "space-1",
                    tenant_id: "tenant-1",
                    slug: "finance",
                    name: "Finance",
                    status: "active",
                    kind: "custom",
                    access_mode: "private",
                    model_override: updates.model_override,
                    guardrail_id_override: updates.guardrail_id_override,
                    budget_monthly_cents_override:
                      updates.budget_monthly_cents_override,
                    budget_paused_override: updates.budget_paused_override,
                    sandbox_override: updates.sandbox_override,
                    updated_at: updates.updated_at,
                  },
                ]),
            }),
          };
        },
      }),
    },
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  };
});

vi.mock("../../../lib/agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: vi.fn(() =>
    Promise.resolve({ id: "agent-platform", sandbox: { enabled: true } }),
  ),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("../tenant-agent/shared.js", () => ({
  assertTenantGuardrail: vi.fn(() => Promise.resolve()),
  forbidden: (message: string) => new Error(message),
  sandboxBaselineEnabled: (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    (value as { enabled?: unknown }).enabled === true,
}));

vi.mock("./shared.js", () => ({
  toGraphqlSpace: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    accessMode: "PRIVATE",
    runtimeOverrides: {
      model: row.model_override,
      guardrailId: row.guardrail_id_override,
      budgetMonthlyCents: row.budget_monthly_cents_override,
      budgetPaused: row.budget_paused_override,
      sandbox: row.sandbox_override,
    },
  }),
}));

describe("setSpaceRuntimeOverrides", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("persists typed Space runtime overrides after tenant authorization", async () => {
    const { setSpaceRuntimeOverrides } =
      await import("./setSpaceRuntimeOverrides.mutation.js");

    const result = await setSpaceRuntimeOverrides(
      null,
      {
        spaceId: "space-1",
        input: {
          model: "us.anthropic.claude-opus-4-1",
          guardrailId: "guardrail-1",
          budgetMonthlyCents: 2500,
          budgetPaused: false,
          sandbox: true,
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "space_runtime_overrides:update",
    ]);
    expect(updateSets[0]).toMatchObject({
      model_override: "us.anthropic.claude-opus-4-1",
      guardrail_id_override: "guardrail-1",
      budget_monthly_cents_override: 2500,
      budget_paused_override: false,
      sandbox_override: true,
    });
    expect(result).toMatchObject({
      id: "space-1",
      runtimeOverrides: {
        model: "us.anthropic.claude-opus-4-1",
        guardrailId: "guardrail-1",
        sandbox: true,
      },
    });
  });
});
