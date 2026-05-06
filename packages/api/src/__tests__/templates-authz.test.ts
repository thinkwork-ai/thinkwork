/**
 * Contract tests for agent-template-mutation authorization.
 *
 * Before this PR:
 *  - `createAgentTemplate` accepted a caller-supplied i.tenantId with no
 *    auth check — any authenticated user could stamp templates (including
 *    hostile system prompts) into any tenant.
 *  - `syncTemplateToAgent` overwrote an agent's skills / knowledge bases /
 *    MCP bindings / workspace files unauthenticated.
 *  - `syncTemplateToAllAgents` looped that mutation across every linked
 *    agent of a tenant — same gap, larger blast radius.
 *
 * `acceptTemplateUpdate` already carries `requireTenantAdmin` at line 184;
 * it's recorded in the PR audit table as "already gated; spot-verified."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectRows,
  mockInsertReturning,
  mockUpdateReturning,
  mockRequireTenantAdmin,
  mockRequireNotFromAdminSkill,
  insertCallRef,
  deleteCallRef,
  updateCallRef,
} = vi.hoisted(() => ({
  mockSelectRows: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockRequireNotFromAdminSkill: vi.fn(),
  insertCallRef: { value: 0 },
  deleteCallRef: { value: 0 },
  updateCallRef: { value: 0 },
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
    delete: vi.fn(() => {
      deleteCallRef.value++;
      return {
        where: () => Promise.resolve(),
      };
    }),
    update: vi.fn(() => {
      updateCallRef.value++;
      return {
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockUpdateReturning() as unknown[]),
          }),
        }),
      };
    }),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  sql: (strings: TemplateStringsArray) => ({ _sql: strings.join("") }),
  agentTemplates: {
    id: "agentTemplates.id",
    tenant_id: "agentTemplates.tenant_id",
    slug: "agentTemplates.slug",
  },
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    template_id: "agents.template_id",
  },
  agentSkills: { agent_id: "agentSkills.agent_id" },
  agentKnowledgeBases: { agent_id: "agentKnowledgeBases.agent_id" },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
  agentToCamel: (obj: Record<string, unknown>) => obj,
  templateToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentMcpServers: { agent_id: "agentMcpServers.agent_id" },
  agentTemplateMcpServers: {
    template_id: "agentTemplateMcpServers.template_id",
    mcp_server_id: "agentTemplateMcpServers.mcp_server_id",
    enabled: "agentTemplateMcpServers.enabled",
  },
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  requireNotFromAdminSkill: mockRequireNotFromAdminSkill,
}));

// Unit 8c wired runWithIdempotency into createAgentTemplate. Stub the
// identity resolver to null so the helper short-circuits and the
// existing requireTenantAdmin assertions remain valid.
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => null),
  resolveCallerTenantId: vi.fn(async () => null),
}));

vi.mock("../lib/workspace-copy.js", () => ({
  copyDefaultsToTemplate: () => Promise.resolve(),
  overlayTemplateWorkspace: () => Promise.resolve(),
}));

vi.mock("../lib/agent-snapshot.js", () => ({
  snapshotAgent: () => Promise.resolve(),
}));

vi.mock("../lib/workspace-map-generator.js", () => ({
  regenerateWorkspaceMap: () => Promise.resolve(),
}));

// eslint-disable-next-line import/first
import { createAgentTemplate } from "../graphql/resolvers/templates/createAgentTemplate.mutation.js";
// eslint-disable-next-line import/first
import { updateAgentTemplate } from "../graphql/resolvers/templates/updateAgentTemplate.mutation.js";
// eslint-disable-next-line import/first
import { syncTemplateToAgent } from "../graphql/resolvers/templates/syncTemplateToAgent.mutation.js";
// eslint-disable-next-line import/first
import { syncTemplateToAllAgents } from "../graphql/resolvers/templates/syncTemplateToAllAgents.mutation.js";

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

describe("agent-template mutations — role gate + tenant pin", () => {
  beforeEach(() => {
    mockSelectRows.mockReset();
    mockInsertReturning.mockReset();
    mockUpdateReturning.mockReset();
    mockRequireTenantAdmin.mockReset();
    mockRequireNotFromAdminSkill.mockReset();
    insertCallRef.value = 0;
    deleteCallRef.value = 0;
    updateCallRef.value = 0;
  });

  describe("createAgentTemplate", () => {
    const input = {
      tenantId: "tenant-A",
      name: "Tpl",
      slug: "tpl",
      description: "d",
      category: "c",
      model: "m",
    };

    it("calls requireTenantAdmin with the caller-supplied i.tenantId (tenant pin)", async () => {
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([
        { id: "tpl-1", tenant_id: "tenant-A" },
      ]);
      await createAgentTemplate(null, { input }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller before insert", async () => {
      mockAdminForbidden();
      await expect(
        createAgentTemplate(null, { input }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(insertCallRef.value).toBe(0);
    });
  });

  describe("updateAgentTemplate (R15)", () => {
    const input = { name: "Updated" };

    it("calls requireTenantAdmin with the template's row-derived tenantId", async () => {
      mockSelectRows.mockReturnValueOnce([
        { id: "tpl-1", tenant_id: "tenant-A" },
      ]);
      mockUpdateReturning.mockReturnValueOnce([
        { id: "tpl-1", tenant_id: "tenant-A", name: "Updated" },
      ]);
      mockAdminAllowed();
      await updateAgentTemplate(null, { id: "tpl-1", input }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller before UPDATE", async () => {
      mockSelectRows.mockReturnValueOnce([
        { id: "tpl-1", tenant_id: "tenant-A" },
      ]);
      mockAdminForbidden();
      await expect(
        updateAgentTemplate(null, { id: "tpl-1", input }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(updateCallRef.value).toBe(0);
    });

    it("refuses cross-tenant admin — derives tenantId from the target row, not the caller", async () => {
      // Caller is admin of tenant-B (ctx.auth.tenantId omitted / null per
      // Google-federated pattern). Target template lives in tenant-A. The
      // row-derived pin means requireTenantAdmin is called with "tenant-A",
      // and the test mock refuses (tenant-B != tenant-A).
      mockSelectRows.mockReturnValueOnce([
        { id: "tpl-1", tenant_id: "tenant-A" },
      ]);
      mockAdminForbidden();
      await expect(
        updateAgentTemplate(null, { id: "tpl-1", input }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
      expect(updateCallRef.value).toBe(0);
    });

    it("throws NOT_FOUND when the template id does not exist (no auth info leaked)", async () => {
      mockSelectRows.mockReturnValueOnce([]);
      await expect(
        updateAgentTemplate(null, { id: "tpl-missing", input }, cognitoCtx()),
      ).rejects.toThrow(/not found/i);
      expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
      expect(updateCallRef.value).toBe(0);
    });
  });

  describe("syncTemplateToAgent", () => {
    it("calls requireTenantAdmin with the template's row-derived tenantId", async () => {
      // 1st select: agentTemplate. 2nd: agent.
      mockSelectRows
        .mockReturnValueOnce([
          {
            id: "tpl-1",
            tenant_id: "tenant-A",
            slug: "tpl",
            config: {},
            skills: [],
            knowledge_base_ids: [],
          },
        ])
        .mockReturnValueOnce([
          {
            id: "a1",
            tenant_id: "tenant-A",
            template_id: "tpl-1",
            slug: "agent-1",
            role: "r",
          },
        ])
        .mockReturnValue([]);
      mockAdminAllowed();
      await syncTemplateToAgent(
        null,
        { templateId: "tpl-1", agentId: "a1" },
        cognitoCtx(),
      );
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller before any destructive write (snapshot/delete/update)", async () => {
      mockSelectRows
        .mockReturnValueOnce([
          {
            id: "tpl-1",
            tenant_id: "tenant-A",
            slug: "tpl",
            config: {},
            skills: [],
            knowledge_base_ids: [],
          },
        ])
        .mockReturnValueOnce([
          {
            id: "a1",
            tenant_id: "tenant-A",
            template_id: "tpl-1",
            slug: "agent-1",
            role: "r",
          },
        ]);
      mockAdminForbidden();
      await expect(
        syncTemplateToAgent(
          null,
          { templateId: "tpl-1", agentId: "a1" },
          cognitoCtx(),
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(deleteCallRef.value).toBe(0);
      expect(updateCallRef.value).toBe(0);
      expect(insertCallRef.value).toBe(0);
    });
  });

  describe("syncTemplateToAllAgents", () => {
    it("calls requireTenantAdmin once at the top with the template's tenantId", async () => {
      // First select: template row. Second: linked agents list (empty — loop short-circuits).
      mockSelectRows
        .mockReturnValueOnce([{ id: "tpl-1", tenant_id: "tenant-A" }])
        .mockReturnValueOnce([]);
      mockAdminAllowed();
      await syncTemplateToAllAgents(
        null,
        { templateId: "tpl-1" },
        cognitoCtx(),
      );
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
      // Exactly once — not per linked agent. Prevents N retries for
      // cross-tenant callers where the first call has already failed.
      expect(mockRequireTenantAdmin).toHaveBeenCalledTimes(1);
    });

    it("refuses member-role caller before any per-agent sync runs", async () => {
      mockSelectRows
        .mockReturnValueOnce([{ id: "tpl-1", tenant_id: "tenant-A" }])
        .mockReturnValue([]);
      mockAdminForbidden();
      await expect(
        syncTemplateToAllAgents(null, { templateId: "tpl-1" }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    });

    // R17: catastrophic-tier gate blocks apikey callers even before
    // requireTenantAdmin runs. Prevents an agent holding thinkwork-admin
    // with `sync_template_to_all_agents` in its allowlist from fan-out
    // propagating permissions to every agent in one shot.
    describe("catastrophic-tier gate (R17)", () => {
      const CATASTROPHIC_FORBIDDEN = Object.assign(
        new Error(
          "Catastrophic operations are restricted to Cognito-authenticated callers",
        ),
        { extensions: { code: "FORBIDDEN" } },
      );

      it("refuses apikey callers via requireNotFromAdminSkill", async () => {
        mockRequireNotFromAdminSkill.mockImplementation(() => {
          throw CATASTROPHIC_FORBIDDEN;
        });
        await expect(
          syncTemplateToAllAgents(
            null,
            { templateId: "tpl-1" },
            apikeyCtx("agent-1"),
          ),
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        // Gate fires BEFORE the template lookup / requireTenantAdmin.
        expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
      });

      it("allows cognito tenant admins — requireNotFromAdminSkill is a no-op for cognito", async () => {
        mockRequireNotFromAdminSkill.mockImplementation(() => undefined);
        mockSelectRows
          .mockReturnValueOnce([{ id: "tpl-1", tenant_id: "tenant-A" }])
          .mockReturnValueOnce([]);
        mockAdminAllowed();
        await syncTemplateToAllAgents(
          null,
          { templateId: "tpl-1" },
          cognitoCtx(),
        );
        expect(mockRequireNotFromAdminSkill).toHaveBeenCalledTimes(1);
        expect(mockRequireTenantAdmin).toHaveBeenCalledTimes(1);
      });
    });
  });
});
