/**
 * Contract tests for core tenant-scoped mutations that the admin skill
 * (or any caller) could previously invoke without a role gate.
 *
 * Before this PR:
 *  - `addTenantMember` accepted a top-level tenantId arg with no auth
 *    check — any authenticated user could promote themselves into any
 *    tenant if they knew the tenantId.
 *  - `inviteMember` created a Cognito user AND a tenant-member row with
 *    zero auth checks. The most blast-radius-heavy gap in the sweep: a
 *    member could hand themselves a second admin role in an unrelated
 *    tenant by knowing the tenantId, and the Cognito user creation would
 *    succeed even if the DB gate later failed.
 *  - `updateTenant` updated tenant name/plan/issuePrefix unauthenticated.
 *
 * `updateTenantMember` and `removeTenantMember` already carry
 * `requireTenantAdmin` inside their transactions — the audit table in
 * the PR description records them as "already gated; spot-verified."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectRows,
  mockInsertReturning,
  mockUpdateReturning,
  mockRequireTenantAdmin,
  cognitoSendMock,
  insertCallRef,
} = vi.hoisted(() => ({
  mockSelectRows: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  cognitoSendMock: vi.fn(),
  insertCallRef: { value: 0 },
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows() as unknown[]),
      }),
    })),
    insert: vi.fn(() => {
      insertCallRef.value++;
      return {
        values: () => ({
          returning: () => Promise.resolve(mockInsertReturning() as unknown[]),
        }),
      };
    }),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateReturning() as unknown[]),
        }),
      }),
    })),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  tenants: { id: "tenants.id" },
  tenantMembers: {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
    role: "tenantMembers.role",
  },
  users: { id: "users.id", email: "users.email" },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

// Cognito client is constructed at module import time; mock the module so
// AdminCreateUser / AdminGetUser route through our stub instead of AWS.
vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = cognitoSendMock;
  },
  AdminCreateUserCommand: class {
    constructor(public input: unknown) {}
  },
  AdminGetUserCommand: class {
    constructor(public input: unknown) {}
  },
}));

// eslint-disable-next-line import/first
import { addTenantMember } from "../graphql/resolvers/core/addTenantMember.mutation.js";
// eslint-disable-next-line import/first
import { inviteMember } from "../graphql/resolvers/core/inviteMember.mutation.js";
// eslint-disable-next-line import/first
import { updateTenant } from "../graphql/resolvers/core/updateTenant.mutation.js";

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

const FORBIDDEN = Object.assign(new Error("Tenant admin role required"), {
  extensions: { code: "FORBIDDEN" },
});

function mockAdminAllowed() {
  mockRequireTenantAdmin.mockResolvedValue("admin");
}
function mockAdminForbidden() {
  mockRequireTenantAdmin.mockRejectedValue(FORBIDDEN);
}

describe("core mutations — role gate + tenant pin", () => {
  beforeEach(() => {
    mockSelectRows.mockReset();
    mockInsertReturning.mockReset();
    mockUpdateReturning.mockReset();
    mockRequireTenantAdmin.mockReset();
    cognitoSendMock.mockReset();
    insertCallRef.value = 0;
  });

  describe("addTenantMember", () => {
    const args = {
      tenantId: "tenant-A",
      input: { principalType: "USER", principalId: "user-x", role: "member" },
    };

    it("calls requireTenantAdmin with the caller-supplied tenantId (tenant pin)", async () => {
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([{ id: "m1" }]);
      await addTenantMember(null, args, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller self-promoting into tenant A", async () => {
      mockAdminForbidden();
      await expect(
        addTenantMember(null, args, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });

  describe("inviteMember — the Cognito-user-creation gap", () => {
    const args = {
      tenantId: "tenant-A",
      input: { email: "x@y.com", name: "X", role: "admin" },
    };

    it("calls requireTenantAdmin BEFORE creating the Cognito user", async () => {
      mockAdminForbidden();
      await expect(
        inviteMember(null, args, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      // Cognito AdminCreateUser must not fire when authz refuses — otherwise
      // a member could spam-create Cognito users.
      expect(cognitoSendMock).not.toHaveBeenCalled();
      expect(insertCallRef.value).toBe(0);
    });

    it("refuses member-role caller attempting to self-promote via invite", async () => {
      mockAdminForbidden();
      await expect(
        inviteMember(null, args, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
    });

    it("gates with the arg-supplied tenantId (tenant pin)", async () => {
      mockAdminForbidden();
      await expect(
        inviteMember(null, args, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });
  });

  describe("updateTenant", () => {
    const args = { id: "tenant-A", input: { name: "Renamed" } };

    it("calls requireTenantAdmin with args.id as the tenantId", async () => {
      mockAdminAllowed();
      mockUpdateReturning.mockReturnValue([
        { id: "tenant-A", name: "Renamed" },
      ]);
      await updateTenant(null, args, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller (and admin-of-unrelated tenant)", async () => {
      mockAdminForbidden();
      await expect(
        updateTenant(null, args, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockUpdateReturning).not.toHaveBeenCalled();
    });
  });
});
