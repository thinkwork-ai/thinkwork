import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockExecute,
  sqlCalls,
  mockCanReadTenantSpaces,
  mockCanManageTenantSpaces,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockToGraphqlSpace,
  mockUserAccessibleSpacePredicate,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
  mockCanReadTenantSpaces: vi.fn(),
  mockCanManageTenantSpaces: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockToGraphqlSpace: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    status: String(row.status).toUpperCase(),
    kind: String(row.kind).toUpperCase(),
    accessMode: String(row.access_mode ?? "public").toUpperCase(),
    prompt: row.prompt,
    templateKey: row.template_key,
  })),
  mockUserAccessibleSpacePredicate: vi.fn(() => ({ type: "accessible" })),
  sqlCalls: [] as Array<{ text: string; values: unknown[] }>,
}));

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  db: { select: mockSelect, execute: mockExecute },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const call = { text: strings.join("?"), values };
      sqlCalls.push(call);
      return {
        type: "sql",
        text: call.text,
        values: call.values,
      };
    },
    {
      join: vi.fn(() => ({ type: "sql.join" })),
    },
  ),
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    status: "spaces.status",
    template_key: "spaces.template_key",
    config: "spaces.config",
  },
  spaceMembers: {
    tenant_id: "space_members.tenant_id",
    space_id: "space_members.space_id",
    user_id: "space_members.user_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
  canManageTenantSpaces: mockCanManageTenantSpaces,
  canReadTenantSpaces: mockCanReadTenantSpaces,
  parseSpaceStatus: (value: unknown) =>
    value == null ? undefined : String(value).toLowerCase(),
  toGraphqlSpace: mockToGraphqlSpace,
  userAccessibleSpacePredicate: mockUserAccessibleSpacePredicate,
}));

let resolver: typeof import("./spaces.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockExecute.mockReset();
  mockCanReadTenantSpaces.mockReset();
  mockCanManageTenantSpaces.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockRequireTenantAdmin.mockRejectedValue(new Error("not admin"));
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockToGraphqlSpace.mockClear();
  mockUserAccessibleSpacePredicate.mockClear();
  sqlCalls.length = 0;
  resolver = await import("./spaces.query.js");
});

describe("spaces", () => {
  it("returns tenant Spaces for a tenant member", async () => {
    mockCanReadTenantSpaces.mockResolvedValueOnce(true);
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          space_id: "space-1",
          unread_thread_count: 2,
          last_activity_at: "2026-05-19T18:00:00.000Z",
        },
      ],
    });
    mockSelect.mockReturnValueOnce(
      queryRows([
        {
          id: "space-1",
          tenant_id: "tenant-1",
          name: "Customer Onboarding",
          status: "active",
          kind: "customer_onboarding",
          access_mode: "public",
          prompt: "Keep onboarding moving.",
          template_key: "customer_onboarding",
        },
      ]),
    );

    const result = await resolver.spaces(
      null,
      { tenantId: "tenant-1", status: "ACTIVE" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mockCanReadTenantSpaces).toHaveBeenCalledWith(
      { auth: { authType: "cognito" } },
      "tenant-1",
    );
    expect(result).toEqual([
      {
        id: "space-1",
        tenantId: "tenant-1",
        name: "Customer Onboarding",
        status: "ACTIVE",
        kind: "CUSTOMER_ONBOARDING",
        accessMode: "PUBLIC",
        prompt: "Keep onboarding moving.",
        templateKey: "customer_onboarding",
        unreadThreadCount: 2,
        lastActivityAt: "2026-05-19T18:00:00.000Z",
      },
    ]);
    expect(
      sqlCalls.some((call) =>
        call.values.includes("system:automation_builder"),
      ),
    ).toBe(true);
    expect(sqlCalls.some((call) => call.text.includes("systemHidden"))).toBe(
      true,
    );
  });

  it("returns an empty list instead of leaking cross-tenant Spaces", async () => {
    mockCanReadTenantSpaces.mockResolvedValueOnce(false);

    const result = await resolver.spaces(null, { tenantId: "tenant-2" }, {
      auth: { authType: "cognito" },
    } as any);

    expect(result).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("lets admins request every Space for management views", async () => {
    mockCanReadTenantSpaces.mockResolvedValueOnce(true);
    mockCanManageTenantSpaces.mockResolvedValueOnce(true);
    mockExecute.mockResolvedValueOnce({ rows: [] });
    mockSelect.mockReturnValueOnce(
      queryRows([
        {
          id: "space-private",
          tenant_id: "tenant-1",
          name: "Executive",
          status: "active",
          kind: "custom",
          access_mode: "private",
          prompt: null,
          template_key: "executive",
        },
      ]),
    );

    const result = await resolver.spaces(
      null,
      {
        tenantId: "tenant-1",
        status: "ACTIVE",
        includeAllForAdmin: true,
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mockUserAccessibleSpacePredicate).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      id: "space-private",
      accessMode: "PRIVATE",
    });
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
