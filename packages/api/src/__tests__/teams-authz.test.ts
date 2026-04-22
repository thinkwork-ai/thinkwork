/**
 * Contract tests for team-mutation authorization.
 *
 * Before this PR: the team resolvers (createTeam, updateTeam, deleteTeam,
 * addTeamAgent, addTeamUser, removeTeamAgent, removeTeamUser) had zero
 * auth checks — any authenticated caller, including a plain member of an
 * unrelated tenant, could create/modify/archive arbitrary teams given the
 * target IDs.
 *
 * These tests lock in the new invariant: every team mutation calls
 * `requireTenantAdmin` with the authoritative tenantId (row-derived where
 * possible; caller-supplied arg otherwise). The mocked helper is asserted
 * with the exact tenantId argument so cross-tenant / tenant-pin regressions
 * are caught.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockTeamRows,
  mockInsertReturning,
  mockUpdateReturning,
  mockDeleteReturning,
  mockRequireTenantAdmin,
} = vi.hoisted(() => ({
  mockTeamRows: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mockTeamRows() as unknown[]),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        returning: () => Promise.resolve(mockInsertReturning() as unknown[]),
      }),
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateReturning() as unknown[]),
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: () => ({
        returning: () => Promise.resolve(mockDeleteReturning() as unknown[]),
      }),
    })),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  teams: {
    id: "teams.id",
    tenant_id: "teams.tenant_id",
  },
  teamAgents: {
    id: "teamAgents.id",
    team_id: "teamAgents.team_id",
    agent_id: "teamAgents.agent_id",
    tenant_id: "teamAgents.tenant_id",
  },
  teamUsers: {
    id: "teamUsers.id",
    team_id: "teamUsers.team_id",
    user_id: "teamUsers.user_id",
    tenant_id: "teamUsers.tenant_id",
  },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
  generateSlug: () => "test-slug",
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

// eslint-disable-next-line import/first
import { createTeam } from "../graphql/resolvers/teams/createTeam.mutation.js";
// eslint-disable-next-line import/first
import { updateTeam } from "../graphql/resolvers/teams/updateTeam.mutation.js";
// eslint-disable-next-line import/first
import { deleteTeam } from "../graphql/resolvers/teams/deleteTeam.mutation.js";
// eslint-disable-next-line import/first
import { addTeamAgent } from "../graphql/resolvers/teams/addTeamAgent.mutation.js";
// eslint-disable-next-line import/first
import { addTeamUser } from "../graphql/resolvers/teams/addTeamUser.mutation.js";
// eslint-disable-next-line import/first
import { removeTeamAgent } from "../graphql/resolvers/teams/removeTeamAgent.mutation.js";
// eslint-disable-next-line import/first
import { removeTeamUser } from "../graphql/resolvers/teams/removeTeamUser.mutation.js";

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

describe("team mutations — role gate + tenant pin", () => {
  beforeEach(() => {
    mockTeamRows.mockReset();
    mockInsertReturning.mockReset();
    mockUpdateReturning.mockReset();
    mockDeleteReturning.mockReset();
    mockRequireTenantAdmin.mockReset();
  });

  describe("createTeam", () => {
    const input = { tenantId: "tenant-A", name: "Team", description: null };

    it("calls requireTenantAdmin with the caller-supplied tenantId (tenant pin)", async () => {
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([
        { id: "t1", tenant_id: "tenant-A", name: "Team" },
      ]);
      await createTeam(null, { input }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses when requireTenantAdmin rejects (member caller / cross-tenant)", async () => {
      mockAdminForbidden();
      await expect(
        createTeam(null, { input }, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
    });

    it("does not insert when authz fails", async () => {
      mockAdminForbidden();
      await expect(
        createTeam(null, { input }, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });

  describe("updateTeam", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockUpdateReturning.mockReturnValue([
        { id: "t1", tenant_id: "tenant-A", name: "x" },
      ]);
      await updateTeam(null, { id: "t1", input: { name: "x" } }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        updateTeam(null, { id: "t1", input: { name: "x" } }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockUpdateReturning).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when the team does not exist (without leaking authz)", async () => {
      mockTeamRows.mockReturnValue([]);
      await expect(
        updateTeam(null, { id: "missing", input: { name: "x" } }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
      expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    });
  });

  describe("deleteTeam", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockUpdateReturning.mockReturnValue([
        { id: "t1", tenant_id: "tenant-A" },
      ]);
      await deleteTeam(null, { id: "t1" }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller (the live archive-by-member bug)", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        deleteTeam(null, { id: "t1" }, cognitoCtx()),
      ).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN" },
      });
      expect(mockUpdateReturning).not.toHaveBeenCalled();
    });

    it("returns false when the team does not exist (without calling authz)", async () => {
      mockTeamRows.mockReturnValue([]);
      const result = await deleteTeam(null, { id: "missing" }, cognitoCtx());
      expect(result).toBe(false);
      expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    });
  });

  describe("addTeamAgent", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([{ id: "ta1" }]);
      await addTeamAgent(
        null,
        { teamId: "t1", input: { agentId: "a1", role: "member" } },
        cognitoCtx(),
      );
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        addTeamAgent(
          null,
          { teamId: "t1", input: { agentId: "a1" } },
          cognitoCtx(),
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });

  describe("addTeamUser", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockInsertReturning.mockReturnValue([{ id: "tu1" }]);
      await addTeamUser(
        null,
        { teamId: "t1", input: { userId: "u1", role: "member" } },
        cognitoCtx(),
      );
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        addTeamUser(
          null,
          { teamId: "t1", input: { userId: "u1" } },
          cognitoCtx(),
        ),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockInsertReturning).not.toHaveBeenCalled();
    });
  });

  describe("removeTeamAgent", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockDeleteReturning.mockReturnValue([{ id: "ta1" }]);
      await removeTeamAgent(
        null,
        { teamId: "t1", agentId: "a1" },
        cognitoCtx(),
      );
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        removeTeamAgent(null, { teamId: "t1", agentId: "a1" }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockDeleteReturning).not.toHaveBeenCalled();
    });

    it("returns false when the team does not exist (without calling authz)", async () => {
      mockTeamRows.mockReturnValue([]);
      const result = await removeTeamAgent(
        null,
        { teamId: "missing", agentId: "a1" },
        cognitoCtx(),
      );
      expect(result).toBe(false);
      expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    });
  });

  describe("removeTeamUser", () => {
    it("calls requireTenantAdmin with the team's row-derived tenantId", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminAllowed();
      mockDeleteReturning.mockReturnValue([{ id: "tu1" }]);
      await removeTeamUser(null, { teamId: "t1", userId: "u1" }, cognitoCtx());
      expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-A",
      );
    });

    it("refuses member-role caller", async () => {
      mockTeamRows.mockReturnValue([{ tenant_id: "tenant-A" }]);
      mockAdminForbidden();
      await expect(
        removeTeamUser(null, { teamId: "t1", userId: "u1" }, cognitoCtx()),
      ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
      expect(mockDeleteReturning).not.toHaveBeenCalled();
    });

    it("returns false when the team does not exist (without calling authz)", async () => {
      mockTeamRows.mockReturnValue([]);
      const result = await removeTeamUser(
        null,
        { teamId: "missing", userId: "u1" },
        cognitoCtx(),
      );
      expect(result).toBe(false);
      expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    });
  });
});
