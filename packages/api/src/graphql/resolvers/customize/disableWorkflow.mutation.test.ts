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
      from: (table: { __name?: string }) => ({
        where: () => {
          const name = (table as { __name?: string }).__name ?? "computers";
          return mockSelect(name) ? [computerRow] : [];
        },
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        lastUpdateSet.value = vals;
        return {
          where: (...args: unknown[]) => mockUpdate(args),
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
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

import { disableWorkflow } from "./disableWorkflow.mutation.js";

const ctx = {} as unknown as Parameters<typeof disableWorkflow>[2];

describe("disableWorkflow", () => {
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
    mockUpdate.mockReturnValue(undefined);
    Object.assign(computerRow, {
      primary_agent_id: "agent-primary",
      migrated_from_agent_id: null,
    });
  });

  it("flips routines.status to inactive for the caller's primary agent + slug", async () => {
    const result = await disableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(result).toBe(true);
    expect(lastUpdateSet.value?.status).toBe("inactive");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
  });

  it("is idempotent — calling disable twice still flips status both times without error", async () => {
    await disableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    await disableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("returns true silently when the Computer has no primary agent (no row to disable)", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: null,
    });
    const result = await disableWorkflow(
      null,
      { input: { computerId: "computer-1", slug: "daily-digest" } },
      ctx,
    );
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      disableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockReturnValue(false);
    await expect(
      disableWorkflow(
        null,
        { input: { computerId: "computer-1", slug: "daily-digest" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });
});
