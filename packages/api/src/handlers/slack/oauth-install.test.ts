import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createSlackInstallState } from "../../lib/slack/oauth-state.js";
import { handleSlackOAuthInstall } from "./oauth-install.js";

const CREDENTIALS = {
  signingSecret: "signing-secret",
  clientId: "client-1",
  clientSecret: "client-secret",
};

function event(query: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /slack/oauth/install",
    rawPath: "/slack/oauth/install",
    rawQueryString: query,
    headers: {},
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method: "GET",
        path: "/slack/oauth/install",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: "GET /slack/oauth/install",
      stage: "$default",
      time: "16/May/2026:00:00:00 +0000",
      timeEpoch: 1,
    },
    isBase64Encoded: false,
  };
}

function signedState(returnUrl = "https://admin.example.com/slack"): string {
  return createSlackInstallState({
    tenantId: "tenant-1",
    adminUserId: "admin-1",
    clientSecret: CREDENTIALS.clientSecret,
    returnUrl,
    nowMs: () => 1_000,
    nonce: "nonce-1",
  });
}

describe("Slack OAuth install handler", () => {
  it("exchanges a valid callback, stores the bot token, upserts the workspace, and redirects", async () => {
    const putBotToken = vi.fn().mockResolvedValue("secret");
    const upsertWorkspace = vi.fn().mockResolvedValue({});
    const state = signedState();

    const response = await handleSlackOAuthInstall(
      event(`code=code-1&state=${encodeURIComponent(state)}`),
      {
        getCredentials: async () => CREDENTIALS,
        redirectUri: "https://api.example.com/slack/oauth/install",
        nowMs: () => 2_000,
        findWorkspaceTenant: vi.fn().mockResolvedValue("tenant-1"),
        putBotToken,
        upsertWorkspace,
        exchangeCode: vi.fn().mockResolvedValue({
          ok: true,
          access_token: "xoxb-token",
          bot_user_id: "U-BOT",
          app_id: "A-APP",
          team: { id: "T-1", name: "Acme" },
        }),
      },
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toContain("slackInstall=success");
    expect(putBotToken).toHaveBeenCalledWith(
      "thinkwork/tenants/tenant-1/slack/workspaces/T-1/bot-token",
      "xoxb-token",
    );
    expect(upsertWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        slackTeamId: "T-1",
        slackTeamName: "Acme",
        botUserId: "U-BOT",
        appId: "A-APP",
      }),
    );
  });

  it("rejects a mismatched state before writing secrets or rows", async () => {
    const putBotToken = vi.fn();
    const upsertWorkspace = vi.fn();

    const response = await handleSlackOAuthInstall(
      event("code=code-1&state=bad"),
      {
        getCredentials: async () => CREDENTIALS,
        nowMs: () => 2_000,
        redirectUri: "https://api.example.com/slack/oauth/install",
        putBotToken,
        upsertWorkspace,
      },
    );

    expect(response.statusCode).toBe(400);
    expect(putBotToken).not.toHaveBeenCalled();
    expect(upsertWorkspace).not.toHaveBeenCalled();
  });

  it("does not persist anything when Slack returns an OAuth error", async () => {
    const putBotToken = vi.fn();
    const upsertWorkspace = vi.fn();
    const state = signedState();

    const response = await handleSlackOAuthInstall(
      event(`code=code-1&state=${encodeURIComponent(state)}`),
      {
        getCredentials: async () => CREDENTIALS,
        nowMs: () => 2_000,
        redirectUri: "https://api.example.com/slack/oauth/install",
        putBotToken,
        upsertWorkspace,
        exchangeCode: vi.fn().mockResolvedValue({
          ok: false,
          error: "invalid_code",
        }),
      },
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toContain("slackInstall=error");
    expect(response.headers?.Location).toContain("invalid_code");
    expect(putBotToken).not.toHaveBeenCalled();
    expect(upsertWorkspace).not.toHaveBeenCalled();
  });

  it("refuses to move an installed Slack team to another tenant", async () => {
    const putBotToken = vi.fn();
    const upsertWorkspace = vi.fn();
    const state = signedState();

    const response = await handleSlackOAuthInstall(
      event(`code=code-1&state=${encodeURIComponent(state)}`),
      {
        getCredentials: async () => CREDENTIALS,
        nowMs: () => 2_000,
        redirectUri: "https://api.example.com/slack/oauth/install",
        findWorkspaceTenant: vi.fn().mockResolvedValue("tenant-2"),
        putBotToken,
        upsertWorkspace,
        exchangeCode: vi.fn().mockResolvedValue({
          ok: true,
          access_token: "xoxb-token",
          bot_user_id: "U-BOT",
          app_id: "A-APP",
          team: { id: "T-1", name: "Acme" },
        }),
      },
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toContain("workspace_already_installed");
    expect(putBotToken).not.toHaveBeenCalled();
    expect(upsertWorkspace).not.toHaveBeenCalled();
  });
});
