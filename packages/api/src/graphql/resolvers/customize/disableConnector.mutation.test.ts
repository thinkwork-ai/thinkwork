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
  connectors: {
    tenant_id: "tenant_id",
    dispatch_target_type: "dispatch_target_type",
    dispatch_target_id: "dispatch_target_id",
    catalog_slug: "catalog_slug",
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

import { disableConnector } from "./disableConnector.mutation.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

const ctx = {} as any;

describe("disableConnector", () => {
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
  });

  it("returns true on the happy path and writes the disable update", async () => {
    const result = await disableConnector(
      null,
      { input: { computerId: "computer-1", slug: "slack" } },
      ctx,
    );
    expect(result).toBe(true);
    expect(lastUpdateSet.value?.enabled).toBe(false);
    expect(lastUpdateSet.value?.status).toBe("paused");
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
  });

  it("fires the workspace renderer after the disable update commits", async () => {
    const renderSpy = vi.mocked(renderWorkspaceAfterCustomize);
    renderSpy.mockClear();
    await disableConnector(
      null,
      { input: { computerId: "computer-1", slug: "slack" } },
      ctx,
    );
    expect(renderSpy).toHaveBeenCalledWith(
      "disableConnector",
      "agent-primary",
      "computer-1",
    );
  });

  it("is idempotent — returns true when no row matches", async () => {
    mockUpdate.mockReturnValue(null);
    const result = await disableConnector(
      null,
      { input: { computerId: "computer-1", slug: "missing" } },
      ctx,
    );
    expect(result).toBe(true);
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      disableConnector(
        null,
        { input: { computerId: "computer-1", slug: "slack" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockReturnValue(false);
    await expect(
      disableConnector(
        null,
        { input: { computerId: "computer-1", slug: "slack" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });
});
