/**
 * Unit tests for `requireTenantAdmin` — the shared authz helper used by
 * user- and member-mutating resolvers in packages/api.
 *
 * The helper encapsulates the inline owner-or-admin check that was
 * duplicated across several resolvers (see allTenantAgents.query.ts). It
 * accepts an optional `dbOrTx` handle so callers can run the role lookup
 * inside a `db.transaction(tx => ...)` block alongside their own writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockMemberRows, mockResolveCallerUserId } = vi.hoisted(() => ({
  mockMemberRows: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mockMemberRows() as unknown[]),
      }),
    })),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  tenantMembers: {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
    role: "tenantMembers.role",
  },
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

// eslint-disable-next-line import/first
import {
  requireTenantAdmin,
  requireTenantMember,
} from "../graphql/resolvers/core/authz.js";

function cognitoCtx(principalId = "sub-1"): any {
  return {
    auth: {
      authType: "cognito",
      principalId,
      tenantId: null,
      email: "caller@example.com",
    },
  };
}

describe("requireTenantAdmin", () => {
  beforeEach(() => {
    mockMemberRows.mockReset();
    mockResolveCallerUserId.mockReset();
  });

  it("returns 'owner' when caller is owner in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "owner" }]);
    const role = await requireTenantAdmin(cognitoCtx(), "tenant-1");
    expect(role).toBe("owner");
  });

  it("returns 'admin' when caller is admin in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    const role = await requireTenantAdmin(cognitoCtx(), "tenant-1");
    expect(role).toBe("admin");
  });

  it("throws FORBIDDEN when caller is a plain member in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "member" }]);
    await expect(
      requireTenantAdmin(cognitoCtx(), "tenant-1"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("throws FORBIDDEN when caller has no membership in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([]);
    await expect(
      requireTenantAdmin(cognitoCtx(), "tenant-1"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("throws FORBIDDEN when caller identity cannot be resolved", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    await expect(
      requireTenantAdmin(cognitoCtx(), "tenant-1"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("returns 'admin' for a service caller with an owner/admin principal", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    const ctx: any = {
      auth: {
        authType: "apikey",
        principalId: "user-1",
        tenantId: "tenant-1",
        email: null,
      },
    };
    const role = await requireTenantAdmin(ctx, "tenant-1");
    expect(role).toBe("admin");
  });

  it("throws FORBIDDEN when a service caller has no resolvable principal", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    const ctx: any = {
      auth: {
        authType: "apikey",
        principalId: null,
        tenantId: null,
        email: null,
      },
    };
    await expect(requireTenantAdmin(ctx, "tenant-1")).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("uses the passed-in db/tx handle for the role lookup", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    const customSelect = vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve([{ role: "admin" }]),
      }),
    }));
    const tx = { select: customSelect } as any;
    const role = await requireTenantAdmin(cognitoCtx(), "tenant-1", tx);
    expect(role).toBe("admin");
    expect(customSelect).toHaveBeenCalledTimes(1);
  });
});

describe("requireTenantMember", () => {
  beforeEach(() => {
    mockMemberRows.mockReset();
    mockResolveCallerUserId.mockReset();
  });

  it("returns 'owner' when caller is owner in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "owner" }]);
    const role = await requireTenantMember(cognitoCtx(), "tenant-1");
    expect(role).toBe("owner");
  });

  it("returns 'admin' when caller is admin in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    const role = await requireTenantMember(cognitoCtx(), "tenant-1");
    expect(role).toBe("admin");
  });

  it("returns 'member' when caller is a plain member in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([{ role: "member" }]);
    const role = await requireTenantMember(cognitoCtx(), "tenant-1");
    expect(role).toBe("member");
  });

  it("throws FORBIDDEN when caller has no membership in target tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockMemberRows.mockReturnValue([]);
    await expect(
      requireTenantMember(cognitoCtx(), "tenant-1"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("throws FORBIDDEN when caller identity cannot be resolved", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    await expect(
      requireTenantMember(cognitoCtx(), "tenant-1"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("throws FORBIDDEN when authType is not cognito", async () => {
    const ctx: any = {
      auth: {
        authType: "apikey",
        principalId: null,
        tenantId: null,
        email: null,
      },
    };
    await expect(requireTenantMember(ctx, "tenant-1")).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("uses the passed-in db/tx handle for the membership lookup", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    const customSelect = vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve([{ role: "member" }]),
      }),
    }));
    const tx = { select: customSelect } as any;
    const role = await requireTenantMember(cognitoCtx(), "tenant-1", tx);
    expect(role).toBe("member");
    expect(customSelect).toHaveBeenCalledTimes(1);
  });
});
