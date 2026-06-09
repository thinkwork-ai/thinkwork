import { beforeEach, describe, expect, it, vi } from "vitest";

const { approvalCalls } = vi.hoisted(() => ({
  approvalCalls: [] as Array<{ tenantId: string; userId: string }>,
}));

vi.mock("./model-approvals.js", () => ({
  ensureDefaultModelApprovalsForUser: vi.fn(
    async (input: { tenantId: string; userId: string }) => {
      approvalCalls.push(input);
      return ["us.anthropic.claude-sonnet-4-6"];
    },
  ),
}));

import { ensureTenantBootstrapDefaults } from "./tenant-bootstrap-defaults.js";

function createMockDb(selectResults: unknown[][]) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];

  const db = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectResults.shift() ?? []),
        then: (resolve: (value: unknown[]) => void) =>
          resolve(selectResults.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        return {
          onConflictDoUpdate: vi.fn(async () => []),
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => {
        updates.push({ table, values });
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
  };

  return { db: db as any, inserts, updates };
}

beforeEach(() => {
  approvalCalls.length = 0;
});

describe("ensureTenantBootstrapDefaults", () => {
  it("seeds model catalog, tenant settings, platform agent, and user approvals", async () => {
    const { db, inserts, updates } = createMockDb([
      [], // existing platform agent
      [], // existing agent workspace folders
    ]);

    await ensureTenantBootstrapDefaults(
      { tenantId: "tenant-1", userId: "user-1" },
      { db },
    );

    expect(inserts).toHaveLength(3);
    expect(inserts[0].values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: "us.anthropic.claude-sonnet-4-6",
          display_name: "Claude Sonnet 4.6",
        }),
      ]),
    );
    expect(inserts[1].values).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        default_model: "us.anthropic.claude-sonnet-4-6",
      }),
    );
    expect(inserts[2].values).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        name: "ThinkWork Agent",
        model: "us.anthropic.claude-sonnet-4-6",
        is_platform_default: true,
      }),
    );
    expect(updates).toEqual([]);
    expect(approvalCalls).toEqual([{ tenantId: "tenant-1", userId: "user-1" }]);
  });

  it("repairs an existing platform agent that has no model", async () => {
    const { db, inserts, updates } = createMockDb([
      [{ id: "agent-1", model: null }],
    ]);

    await ensureTenantBootstrapDefaults(
      { tenantId: "tenant-1", userId: "user-1" },
      { db },
    );

    expect(inserts).toHaveLength(2);
    expect(updates).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({
          model: "us.anthropic.claude-sonnet-4-6",
        }),
      }),
    ]);
    expect(approvalCalls).toEqual([{ tenantId: "tenant-1", userId: "user-1" }]);
  });
});
