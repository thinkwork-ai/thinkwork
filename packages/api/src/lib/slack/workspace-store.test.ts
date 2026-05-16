import { describe, expect, it, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  GetSecretValueCommand: vi.fn().mockImplementation((input) => input),
}));

const {
  __resetSlackWorkspaceStoreCacheForTest,
  getSlackAppCredentials,
  getSlackBotToken,
  slackBotTokenSecretPath,
} = await import("./workspace-store.js");

beforeEach(() => {
  vi.clearAllMocks();
  __resetSlackWorkspaceStoreCacheForTest();
  process.env.SLACK_APP_CREDENTIALS_SECRET_ARN = "slack-app-secret-arn";
});

describe("slackBotTokenSecretPath", () => {
  it("matches the tenant-scoped Slack bot token convention", () => {
    expect(slackBotTokenSecretPath("tenant-1", "T123")).toBe(
      "thinkwork/tenants/tenant-1/slack/workspaces/T123/bot-token",
    );
  });
});

describe("getSlackAppCredentials", () => {
  it("loads and caches Slack app credentials from Secrets Manager", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        signing_secret: "sign",
        client_id: "cid",
        client_secret: "csecret",
      }),
    });

    await expect(getSlackAppCredentials()).resolves.toEqual({
      signingSecret: "sign",
      clientId: "cid",
      clientSecret: "csecret",
    });
    await expect(getSlackAppCredentials()).resolves.toEqual({
      signingSecret: "sign",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete app credentials", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        signing_secret: "sign",
        client_id: "cid",
      }),
    });

    await expect(getSlackAppCredentials()).rejects.toThrow(
      "Slack app credentials incomplete",
    );
  });
});

describe("getSlackBotToken", () => {
  it("loads raw bot tokens and caches by secret path", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: "xoxb-raw" });

    await expect(getSlackBotToken("path-1")).resolves.toBe("xoxb-raw");
    await expect(getSlackBotToken("path-1")).resolves.toBe("xoxb-raw");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("loads JSON bot_token values", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ bot_token: "xoxb-json" }),
    });

    await expect(getSlackBotToken("path-json")).resolves.toBe("xoxb-json");
  });
});
