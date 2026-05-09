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
    id: "ts-1",
    tenant_id: "tenant-1",
    skill_id: "sales-prep",
    source: "catalog",
    enabled: true,
  },
  insertedRow: {
    id: "as-1",
    tenant_id: "tenant-1",
    agent_id: "agent-primary",
    skill_id: "sales-prep",
    enabled: true,
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
  agentSkills: {
    __name: "agent_skills",
    agent_id: "agent_id",
    skill_id: "skill_id",
  },
  tenantSkills: { __name: "tenant_skills" },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

import { enableSkill } from "./enableSkill.mutation.js";

const ctx = {} as unknown as Parameters<typeof enableSkill>[2];

describe("enableSkill", () => {
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
  });

  it("enables a skill and returns the binding keyed on primary_agent_id", async () => {
    const result = await enableSkill(
      null,
      { input: { computerId: "computer-1", skillId: "sales-prep" } },
      ctx,
    );
    expect(result.skillId).toBe("sales-prep");
    expect(result.agentId).toBe("agent-primary");
    expect(result.enabled).toBe(true);
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(lastInsertValues.value?.agent_id).toBe("agent-primary");
    expect(lastInsertValues.value?.skill_id).toBe("sales-prep");
    expect(lastInsertValues.value?.enabled).toBe(true);
  });

  it("falls back to migrated_from_agent_id when primary_agent_id is null", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: "agent-migrated",
    });
    await enableSkill(
      null,
      { input: { computerId: "computer-1", skillId: "sales-prep" } },
      ctx,
    );
    expect(lastInsertValues.value?.agent_id).toBe("agent-migrated");
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      enableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "sales-prep" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? false : true,
    );
    await expect(
      enableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "sales-prep" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });

  it("rejects built-in tool slugs with a typed error code", async () => {
    await expect(
      enableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "web-search" } },
        ctx,
      ),
    ).rejects.toThrow(
      /CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE|managed by your tenant template/i,
    );
  });

  it("rejects when the Computer has no primary agent at all", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: null,
    });
    await expect(
      enableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "sales-prep" } },
        ctx,
      ),
    ).rejects.toThrow(
      /CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND|primary agent/i,
    );
  });

  it("rejects when the catalog row is missing", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? true : false,
    );
    await expect(
      enableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "missing-skill" } },
        ctx,
      ),
    ).rejects.toThrow(/CUSTOMIZE_CATALOG_NOT_FOUND|catalog entry not found/i);
  });
});
