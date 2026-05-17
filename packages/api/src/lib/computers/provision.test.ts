import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantUser,
  mockCreateComputerCore,
  lastActivityLogValuesRef,
  lastAssignmentValuesRef,
  templateLookupRef,
  sharedComputerLookupRef,
} = vi.hoisted(() => ({
  mockRequireTenantUser: vi.fn(),
  mockCreateComputerCore: vi.fn(),
  lastActivityLogValuesRef: { value: null as Record<string, unknown> | null },
  lastAssignmentValuesRef: { value: null as Record<string, unknown> | null },
  templateLookupRef: {
    // Default: platform-default template is seeded.
    value: [{ id: "tpl-platform" }] as Array<{ id: string }>,
  },
  sharedComputerLookupRef: {
    value: [{ id: "computer-shared" }] as Array<{ id: string }>,
  },
}));

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          if (table.__name === "agent_templates") {
            return Promise.resolve(templateLookupRef.value);
          }
          return {
            orderBy: () => ({
              limit: () => Promise.resolve(sharedComputerLookupRef.value),
            }),
          };
        },
      }),
    }),
    insert: (table: unknown) => {
      return {
        values: (v: Record<string, unknown>) => {
          if (
            (table as { __name?: string }).__name === "computer_assignments"
          ) {
            lastAssignmentValuesRef.value = v;
            return { onConflictDoNothing: () => Promise.resolve() };
          }
          lastActivityLogValuesRef.value = v;
          return Promise.resolve();
        },
      };
    },
  },
  activityLog: { __name: "activity_log" },
  computerAssignments: { __name: "computer_assignments" },
  agentTemplates: {
    __name: "agent_templates",
    id: "agent_templates.id",
    slug: "agent_templates.slug",
    tenant_id: "agent_templates.tenant_id",
    template_kind: "agent_templates.template_kind",
  },
  computers: {
    __name: "computers",
    id: "computers.id",
    tenant_id: "computers.tenant_id",
    scope: "computers.scope",
    status: "computers.status",
    created_at: "computers.created_at",
  },
  and: vi.fn((...parts: unknown[]) => ({ kind: "and", parts })),
  asc: vi.fn((col: unknown) => ({ kind: "asc", col })),
  eq: vi.fn((left: unknown, right: unknown) => ({
    kind: "eq",
    left,
    right,
  })),
  isNull: vi.fn((col: unknown) => ({ kind: "isNull", col })),
  ne: vi.fn((left: unknown, right: unknown) => ({
    kind: "ne",
    left,
    right,
  })),
}));

vi.mock("../../graphql/resolvers/computers/shared.js", () => ({
  createComputerCore: (...args: unknown[]) => mockCreateComputerCore(...args),
  requireTenantUser: (...args: unknown[]) => mockRequireTenantUser(...args),
}));

let helper: typeof import("./provision.js");

beforeEach(async () => {
  vi.resetModules();
  mockRequireTenantUser.mockReset();
  mockCreateComputerCore.mockReset();
  lastActivityLogValuesRef.value = null;
  lastAssignmentValuesRef.value = null;
  templateLookupRef.value = [{ id: "tpl-platform" }];
  sharedComputerLookupRef.value = [{ id: "computer-shared" }];
  mockRequireTenantUser.mockResolvedValue(undefined);

  mockCreateComputerCore.mockResolvedValue({
    id: "computer-1",
    tenant_id: "tenant-1",
    owner_user_id: null,
  });

  helper = await import("./provision.js");
});

