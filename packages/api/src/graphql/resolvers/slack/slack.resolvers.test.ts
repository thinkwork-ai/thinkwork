import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockGetSlackAppCredentials,
  mockDeleteSlackBotToken,
  mockSelectRows,
  mockUpdateReturning,
  updateCalls,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockGetSlackAppCredentials: vi.fn(),
  mockDeleteSlackBotToken: vi.fn(),
  mockSelectRows: vi.fn(),
  mockUpdateReturning: vi.fn(),
  updateCalls: [] as unknown[],
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSelectRows()),
        }),
        orderBy: () => Promise.resolve(mockSelectRows()),
      }),
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
    tenant_id: "slack_user_links.tenant_id",
    slack_team_id: "slack_user_links.slack_team_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
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

describe("Slack GraphQL resolvers", () => {
  beforeEach(() => {
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    mockGetSlackAppCredentials.mockReset();
    mockDeleteSlackBotToken.mockReset();
    mockSelectRows.mockReset();
    mockUpdateReturning.mockReset();
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
});
