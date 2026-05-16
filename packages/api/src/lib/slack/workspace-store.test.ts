import { describe, expect, it, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({
    send: sendMock,
  })),
  CreateSecretCommand: vi.fn().mockImplementation((input) => ({
    kind: "CreateSecretCommand",
    input,
  })),
  DeleteSecretCommand: vi.fn().mockImplementation((input) => ({
    kind: "DeleteSecretCommand",
    input,
  })),
  GetSecretValueCommand: vi.fn().mockImplementation((input) => input),
  UpdateSecretCommand: vi.fn().mockImplementation((input) => ({
    kind: "UpdateSecretCommand",
    input,
  })),
}));

const {
  __resetSlackWorkspaceStoreCacheForTest,
  getSlackAppCredentials,
  getSlackBotToken,
  putSlackBotToken,
  deleteSlackBotToken,
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

describe("putSlackBotToken and deleteSlackBotToken", () => {
  it("creates a bot token secret and warms the read cache", async () => {
    sendMock.mockResolvedValueOnce({ ARN: "arn:secret" });

    await expect(putSlackBotToken("path-create", "xoxb-new")).resolves.toBe(
      "arn:secret",
    );
    await expect(getSlackBotToken("path-create")).resolves.toBe("xoxb-new");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]).toMatchObject({
      kind: "CreateSecretCommand",
      input: {
        Name: "path-create",
        SecretString: JSON.stringify({ bot_token: "xoxb-new" }),
      },
    });
  });

  it("updates an existing bot token secret when create reports a duplicate", async () => {
    sendMock
      .mockRejectedValueOnce({ name: "ResourceExistsException" })
      .mockResolvedValueOnce({});

    await expect(
      putSlackBotToken("path-existing", "xoxb-updated"),
    ).resolves.toBe("path-existing");

    expect(sendMock.mock.calls[1]?.[0]).toMatchObject({
      kind: "UpdateSecretCommand",
      input: {
        SecretId: "path-existing",
        SecretString: JSON.stringify({ bot_token: "xoxb-updated" }),
      },
    });
  });

  it("schedules bot token deletion and clears the read cache", async () => {
    sendMock
      .mockResolvedValueOnce({ ARN: "arn:secret" })
      .mockResolvedValueOnce({});

    await putSlackBotToken("path-delete", "xoxb-delete");
    await deleteSlackBotToken("path-delete");

    expect(sendMock.mock.calls[1]?.[0]).toMatchObject({
      kind: "DeleteSecretCommand",
      input: {
        SecretId: "path-delete",
        RecoveryWindowInDays: 7,
      },
    });
  });
});
