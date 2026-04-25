/**
 * Contract tests for agent-mutation authorization.
 *
 * Before this PR:
 *  - `setAgentSkills` and `setAgentCapabilities` had zero auth checks —
 *    any authenticated user could overwrite agent_skills.permissions
 *    (the jsonb column this plan relies on for per-agent allowlisting).
 *    This was the P0 flagged in document-review: a member could grant
 *    themselves arbitrary admin-skill allowlist entries.
 *  - `setAgentCapabilities` additionally deleted existing capabilities
 *    BEFORE even confirming the agent exists — a member could DoS any
 *    agent's capabilities by submitting an empty list.
 *  - `createAgent` accepted a caller-supplied `i.tenantId` without
 *    cross-checking the caller's role on that tenant.
 *
 * These tests lock in: every agent mutation calls `requireTenantAdmin`
 * against the authoritative tenantId, and destructive work does not run
 * when authz fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAgentRows,
  mockInsertReturning,
  mockSkillsRows,
  mockSkillsUpdateRows,
  mockRequireTenantAdmin,
  deleteCallRef,
} = vi.hoisted(() => ({
  mockAgentRows: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockSkillsRows: vi.fn(),
  mockSkillsUpdateRows: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  deleteCallRef: { value: 0 },
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mockAgentRows() as unknown[]),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        returning: () => Promise.resolve(mockInsertReturning() as unknown[]),
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    })),
    delete: vi.fn(() => {
      deleteCallRef.value++;
      return {
        where: () => Promise.resolve(),
      };
    }),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockSkillsUpdateRows() as unknown[]),
        }),
      }),
    })),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  inArray: (..._args: any[]) => ({ _in: _args }),
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
  },
  agentSkills: {
    agent_id: "agentSkills.agent_id",
    skill_id: "agentSkills.skill_id",
    tenant_id: "agentSkills.tenant_id",
  },
  agentCapabilities: {
    agent_id: "agentCapabilities.agent_id",
    tenant_id: "agentCapabilities.tenant_id",
  },
  users: { id: "users.id", email: "users.email" },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
  agentToCamel: (obj: Record<string, unknown>) => obj,
  generateSlug: () => "test-slug",
  invokeJobScheduleManager: vi.fn(),
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

// Unit 8b wired `resolveCallerUserId` + `runWithIdempotency` into
// createAgent. Stub the identity resolver to return null so the
// idempotency helper short-circuits to a plain fn() call —
// preserves the existing test's assertions about requireTenantAdmin.
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => null),
  resolveCallerTenantId: vi.fn(async () => null),
}));

// Stub workspace-map-generator so setAgentSkills' dynamic import doesn't hit disk
vi.mock("../lib/workspace-map-generator.js", () => ({
  regenerateWorkspaceMap: () => Promise.resolve(),
}));

// eslint-disable-next-line import/first
import { createAgent } from "../graphql/resolvers/agents/createAgent.mutation.js";
// eslint-disable-next-line import/first
import { setAgentSkills } from "../graphql/resolvers/agents/setAgentSkills.mutation.js";
// eslint-disable-next-line import/first
import { setAgentCapabilities } from "../graphql/resolvers/agents/setAgentCapabilities.mutation.js";

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

function apikeyCtx(agentId = "agent-1"): any {
  return {
    auth: {
      authType: "apikey",
      principalId: "user-1",
      agentId,
      tenantId: "tenant-A",
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

describe("agent mutations — role gate + tenant pin", () => {
  beforeEach(() => {
    mockAgentRows.mockReset();
    mockInsertReturning.mockReset();
    mockSkillsRows.mockReset();
    mockSkillsUpdateRows.mockReset();
    mockRequireTenantAdmin.mockReset();
    deleteCallRef.value = 0;
  });

  describe("createAgent", () => {
    const input = {
      tenantId: "tenant-A",
      name: "Agent",
      role: "assistant",
      type: "agent",
      systemPrompt: "hi",
      adapterType: "strands",
    };

    it("calls requireTenantAdmin with the caller-supplied i.tenantId (tenant pin)", async () => {
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([
        { id: "a1", tenant_id: "tenant-A", name: "Agent", slug: "test-slug" },
      ]);
      await createAgent(null, { input }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockAdminForbidden();
      await expect(
        createAgent(null, { input }, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });

  describe("setAgentSkills — the documented P0 gap", () => {
    const skillsInput = {
      agentId: "a1",
      skills: [
        {
          skillId: "thinkwork-admin",
          permissions: { operations: ["create_agent"] },
          rateLimitRpm: null,
          enabled: true,
        },
      ],
    };

    it("calls requireTenantAdmin with the agent's row-derived tenantId", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      await setAgentSkills(null, skillsInput, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller attempting to overwrite permissions (P0 defense)", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        setAgentSkills(null, skillsInput, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
    });

    it("refuses before touching agent_skills rows (no partial delete-on-authz-fail)", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        setAgentSkills(null, skillsInput, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(deleteCallRef.value).toBe(0);
    });

    // R16: an agent holding thinkwork-admin with `set_agent_skills` in its
    // allowlist must NOT be able to rewrite its own permissions.operations
    // (self-bootstrapping privilege escalation). Cross-agent provisioning
    // stays allowed — reconcilers and onboarding automations need it.
    describe("self-target rejection (R16)", () => {
      it("refuses apikey caller where ctx.auth.agentId === args.agentId", async () => {
        await expect(
          setAgentSkills(
            null,
            { ...skillsInput, agentId: "agent-self" },
            apikeyCtx("agent-self"),
          ),
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        // Self-target check must fire BEFORE any DB work.
        expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
        expect(deleteCallRef.value).toBe(0);
      });

      it("allows apikey caller where caller agent != target agent (cross-agent provisioning)", async () => {
        mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
        mockAdminAllowed();
        mockSkillsRows.mockReturnValue([]);
        mockSkillsUpdateRows.mockReturnValue([]);
        await setAgentSkills(
          null,
          { ...skillsInput, agentId: "agent-target" },
          apikeyCtx("agent-caller"),
        );
        // No self-target throw; normal flow proceeds.
        expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
          expect.anything(),
          "tenant-A",
        );
      });

      it("allows cognito callers unchanged (no agentId on principal)", async () => {
        mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
        mockAdminAllowed();
        mockSkillsRows.mockReturnValue([]);
        mockSkillsUpdateRows.mockReturnValue([]);
        await setAgentSkills(null, skillsInput, cognitoCtx());
        // Cognito callers never hit the self-target branch.
        expect(mockRequireTenantAdmin).toHaveBeenCalledTimes(1);
      });
    });

    // U11: derive-agent-skills.ts is the new canonical writer for
    // agent_skills set membership. setAgentSkills keeps working during
    // the U17–U21 transition (per-row metadata still needs a surface);
    // the deprecation log is the beacon for U21 to find last-callers.
    describe("U11 deprecation warning", () => {
      it("logs DEPRECATED on every successful call after admin gate passes", async () => {
        mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
        mockAdminAllowed();
        mockSkillsRows.mockReturnValue([]);
        mockSkillsUpdateRows.mockReturnValue([]);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          await setAgentSkills(null, skillsInput, cognitoCtx());
          const deprecationCalls = warnSpy.mock.calls.filter((args) =>
            String(args[0] ?? "").includes(
              "[setAgentSkills] DEPRECATED",
            ),
          );
          expect(deprecationCalls.length).toBe(1);
          expect(String(deprecationCalls[0][0])).toMatch(/agent=a1/);
          expect(String(deprecationCalls[0][0])).toMatch(
            /caller_authType=cognito/,
          );
        } finally {
          warnSpy.mockRestore();
        }
      });

      it("does NOT log DEPRECATED when the apikey self-target guard rejects (path returns before warn)", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          await expect(
            setAgentSkills(
              null,
              { ...skillsInput, agentId: "agent-self" },
              apikeyCtx("agent-self"),
            ),
          ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
          const deprecationCalls = warnSpy.mock.calls.filter((args) =>
            String(args[0] ?? "").includes(
              "[setAgentSkills] DEPRECATED",
            ),
          );
          expect(deprecationCalls.length).toBe(0);
        } finally {
          warnSpy.mockRestore();
        }
      });
    });
  });

  describe("setAgentCapabilities — the DoS-on-delete gap", () => {
    const capsInput = {
      agentId: "a1",
      capabilities: [{ capability: "email_channel", enabled: true }],
    };

    it("calls requireTenantAdmin with the agent's row-derived tenantId", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([{ id: "c1" }]);
      await setAgentCapabilities(null, capsInput, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller before any delete runs", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        setAgentCapabilities(null, capsInput, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(deleteCallRef.value).toBe(0);
    });

    it("refuses empty-capabilities DoS before running delete", async () => {
      mockAgentRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        setAgentCapabilities(
          null,
          { agentId: "a1", capabilities: [] },
          cognitoCtx(),
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(deleteCallRef.value).toBe(0);
    });
  });
});