describe("provisionComputerForMember", () => {
  it("assigns the tenant shared Computer on the happy path", async () => {
    const result = await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "user",
      callSite: "addTenantMember",
      adminUserId: "admin-1",
    });

    expect(result.status).toBe("assigned");
    if (result.status === "assigned") {
      expect(result.computerId).toBe("computer-shared");
    }
    expect(mockCreateComputerCore).not.toHaveBeenCalled();
    expect(mockRequireTenantUser).toHaveBeenCalledWith("tenant-1", "user-1");
    expect(lastAssignmentValuesRef.value).toMatchObject({
      tenant_id: "tenant-1",
      computer_id: "computer-shared",
      subject_type: "user",
      user_id: "user-1",
      role: "member",
      assigned_by_user_id: "admin-1",
    });
    expect(lastActivityLogValuesRef.value).toBeNull();
  });

  it("skips non-USER principals immediately without DB calls", async () => {
    const result = await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "team-1",
      principalType: "team",
      callSite: "addTenantMember",
    });

    expect(result).toEqual({ status: "skipped", reason: "not_user_principal" });
    expect(mockCreateComputerCore).not.toHaveBeenCalled();
    expect(lastAssignmentValuesRef.value).toBeNull();
    expect(lastActivityLogValuesRef.value).toBeNull();
  });

  it("accepts both 'USER' and 'user' principalType casings", async () => {
    const upperResult = await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "USER",
      callSite: "inviteMember",
    });
    expect(upperResult.status).toBe("assigned");
  });

  it("returns failed:no_default_template when the platform default is missing and writes an activity_log row", async () => {
    templateLookupRef.value = [];

    const result = await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "user",
      callSite: "addTenantMember",
      adminUserId: "admin-1",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("no_default_template");
    }
    expect(mockCreateComputerCore).not.toHaveBeenCalled();
    expect(lastActivityLogValuesRef.value).toMatchObject({
      tenant_id: "tenant-1",
      actor_type: "user",
      actor_id: "admin-1",
      action: "computer_auto_provision_failed",
      entity_type: "user",
      entity_id: "user-1",
    });
  });

  it("uses SYSTEM_ACTOR_ID for bootstrapUser-path activity_log rows", async () => {
    templateLookupRef.value = [];

    await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-new",
      principalType: "user",
      callSite: "bootstrapUser",
    });

    expect(lastActivityLogValuesRef.value).toMatchObject({
      actor_type: "system",
      actor_id: helper.SYSTEM_ACTOR_ID,
    });
  });

  it("captures unknown errors as failed:unknown with the error message", async () => {
    mockRequireTenantUser.mockRejectedValueOnce(
      new Error("database unreachable"),
    );

    const result = await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "user",
      callSite: "addTenantMember",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("unknown");
      expect(result.message).toContain("database unreachable");
    }
    expect(lastActivityLogValuesRef.value).toMatchObject({
      action: "computer_auto_provision_failed",
    });
  });

  it("never throws even when the underlying insert path rejects unexpectedly", async () => {
    mockRequireTenantUser.mockRejectedValueOnce(new Error("kaboom"));

    await expect(
      helper.provisionComputerForMember({
        tenantId: "tenant-1",
        userId: "user-1",
        principalType: "user",
        callSite: "addTenantMember",
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("creates a shared Base Computer when the tenant has no shared Computer yet", async () => {
    sharedComputerLookupRef.value = [];

    await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "user",
      callSite: "addTenantMember",
      adminUserId: "admin-1",
    });

    expect(mockCreateComputerCore).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerUserId: null,
        templateId: "tpl-platform",
        name: "Base Computer",
        scope: "shared",
        createdBy: "admin-1",
      }),
    );
    expect(lastAssignmentValuesRef.value).toMatchObject({
      computer_id: "computer-1",
      user_id: "user-1",
    });
  });

  it("passes through an explicit templateId override when creating the shared Base Computer", async () => {
    sharedComputerLookupRef.value = [];

    await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-1",
      principalType: "user",
      callSite: "addTenantMember",
      templateId: "tpl-tenant-override",
    });

    expect(mockCreateComputerCore).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "tpl-tenant-override" }),
    );
  });

  it("uses assigned_by_user_id=null and createdBy=null for bootstrapUser callSite", async () => {
    sharedComputerLookupRef.value = [];

    await helper.provisionComputerForMember({
      tenantId: "tenant-1",
      userId: "user-new",
      principalType: "user",
      callSite: "bootstrapUser",
      adminUserId: "should-be-ignored",
    });

    expect(mockCreateComputerCore).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: null }),
    );
    expect(lastAssignmentValuesRef.value).toMatchObject({
      assigned_by_user_id: null,
    });
  });
});
