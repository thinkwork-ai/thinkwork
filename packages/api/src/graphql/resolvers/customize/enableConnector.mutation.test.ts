import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCaller,
  mockRequireTenantMember,
  mockSelect,
  mockInsert,
  computerRow,
  catalogRow,
  insertedRow,
  lastSelectChain,
  lastInsertValues,
} = vi.hoisted(() => ({
  mockResolveCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  computerRow: {
    id: "computer-1",
    slug: "fleet-caterpillar-1",
    tenant_id: "tenant-1",
    owner_user_id: "user-1",
    primary_agent_id: "agent-primary",
    migrated_from_agent_id: null,
  },
  catalogRow: {
    id: "cat-1",
    tenant_id: "tenant-1",
    slug: "slack",
    kind: "native",
    display_name: "Slack",
    description: "Send messages",
    default_config: {},
  },
  insertedRow: {
    id: "conn-1",
    tenant_id: "tenant-1",
    catalog_slug: "slack",
    status: "active",
    enabled: true,
    updated_at: "2026-05-09T00:00:00Z",
  },
  lastSelectChain: { value: null as string | null },
  lastInsertValues: { value: null as Record<string, unknown> | null },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          const name = (table as any).__name ?? "computers";
          lastSelectChain.value = name;
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
  connectors: {
    __name: "connectors",
    tenant_id: "tenant_id",
    dispatch_target_id: "dispatch_target_id",
    catalog_slug: "catalog_slug",
    dispatch_target_type: "dispatch_target_type",
  },
  tenantConnectorCatalog: { __name: "tenant_connector_catalog" },
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

import { enableConnector } from "./enableConnector.mutation.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

const ctx = {} as any;

describe("enableConnector", () => {
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
  });

  it("enables a native connector and returns the binding", async () => {
    const result = await enableConnector(
      null,
      { input: { computerId: "computer-1", slug: "slack" } },
      ctx,
    );
    expect(result.catalogSlug).toBe("slack");
    expect(result.enabled).toBe(true);
    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(lastInsertValues.value?.dispatch_target_type).toBe("computer");
    expect(lastInsertValues.value?.dispatch_target_id).toBe("computer-1");
    expect(lastInsertValues.value?.catalog_slug).toBe("slack");
  });

  it("fires the workspace renderer after the binding write commits", async () => {
    const renderSpy = vi.mocked(renderWorkspaceAfterCustomize);
    renderSpy.mockClear();
    await enableConnector(
      null,
      { input: { computerId: "computer-1", slug: "slack" } },
      ctx,
    );
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith(
      "enableConnector",
      "agent-primary",
      "computer-1",
    );
  });

  it("rejects when caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    await expect(
      enableConnector(
        null,
        { input: { computerId: "computer-1", slug: "slack" } },
        ctx,
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it("rejects when the Computer is not owned by the caller", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? false : true,
    );
    await expect(
      enableConnector(
        null,
        { input: { computerId: "computer-1", slug: "slack" } },
        ctx,
      ),
    ).rejects.toThrow(/Computer not found/);
  });

  it("rejects when the catalog row is missing", async () => {
    mockSelect.mockImplementation((name: string) =>
      name === "computers" ? true : false,
    );
    await expect(
      enableConnector(
        null,
        { input: { computerId: "computer-1", slug: "missing" } },
        ctx,
      ),
    ).rejects.toThrow(/CUSTOMIZE_CATALOG_NOT_FOUND|catalog entry not found/i);
  });

  it("rejects MCP-kind catalog rows with a typed error code", async () => {
    const originalKind = catalogRow.kind;
    Object.assign(catalogRow, { kind: "mcp" });
    try {
      await expect(
        enableConnector(
          null,
          { input: { computerId: "computer-1", slug: "slack" } },
          ctx,
        ),
      ).rejects.toThrow(/CUSTOMIZE_MCP_NOT_SUPPORTED|mobile app/i);
    } finally {
      Object.assign(catalogRow, { kind: originalKind });
    }
  });

  it("disambiguates connector name per Computer using computer.slug", async () => {
    await enableConnector(
      null,
      { input: { computerId: "computer-1", slug: "slack" } },
      ctx,
    );
    expect(lastInsertValues.value?.name).toBe("Slack (fleet-caterpillar-1)");
  });
});
