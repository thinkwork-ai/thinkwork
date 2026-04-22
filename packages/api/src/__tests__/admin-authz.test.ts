/**
 * Contract tests for the admin-skill authz primitives.
 *
 * Three layers of defense against the shared-service-secret
 * impersonation gap flagged by document review:
 *
 *  1. `requireAdminOrApiKeyCaller` — delegates cognito callers to the
 *     existing `requireTenantAdmin`; for apikey callers it independently
 *     verifies the invoker has owner/admin on the target tenant.
 *  2. `requireAgentAllowsOperation` — only meaningful for apikey
 *     callers. Looks up `(agent_id, skill_id='thinkwork-admin')` in
 *     `agent_skills` and refuses unless the operation name is explicitly
 *     listed in `permissions.operations`. This is the defense against a
 *     rogue skill (e.g., google-email) holding the shared service secret
 *     and claiming `x-principal-id=admin-uuid`: that skill's agent does
 *     not have `thinkwork-admin` assigned, so this check refuses.
 *  3. `adminRoleCheck` query — scoped to the caller's own tenant; no
 *     args, so it can't be used as an enumeration oracle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAgentSkillsRows,
  mockMemberRows,
  mockResolveCallerUserId,
  mockResolveCallerTenantId,
} = vi.hoisted(() => ({
  mockAgentSkillsRows: vi.fn(),
  mockMemberRows: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
}));

// Route DB lookups through hoisted mocks keyed by which table the
// resolver asks for. Each select() returns a chain that resolves to the
// corresponding mock's return value. authz.ts selects from
// `tenantMembers` (for the role gate) and `agentSkills` (for the
// allowlist), distinguishable by the schema-symbol identity.
vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    db: {
      select: vi.fn((_projection?: unknown) => ({
        from: (table: unknown) => ({
          where: () => {
            // Identity-check against the mocked schema tables.
            if (table === (actual as any).agentSkills) {
              return Promise.resolve(mockAgentSkillsRows() as unknown[]);
            }
            return Promise.resolve(mockMemberRows() as unknown[]);
          },
        }),
      })),
    },
  };
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

// eslint-disable-next-line import/first
import {
  requireAdminOrApiKeyCaller,
  requireAgentAllowsOperation,
} from "../graphql/resolvers/core/authz.js";
// eslint-disable-next-line import/first
import { adminRoleCheck } from "../graphql/resolvers/core/adminRoleCheck.query.js";

function cognitoCtx(principalId = "admin-1"): any {
  return {
    auth: {
      authType: "cognito",
      principalId,
      tenantId: null,
      email: "caller@example.com",
      agentId: null,
    },
  };
}

function apikeyCtx(
  overrides: {
    principalId?: string | null;
    tenantId?: string | null;
    agentId?: string | null;
  } = {},
): any {
  // Use explicit `in` checks so callers can pass `null` to clear a field.
  // `??` would coerce `null` back to the default and mask "no header" tests.
  return {
    auth: {
      authType: "apikey",
      principalId:
        "principalId" in overrides ? overrides.principalId : "admin-1",
      tenantId: "tenantId" in overrides ? overrides.tenantId : "tenant-A",
      agentId: "agentId" in overrides ? overrides.agentId : "agent-1",
      email: null,
    },
  };
}

const FORBIDDEN = (msg: string) =>
  Object.assign(new Error(msg), { extensions: { code: "FORBIDDEN" } });

describe("requireAgentAllowsOperation — per-agent allowlist verifier", () => {
  beforeEach(() => {
    mockAgentSkillsRows.mockReset();
    mockMemberRows.mockReset();
  });

  it("succeeds when agent_skills row has the op in permissions.operations", async () => {
    mockAgentSkillsRows.mockReturnValue([
      {
        enabled: true,
        permissions: { operations: ["create_agent", "create_team"] },
      },
    ]);
    await expect(
      requireAgentAllowsOperation(apikeyCtx(), "create_agent"),
    ).resolves.toBeUndefined();
  });

  it("refuses when the agent has no thinkwork-admin row assigned (P0 rogue-skill defense)", async () => {
    mockAgentSkillsRows.mockReturnValue([]);
    await expect(
      requireAgentAllowsOperation(apikeyCtx(), "create_agent"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("refuses when the agent_skills row is disabled", async () => {
    mockAgentSkillsRows.mockReturnValue([
      {
        enabled: false,
        permissions: { operations: ["create_agent"] },
      },
    ]);
    await expect(
      requireAgentAllowsOperation(apikeyCtx(), "create_agent"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("refuses when the op is not in permissions.operations (opt-in gap)", async () => {
    mockAgentSkillsRows.mockReturnValue([
      {
        enabled: true,
        permissions: { operations: ["create_agent"] },
      },
    ]);
    await expect(
      requireAgentAllowsOperation(apikeyCtx(), "remove_tenant_member"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("refuses when permissions.operations is absent or malformed", async () => {
    mockAgentSkillsRows.mockReturnValue([{ enabled: true, permissions: null }]);
    await expect(
      requireAgentAllowsOperation(apikeyCtx(), "create_agent"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("refuses when ctx.auth.agentId is null (R15 — agent header required)", async () => {
    await expect(
      requireAgentAllowsOperation(apikeyCtx({ agentId: null }), "create_agent"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});

describe("requireAdminOrApiKeyCaller — invoker role + agent allowlist", () => {
  beforeEach(() => {
    mockAgentSkillsRows.mockReset();
    mockMemberRows.mockReset();
    mockResolveCallerUserId.mockReset();
    mockResolveCallerTenantId.mockReset();
  });

  describe("cognito callers", () => {
    it("delegates to the same tenant_members role lookup requireTenantAdmin uses and does NOT check per-agent allowlist", async () => {
      // Cognito branch calls requireTenantAdmin internally, which
      // resolves the caller user id then looks up tenant_members.
      mockResolveCallerUserId.mockResolvedValue("admin-1");
      mockMemberRows.mockReturnValue([{ role: "admin" }]);
      await expect(
        requireAdminOrApiKeyCaller(cognitoCtx(), "tenant-A", "create_agent"),
      ).resolves.toBeUndefined();
      // Per-agent allowlist is the apikey defense; cognito callers
      // (admin SPA / CLI) never hit it.
      expect(mockAgentSkillsRows).not.toHaveBeenCalled();
    });

    it("propagates FORBIDDEN when the caller is not an admin on the tenant", async () => {
      mockResolveCallerUserId.mockResolvedValue("user-1");
      mockMemberRows.mockReturnValue([{ role: "member" }]);
      await expect(
        requireAdminOrApiKeyCaller(cognitoCtx(), "tenant-A", "create_agent"),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockAgentSkillsRows).not.toHaveBeenCalled();
    });
  });

  describe("apikey callers — the service-secret defense", () => {
    it("succeeds when invoker is admin AND agent has op allowlisted", async () => {
      mockMemberRows.mockReturnValue([{ role: "admin" }]);
      mockAgentSkillsRows.mockReturnValue([
        {
          enabled: true,
          permissions: { operations: ["create_agent"] },
        },
      ]);
      await expect(
        requireAdminOrApiKeyCaller(apikeyCtx(), "tenant-A", "create_agent"),
      ).resolves.toBeUndefined();
    });

    it("refuses when x-principal-id is missing (R15 no-invoker)", async () => {
      await expect(
        requireAdminOrApiKeyCaller(
          apikeyCtx({ principalId: null }),
          "tenant-A",
          "create_agent",
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    it("refuses when the caller is a plain member on the target tenant", async () => {
      mockMemberRows.mockReturnValue([{ role: "member" }]);
      await expect(
        requireAdminOrApiKeyCaller(apikeyCtx(), "tenant-A", "create_agent"),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    it("refuses cross-tenant apikey caller (admin-of-B against tenant A)", async () => {
      // admin of tenant B passes tenantId=A; tenant_members lookup
      // on (principal_id, tenant_id=A) returns nothing → refused.
      mockMemberRows.mockReturnValue([]);
      await expect(
        requireAdminOrApiKeyCaller(apikeyCtx(), "tenant-A", "create_agent"),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    it("refuses when invoker is admin but the agent lacks thinkwork-admin (P0 rogue-skill)", async () => {
      // tenant_members lookup passes; agent_skills lookup empty.
      mockMemberRows.mockReturnValue([{ role: "admin" }]);
      mockAgentSkillsRows.mockReturnValue([]);
      await expect(
        requireAdminOrApiKeyCaller(apikeyCtx(), "tenant-A", "create_agent"),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    it("refuses when invoker is admin and thinkwork-admin IS assigned, but the op is not in the allowlist (P0 opt-in)", async () => {
      mockMemberRows.mockReturnValue([{ role: "admin" }]);
      mockAgentSkillsRows.mockReturnValue([
        {
          enabled: true,
          permissions: { operations: ["create_agent"] },
        },
      ]);
      await expect(
        requireAdminOrApiKeyCaller(
          apikeyCtx(),
          "tenant-A",
          "remove_tenant_member",
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    it("refuses when x-agent-id is missing (every admin-skill call must assert agent identity)", async () => {
      mockMemberRows.mockReturnValue([{ role: "admin" }]);
      await expect(
        requireAdminOrApiKeyCaller(
          apikeyCtx({ agentId: null }),
          "tenant-A",
          "create_agent",
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });
  });

  it("refuses unknown authType loudly", async () => {
    await expect(
      requireAdminOrApiKeyCaller(
        { auth: { authType: "anonymous" as any } } as any,
        "tenant-A",
        "create_agent",
      ),
    ).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } });
  });
});

describe("adminRoleCheck — scoped caller-own query", () => {
  beforeEach(() => {
    mockAgentSkillsRows.mockReset();
    mockMemberRows.mockReset();
    mockResolveCallerUserId.mockReset();
    mockResolveCallerTenantId.mockReset();
  });

  it("returns caller's role for a cognito admin on their own tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("admin-1");
    mockResolveCallerTenantId.mockResolvedValue("tenant-A");
    mockMemberRows.mockReturnValue([{ role: "admin" }]);
    const result = await adminRoleCheck(null, {}, cognitoCtx());
    expect(result).toEqual({ role: "admin" });
  });

  it("returns 'other' when caller has no membership on their own tenant", async () => {
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockResolveCallerTenantId.mockResolvedValue("tenant-A");
    mockMemberRows.mockReturnValue([]);
    const result = await adminRoleCheck(null, {}, cognitoCtx());
    expect(result).toEqual({ role: "other" });
  });

  it("returns the role for an apikey admin on their own tenant", async () => {
    // apikey path resolves user/tenant from ctx.auth directly.
    mockMemberRows.mockReturnValue([{ role: "owner" }]);
    const result = await adminRoleCheck(null, {}, apikeyCtx());
    expect(result).toEqual({ role: "owner" });
  });

  it("throws loudly when apikey caller has no x-principal-id (misconfiguration, not 'other')", async () => {
    await expect(
      adminRoleCheck(null, {}, apikeyCtx({ principalId: null })),
    ).rejects.toThrow();
  });

  it("throws loudly when apikey caller has no x-tenant-id (misconfiguration, not 'other')", async () => {
    await expect(
      adminRoleCheck(null, {}, apikeyCtx({ tenantId: null })),
    ).rejects.toThrow();
  });
});
