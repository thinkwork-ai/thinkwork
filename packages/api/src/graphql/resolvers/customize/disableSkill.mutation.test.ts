import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCaller,
  mockRequireTenantMember,
  mockSelect,
  mockUpdate,
  computerRow,
  lastUpdateSet,
} = vi.hoisted(() => ({
  mockResolveCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  computerRow: {
    id: "computer-1",
    tenant_id: "tenant-1",
    owner_user_id: "user-1",
    primary_agent_id: "agent-primary",
    migrated_from_agent_id: null,
  },
  lastUpdateSet: { value: null as Record<string, unknown> | null },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => (mockSelect() ? [computerRow] : []),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        lastUpdateSet.value = vals;
        return {
          where: () => mockUpdate(vals),
        };
      },
    }),
  },
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  ne: (...args: unknown[]) => args,
  sql: (s: TemplateStringsArray) => s.join(""),
  computers: {},
  agentSkills: {
    agent_id: "agent_id",
    skill_id: "skill_id",
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("./render-workspace-after-customize.js", () => ({
  renderWorkspaceAfterCustomize: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

import { disableSkill } from "./disableSkill.mutation.js";

const ctx = {} as unknown as Parameters<typeof disableSkill>[2];

describe("disableSkill", () => {
  beforeEach(() => {
    mockResolveCaller.mockReset();
    mockRequireTenantMember.mockReset();
    mockSelect.mockReset();
    mockUpdate.mockReset();
    lastUpdateSet.value = null;
    mockResolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mockRequireTenantMember.mockResolvedValue("admin");
    mockSelect.mockReturnValue(true);
    mockUpdate.mockReturnValue(null);
    Object.assign(computerRow, {
      primary_agent_id: "agent-primary",
      migrated_from_agent_id: null,
    });
  });

  it("returns true on the happy path and writes the disable update", async () => {
    const result = await disableSkill(
      null,
      { input: { computerId: "computer-1", skillId: "sales-prep" } },
      ctx,
    );
    expect(result).toBe(true);
    expect(lastUpdateSet.value?.enabled).toBe(false);
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
  });

  it("is idempotent — returns true when no row matches", async () => {
    const result = await disableSkill(
      null,
      { input: { computerId: "computer-1", skillId: "missing" } },
      ctx,
    );
    expect(result).toBe(true);
  });

  it("returns true silently when the Computer has no primary agent", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: null,
    });
    const result = await disableSkill(
      null,
      { input: { computerId: "computer-1", skillId: "sales-prep" } },
      ctx,
    );
    expect(result).toBe(true);
    expect(lastUpdateSet.value).toBeNull();
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      disableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "sales-prep" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockReturnValue(false);
    await expect(
      disableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "sales-prep" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });

  it("rejects built-in tool slugs", async () => {
    await expect(
      disableSkill(
        null,
        { input: { computerId: "computer-1", skillId: "web-search" } },
        ctx,
      ),
    ).rejects.toThrow(
      /CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE|managed by your tenant template/i,
    );
  });
});
