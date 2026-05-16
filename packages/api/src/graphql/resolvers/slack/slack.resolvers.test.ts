import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockRequireTenantMember,
  mockResolveCallerUserId,
  mockGetSlackAppCredentials,
  mockDeleteSlackBotToken,
  mockSelectRows,
  mockUpdateReturning,
  mockInsertValues,
  updateCalls,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockGetSlackAppCredentials: vi.fn(),
  mockDeleteSlackBotToken: vi.fn(),
  mockSelectRows: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockInsertValues: vi.fn(),
  updateCalls: [] as unknown[],
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(mockSelectRows()),
          }),
        }),
        where: () => ({
          limit: () => Promise.resolve(mockSelectRows()),
          orderBy: () => Promise.resolve(mockSelectRows()),
        }),
        orderBy: () => Promise.resolve(mockSelectRows()),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => Promise.resolve(mockInsertValues()),
    })),
    update: vi.fn((table: unknown) => {
      updateCalls.push(table);
      return {
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockUpdateReturning()),
          }),
        }),
      };
    }),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (...args: unknown[]) => ({ asc: args }),
  sql: (strings: TemplateStringsArray) => ({ sql: strings.join("") }),
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
        value,
      ]),
    ),
  slackWorkspaces: {
    id: "slack_workspaces.id",
    tenant_id: "slack_workspaces.tenant_id",
    slack_team_id: "slack_workspaces.slack_team_id",
    slack_team_name: "slack_workspaces.slack_team_name",
  },
  slackUserLinks: {
    id: "slack_user_links.id",
    tenant_id: "slack_user_links.tenant_id",
    slack_team_id: "slack_user_links.slack_team_id",
    slack_user_id: "slack_user_links.slack_user_id",
    slack_user_name: "slack_user_links.slack_user_name",
    slack_user_email: "slack_user_links.slack_user_email",
    user_id: "slack_user_links.user_id",
    status: "slack_user_links.status",
    linked_at: "slack_user_links.linked_at",
    unlinked_at: "slack_user_links.unlinked_at",
    created_at: "slack_user_links.created_at",
    updated_at: "slack_user_links.updated_at",
  },
  activityLog: {
    id: "activity_log.id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/slack/workspace-store.js", () => ({
  getSlackAppCredentials: mockGetSlackAppCredentials,
  deleteSlackBotToken: mockDeleteSlackBotToken,
}));

// eslint-disable-next-line import/first
import { startSlackWorkspaceInstall } from "./installSlackWorkspace.mutation.js";
// eslint-disable-next-line import/first
import { uninstallSlackWorkspace } from "./uninstallSlackWorkspace.mutation.js";
// eslint-disable-next-line import/first
import { mySlackLinks } from "./mySlackLinks.query.js";
// eslint-disable-next-line import/first
import { unlinkSlackIdentity } from "./unlinkSlackIdentity.mutation.js";

