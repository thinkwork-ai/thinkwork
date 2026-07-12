import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MSTEAMS_INSTALL_STATE_TTL_MS,
  MSTEAMS_LINK_TOKEN_TTL_MS,
  createMsteamsAccountLinkToken,
  createMsteamsInstallState,
  getMsteamsAppCredentials,
  resetMsteamsAppCredentialsCacheForTests,
  verifyMsteamsAccountLinkToken,
  verifyMsteamsInstallState,
} from "./install-state.js";

const SIGNING_KEY = "teams-client-secret";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = sendMock;
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

describe("msteams install state", () => {
  it("round-trips a signed state and enforces the 10 minute TTL constant", () => {
    expect(MSTEAMS_INSTALL_STATE_TTL_MS).toBe(10 * 60 * 1000);
    const state = createMsteamsInstallState({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      signingKey: SIGNING_KEY,
      nowMs: () => 1_000,
      nonce: "nonce-1",
    });

    const payload = verifyMsteamsInstallState(state, SIGNING_KEY, () => 2_000);
    expect(payload).toEqual({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      nonce: "nonce-1",
      expiresAt: 1_000 + MSTEAMS_INSTALL_STATE_TTL_MS,
    });
  });

  it("rejects an expired state", () => {
    const state = createMsteamsInstallState({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      signingKey: SIGNING_KEY,
      nowMs: () => 1_000,
    });
    expect(() =>
      verifyMsteamsInstallState(
        state,
        SIGNING_KEY,
        () => 1_000 + MSTEAMS_INSTALL_STATE_TTL_MS + 1
      )
    ).toThrow(/expired/);
  });

  it("rejects a tampered payload", () => {
    const state = createMsteamsInstallState({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      signingKey: SIGNING_KEY,
      nowMs: () => 1_000,
    });
    const [, signature] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        tenantId: "tenant-evil",
        adminUserId: "admin-1",
        nonce: "n",
        expiresAt: Date.now() + 60_000,
      }),
      "utf8"
    ).toString("base64url");
    expect(() =>
      verifyMsteamsInstallState(`${forged}.${signature}`, SIGNING_KEY)
    ).toThrow(/signature is invalid/);
  });

  it("rejects a state signed with a different key", () => {
    const state = createMsteamsInstallState({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      signingKey: "other-key",
      nowMs: () => 1_000,
    });
    expect(() =>
      verifyMsteamsInstallState(state, SIGNING_KEY, () => 2_000)
    ).toThrow(/signature is invalid/);
  });

  it("rejects malformed states", () => {
    expect(() => verifyMsteamsInstallState("", SIGNING_KEY)).toThrow(
      /malformed/
    );
    expect(() => verifyMsteamsInstallState("abc", SIGNING_KEY)).toThrow(
      /malformed/
    );
    expect(() => verifyMsteamsInstallState("a.b.c", SIGNING_KEY)).toThrow(
      /malformed/
    );
  });

  it("rejects an incomplete payload even when the signature is valid", () => {
    const encoded = Buffer.from(
      JSON.stringify({ tenantId: "tenant-1" }),
      "utf8"
    ).toString("base64url");
    const signature = createHmac("sha256", SIGNING_KEY)
      .update(encoded)
      .digest("base64url");
    expect(() =>
      verifyMsteamsInstallState(`${encoded}.${signature}`, SIGNING_KEY)
    ).toThrow(/incomplete/);
  });
});

