import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCaller,
  mockRequireTenantMember,
  mockSelect,
  mockInsert,
  computerRow,
  catalogRow,
  insertedRow,
  lastInsertValues,
} = vi.hoisted(() => ({
  mockResolveCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  computerRow: {
    id: "computer-1",
    tenant_id: "tenant-1",
    owner_user_id: "user-1",
    primary_agent_id: "agent-primary",
    migrated_from_agent_id: null,
  },
  catalogRow: {
    id: "twc-1",
    tenant_id: "tenant-1",
    slug: "daily-digest",
    display_name: "Daily Digest",
    description: "Summarizes yesterday's activity",
    category: "operations",
    icon: null,
    default_config: { template: "summary" } as Record<string, unknown> | null,
    default_schedule: "cron(0 13 * * ? *)" as string | null,
    status: "active",
    enabled: true,
  },
  insertedRow: {
    id: "routine-1",
    tenant_id: "tenant-1",
    agent_id: "agent-primary",
    name: "Daily Digest",
    catalog_slug: "daily-digest",
    status: "active",
    updated_at: "2026-05-09T00:00:00Z",
  },
  lastInsertValues: { value: null as Record<string, unknown> | null },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          const name = (table as { __name?: string }).__name ?? "computers";
          if (name === "computers") {
            return mockSelect(name) ? [computerRow] : [];
          }
          return mockSelect(name) ? [catalogRow] : [];
        },
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        lastInsertValues.value = vals;
        return {
          onConflictDoUpdate: () => ({
            returning: () => mockInsert(vals),
          }),
        };
      },
    }),
  },
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  ne: (...args: unknown[]) => args,
  sql: (s: TemplateStringsArray) => s.join(""),
  computers: { __name: "computers" },
  routines: {
    __name: "routines",
    agent_id: "agent_id",
    catalog_slug: "catalog_slug",
  },
  tenantWorkflowCatalog: { __name: "tenant_workflow_catalog" },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

import { enableWorkflow } from "./enableWorkflow.mutation.js";

const ctx = {} as unknown as Parameters<typeof enableWorkflow>[2];

describe("enableWorkflow", () => {
  beforeEach(() => {
    mockResolveCaller.mockReset();
    mockRequireTenantMember.mockReset();
    mockSelect.mockReset();
    mockInsert.mockReset();
    lastInsertValues.value = null;
    mockResolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mockRequireTenantMember.mockResolvedValue("admin");
    mockSelect.mockReturnValue(true);
    mockInsert.mockReturnValue([insertedRow]);
    Object.assign(computerRow, {
      primary_agent_id: "agent-primary",
      migrated_from_agent_id: null,
    });
    catalogRow.default_config = { template: "summary" };
    catalogRow.default_schedule = "cron(0 13 * * ? *)";
  });

  it("enables a workflow and returns the WorkflowBinding projection keyed on primary_agent_id", async () => {
    const result = await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(result.catalogSlug).toBe("daily-digest");
    expect(result.agentId).toBe("agent-primary");
    expect(result.computerId).toBe("computer-1");
    expect(result.status).toBe("active");
    expect(result.enabled).toBe(true);
    expect(result.updatedAt).toBe("2026-05-09T00:00:00Z");
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(lastInsertValues.value?.agent_id).toBe("agent-primary");
    expect(lastInsertValues.value?.catalog_slug).toBe("daily-digest");
    expect(lastInsertValues.value?.status).toBe("active");
    expect(lastInsertValues.value?.name).toBe("Daily Digest");
    // Schedule sourced from typed default_schedule column (preferred over default_config.schedule).
    expect(lastInsertValues.value?.schedule).toBe("cron(0 13 * * ? *)");
  });

  it("falls back to default_config.schedule when default_schedule is null", async () => {
    catalogRow.default_schedule = null;
    catalogRow.default_config = {
      schedule: "cron(0 9 * * MON *)",
      template: "summary",
    };
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(lastInsertValues.value?.schedule).toBe("cron(0 9 * * MON *)");
  });

  it("uses default_schedule even when default_config is null", async () => {
    catalogRow.default_config = null;
    catalogRow.default_schedule = "cron(0 13 * * ? *)";
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(lastInsertValues.value?.schedule).toBe("cron(0 13 * * ? *)");
  });

  it("copies catalog default_config verbatim into the new routines row", async () => {
    catalogRow.default_config = {
      template: "summary",
      retention_days: 30,
    };
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(lastInsertValues.value?.config).toEqual({
      template: "summary",
      retention_days: 30,
    });
  });

  it("is idempotent — re-enabling the same workflow calls the upsert path again with identical values", async () => {
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    const first = { ...lastInsertValues.value };
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(lastInsertValues.value).toEqual(first);
  });

  it("falls back to migrated_from_agent_id when primary_agent_id is null", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: "agent-migrated",
    });
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(lastInsertValues.value?.agent_id).toBe("agent-migrated");
  });

  it("tolerates a null schedule when neither default_schedule nor default_config.schedule is set", async () => {
    catalogRow.default_schedule = null;
    catalogRow.default_config = { template: "summary" };
    await enableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(lastInsertValues.value?.schedule).toBeNull();
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      enableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? false : true,
    );
    await expect(
      enableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });

  it("rejects when the Computer has no primary agent at all", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: null,
    });
    await expect(
      enableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND|primary agent/i);
  });

  it("rejects when the caller is not a tenant member of the Computer's tenant", async () => {
    mockRequireTenantMember.mockRejectedValue(
      new Error("Tenant membership required"),
    );
    await expect(
      enableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/Tenant membership required/);
  });

  it("rejects when the catalog row is missing", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? true : false,
    );
    await expect(
      enableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "missing-flow" } },
        ctx,
      ),
    ).rejects.toThrow(/CUSTOMIZE_CATALOG_NOT_FOUND|catalog entry not found/i);
  });
});