describe("Slack GraphQL resolvers", () => {
  beforeEach(() => {
    mockRequireTenantAdmin.mockReset();
    mockRequireTenantMember.mockReset();
    mockResolveCallerUserId.mockReset();
    mockGetSlackAppCredentials.mockReset();
    mockDeleteSlackBotToken.mockReset();
    mockSelectRows.mockReset();
    mockUpdateReturning.mockReset();
    mockInsertValues.mockReset();
    updateCalls.length = 0;
    process.env.THINKWORK_API_URL = "https://api.example.com";
  });

  it("checks tenant admin before loading app credentials for install start", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      startSlackWorkspaceInstall(null, { input: { tenantId: "tenant-1" } }, {
        auth: { authType: "cognito" },
      } as any),
    ).rejects.toThrow(/forbidden/);

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(mockGetSlackAppCredentials).not.toHaveBeenCalled();
  });

  it("returns a signed Slack authorize URL for tenant admins", async () => {
    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCallerUserId.mockResolvedValue("admin-1");
    mockGetSlackAppCredentials.mockResolvedValue({
      signingSecret: "signing-secret",
      clientId: "client-1",
      clientSecret: "client-secret",
    });

    const result = await startSlackWorkspaceInstall(
      null,
      {
        input: {
          tenantId: "tenant-1",
          returnUrl: "https://admin.example.com/slack",
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    const url = new URL(result.authorizeUrl);
    expect(url.hostname).toBe("slack.com");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("state")).toBe(result.state);
  });

  it("uninstalls the bot token and orphans user links after an admin gate", async () => {
    mockSelectRows.mockReturnValue([
      {
        id: "workspace-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        bot_token_secret_path:
          "thinkwork/tenants/tenant-1/slack/workspaces/T-1/bot-token",
        status: "active",
      },
    ]);
    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockUpdateReturning.mockReturnValue([
      {
        id: "workspace-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        slack_team_name: "Acme",
        bot_user_id: "U-BOT",
        bot_token_secret_path: "secret",
        app_id: "A-APP",
        installed_by_user_id: "admin-1",
        status: "uninstalled",
        installed_at: new Date("2026-05-16T00:00:00Z"),
        uninstalled_at: new Date("2026-05-16T01:00:00Z"),
        created_at: new Date("2026-05-16T00:00:00Z"),
        updated_at: new Date("2026-05-16T01:00:00Z"),
      },
    ]);

    const result = await uninstallSlackWorkspace(null, { id: "workspace-1" }, {
      auth: { authType: "cognito" },
    } as any);

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(mockDeleteSlackBotToken).toHaveBeenCalledWith(
      "thinkwork/tenants/tenant-1/slack/workspaces/T-1/bot-token",
    );
    expect(updateCalls).toHaveLength(2);
    expect(result).toMatchObject({ id: "workspace-1", status: "uninstalled" });
    expect(result).not.toHaveProperty("botTokenSecretPath");
  });

  it("lists only the caller's active Slack identity links", async () => {
    mockRequireTenantMember.mockResolvedValue("member");
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockSelectRows.mockReturnValue([
      {
        id: "link-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        slack_team_name: "Acme",
        slack_user_id: "U-1",
        slack_user_name: "eric",
        slack_user_email: "eric@example.com",
        user_id: "user-1",
        status: "active",
        linked_at: new Date("2026-05-16T00:00:00Z"),
        unlinked_at: null,
        created_at: new Date("2026-05-16T00:00:00Z"),
        updated_at: new Date("2026-05-16T00:00:00Z"),
      },
    ]);

    const result = await mySlackLinks(null, { tenantId: "tenant-1" }, {
      auth: { authType: "cognito" },
    } as any);

    expect(mockRequireTenantMember).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(result).toMatchObject([
      {
        id: "link-1",
        slackTeamId: "T-1",
        slackTeamName: "Acme",
        slackUserId: "U-1",
      },
    ]);
  });

  it("refuses to unlink another user's Slack identity", async () => {
    mockSelectRows.mockReturnValue([
      {
        id: "link-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        slack_user_id: "U-1",
        user_id: "user-2",
        status: "active",
      },
    ]);
    mockRequireTenantMember.mockResolvedValue("member");
    mockResolveCallerUserId.mockResolvedValue("user-1");

    await expect(
      unlinkSlackIdentity(null, { id: "link-1" }, {
        auth: { authType: "cognito" },
      } as any),
    ).rejects.toThrow(/another user's Slack identity/);

    expect(updateCalls).toHaveLength(0);
  });

  it("unlinks the caller's Slack identity and writes an audit event", async () => {
    mockSelectRows.mockReturnValue([
      {
        id: "link-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        slack_user_id: "U-1",
        user_id: "user-1",
        status: "active",
      },
    ]);
    mockRequireTenantMember.mockResolvedValue("member");
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockUpdateReturning.mockReturnValue([
      {
        id: "link-1",
        tenant_id: "tenant-1",
        slack_team_id: "T-1",
        slack_user_id: "U-1",
        user_id: "user-1",
        status: "unlinked",
        linked_at: new Date("2026-05-16T00:00:00Z"),
        unlinked_at: new Date("2026-05-16T01:00:00Z"),
        created_at: new Date("2026-05-16T00:00:00Z"),
        updated_at: new Date("2026-05-16T01:00:00Z"),
      },
    ]);

    const result = await unlinkSlackIdentity(null, { id: "link-1" }, {
      auth: { authType: "cognito" },
    } as any);

    expect(mockRequireTenantMember).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(updateCalls).toHaveLength(1);
    expect(mockInsertValues).toHaveBeenCalled();
    expect(result).toMatchObject({ id: "link-1", status: "unlinked" });
  });
});