describe("msteams account-link token", () => {
  const input = {
    tenantId: "tenant-1",
    entraTenantId: "entra-1",
    aadObjectId: "aad-1",
    signingKey: SIGNING_KEY,
    nowMs: () => 1_000,
    nonce: "nonce-1",
  };

  it("round-trips a link token and enforces the 15 minute TTL constant", () => {
    expect(MSTEAMS_LINK_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    const token = createMsteamsAccountLinkToken(input);
    const payload = verifyMsteamsAccountLinkToken(token, SIGNING_KEY, {
      expectedEntraTenantId: "entra-1",
      expectedAadObjectId: "aad-1",
      nowMs: () => 2_000,
    });
    expect(payload).toEqual({
      tenantId: "tenant-1",
      entraTenantId: "entra-1",
      aadObjectId: "aad-1",
      nonce: "nonce-1",
      expiresAt: 1_000 + MSTEAMS_LINK_TOKEN_TTL_MS,
    });
  });

  it("rejects a token bound to a different Entra tenant", () => {
    const token = createMsteamsAccountLinkToken(input);
    expect(() =>
      verifyMsteamsAccountLinkToken(token, SIGNING_KEY, {
        expectedEntraTenantId: "entra-other",
        expectedAadObjectId: "aad-1",
        nowMs: () => 2_000,
      })
    ).toThrow(/different Entra tenant/);
  });

  it("rejects a token bound to a different AAD object id", () => {
    const token = createMsteamsAccountLinkToken(input);
    expect(() =>
      verifyMsteamsAccountLinkToken(token, SIGNING_KEY, {
        expectedEntraTenantId: "entra-1",
        expectedAadObjectId: "aad-other",
        nowMs: () => 2_000,
      })
    ).toThrow(/different Teams user/);
  });

  it("rejects an expired token", () => {
    const token = createMsteamsAccountLinkToken(input);
    expect(() =>
      verifyMsteamsAccountLinkToken(token, SIGNING_KEY, {
        nowMs: () => 1_000 + MSTEAMS_LINK_TOKEN_TTL_MS + 1,
      })
    ).toThrow(/expired/);
  });

  it("rejects a tampered token", () => {
    const token = createMsteamsAccountLinkToken(input);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        aadObjectId: "aad-evil",
        nonce: "n",
        expiresAt: Date.now() + 60_000,
      }),
      "utf8"
    ).toString("base64url");
    expect(() =>
      verifyMsteamsAccountLinkToken(`${forged}.${signature}`, SIGNING_KEY)
    ).toThrow(/signature is invalid/);
  });

  it("rejects malformed tokens", () => {
    expect(() => verifyMsteamsAccountLinkToken("", SIGNING_KEY)).toThrow(
      /malformed/
    );
    expect(() => verifyMsteamsAccountLinkToken("abc", SIGNING_KEY)).toThrow(
      /malformed/
    );
    expect(() => verifyMsteamsAccountLinkToken("a.b.c", SIGNING_KEY)).toThrow(
      /malformed/
    );
  });
});

describe("getMsteamsAppCredentials", () => {
  beforeEach(() => {
    resetMsteamsAppCredentialsCacheForTests();
    sendMock.mockReset();
    process.env.MSTEAMS_APP_CREDENTIALS_SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/test/msteams/app";
  });

  afterEach(() => {
    delete process.env.MSTEAMS_APP_CREDENTIALS_SECRET_ARN;
    resetMsteamsAppCredentialsCacheForTests();
  });

  it("loads and caches credentials from Secrets Manager", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({
        app_id: "app-1",
        client_secret: "secret-1",
      }),
    });

    const first = await getMsteamsAppCredentials();
    const second = await getMsteamsAppCredentials();
    expect(first).toEqual({ appId: "app-1", clientSecret: "secret-1" });
    expect(second).toBe(first);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("fails with a clear error when fields are missing", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ app_id: "app-1" }),
    });
    await expect(getMsteamsAppCredentials()).rejects.toThrow(/incomplete/);
  });

  it("fails when the secret is empty or not JSON", async () => {
    sendMock.mockResolvedValue({ SecretString: "" });
    await expect(getMsteamsAppCredentials()).rejects.toThrow(
      /empty SecretString/
    );

    resetMsteamsAppCredentialsCacheForTests();
    sendMock.mockResolvedValue({ SecretString: "not-json" });
    await expect(getMsteamsAppCredentials()).rejects.toThrow(/not valid JSON/);
  });

  it("never logs the client_secret", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      sendMock.mockResolvedValue({
        SecretString: JSON.stringify({
          app_id: "app-1",
          client_secret: "super-secret-value",
        }),
      });
      await getMsteamsAppCredentials();
      const logged = [logSpy, warnSpy, errorSpy]
        .flatMap((spy) => spy.mock.calls.flat())
        .map((value) => String(value))
        .join(" ");
      expect(logged).not.toContain("super-secret-value");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
