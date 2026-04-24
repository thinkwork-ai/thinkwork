/**
 * Unit tests for `requireTenantMembership` — the REST auth helper that
 * closes the "shared-secret = any-tenant" gap on per-tenant endpoints.
 *
 * The cross-tenant rejection case (a cognito caller who is a member of
 * tenant A tries to operate on tenant B) is the security invariant this
 * PR is establishing. Every other branch exists to make sure that
 * invariant doesn't get undermined by a more permissive fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  mockAuthenticate,
  mockResolveCallerFromAuth,
  mockTenantRows,
  mockMemberRows,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockResolveCallerFromAuth: vi.fn(),
  mockTenantRows: vi.fn(),
  mockMemberRows: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mockAuthenticate,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mockResolveCallerFromAuth,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: vi.fn().mockImplementation(() => ({
      from: (table: { _tableName: string }) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              table._tableName === "tenants"
                ? (mockTenantRows() as unknown[])
                : (mockMemberRows() as unknown[]),
            ),
        }),
      }),
    })),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenants: { _tableName: "tenants", id: "tenants.id", slug: "tenants.slug" },
  tenantMembers: {
    _tableName: "tenant_members",
    tenant_id: "tenant_members.tenant_id",
    principal_id: "tenant_members.principal_id",
    principal_type: "tenant_members.principal_type",
    role: "tenant_members.role",
    status: "tenant_members.status",
  },
}));

// eslint-disable-next-line import/first
import { requireTenantMembership } from "../lib/tenant-membership.js";

function mkEvent(authHeader?: string): APIGatewayProxyEventV2 {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as APIGatewayProxyEventV2;
}

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_IN_A = "11111111-1111-1111-1111-111111111111";

describe("requireTenantMembership — cognito path", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockResolveCallerFromAuth.mockReset();
    mockTenantRows.mockReset();
    mockMemberRows.mockReset();
  });

  it("allows owner/admin on their own tenant", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: USER_IN_A,
      tenantId: TENANT_A,
    });
    mockMemberRows.mockReturnValue([{ role: "owner", status: "active" }]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_A,
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.tenantId).toBe(TENANT_A);
      expect(verdict.userId).toBe(USER_IN_A);
      expect(verdict.role).toBe("owner");
    }
  });

  it("rejects cognito caller requesting a tenant they are NOT a member of (the core cross-tenant test)", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    // Tenant B exists.
    mockTenantRows.mockReturnValue([{ id: TENANT_B }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: USER_IN_A,
      tenantId: TENANT_A,
    });
    // No membership row in tenant B.
    mockMemberRows.mockReturnValue([]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_B,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.status).toBe(403);
      expect(verdict.reason).toMatch(/not a member/i);
    }
  });

  it("rejects cognito caller whose membership exists but is inactive", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: USER_IN_A,
      tenantId: TENANT_A,
    });
    mockMemberRows.mockReturnValue([{ role: "owner", status: "suspended" }]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_A,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(403);
  });

  it("rejects cognito member when the route requires owner/admin (default)", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: USER_IN_A,
      tenantId: TENANT_A,
    });
    mockMemberRows.mockReturnValue([{ role: "member", status: "active" }]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_A,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.status).toBe(403);
      expect(verdict.reason).toMatch(/lacks privilege/i);
    }
  });

  it("allows cognito member when requiredRoles includes 'member' (read-only list)", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: USER_IN_A,
      tenantId: TENANT_A,
    });
    mockMemberRows.mockReturnValue([{ role: "member", status: "active" }]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_A,
      { requiredRoles: ["owner", "admin", "member"] },
    );
    expect(verdict.ok).toBe(true);
  });

  it("rejects cognito caller whose JWT sub has no users row", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-orphan",
      tenantId: null,
      email: null,
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    mockResolveCallerFromAuth.mockResolvedValue({
      userId: null,
      tenantId: null,
    });

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      TENANT_A,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(403);
  });
});

describe("requireTenantMembership — apikey path", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockResolveCallerFromAuth.mockReset();
    mockTenantRows.mockReset();
    mockMemberRows.mockReset();
  });

  it("bypasses membership check (platform-credential trust)", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: null,
      tenantId: null,
      email: null,
      authType: "apikey",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer tw-dev-secret"),
      TENANT_A,
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.tenantId).toBe(TENANT_A);
      expect(verdict.userId).toBeNull();
      expect(verdict.role).toBeNull();
    }
    // No membership query should have been issued for apikey callers.
    expect(mockMemberRows).not.toHaveBeenCalled();
  });

  it("accepts Bearer API_AUTH_SECRET without x-api-key (CLI back-compat)", async () => {
    // authenticate() returns null because the CLI's Authorization-
    // only request has no JWT and no x-api-key header. The fallback
    // in requireTenantMembership should recognize the bearer as the
    // shared service secret and treat it as apikey auth.
    mockAuthenticate.mockResolvedValue(null);
    mockTenantRows.mockReturnValue([{ id: TENANT_A }]);
    const prev = process.env.API_AUTH_SECRET;
    process.env.API_AUTH_SECRET = "tw-dev-secret";
    try {
      const verdict = await requireTenantMembership(
        mkEvent("Bearer tw-dev-secret"),
        TENANT_A,
      );
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.role).toBeNull();
    } finally {
      process.env.API_AUTH_SECRET = prev;
    }
  });

  it("rejects Bearer fallback when secret doesn't match", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const prev = process.env.API_AUTH_SECRET;
    process.env.API_AUTH_SECRET = "tw-dev-secret";
    try {
      const verdict = await requireTenantMembership(
        mkEvent("Bearer not-the-secret"),
        TENANT_A,
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.status).toBe(401);
    } finally {
      process.env.API_AUTH_SECRET = prev;
    }
  });
});

describe("requireTenantMembership — unauthenticated", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
  });

  it("returns 401 when authenticate() yields null", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const verdict = await requireTenantMembership(mkEvent(), TENANT_A);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(401);
  });
});

describe("requireTenantMembership — tenant resolution", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockTenantRows.mockReset();
  });

  it("returns 404 when the tenant slug/uuid doesn't exist", async () => {
    mockAuthenticate.mockResolvedValue({
      principalId: "sub-1",
      tenantId: TENANT_A,
      email: "eric@example.com",
      authType: "cognito",
      agentId: null,
    });
    mockTenantRows.mockReturnValue([]);

    const verdict = await requireTenantMembership(
      mkEvent("Bearer some-jwt"),
      "no-such-tenant",
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.status).toBe(404);
  });
});
