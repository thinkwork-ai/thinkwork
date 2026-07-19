import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";

const { mockSetAuthToken, mockOpenAuthSessionAsync, mockDismissAuthSession } =
  vi.hoisted(() => ({
    mockSetAuthToken: vi.fn(),
    mockOpenAuthSessionAsync: vi.fn(async () => ({ type: "success" })),
    mockDismissAuthSession: vi.fn(),
  }));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  let counter = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("base64"),
  };
});

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  setItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: mockOpenAuthSessionAsync,
  dismissAuthSession: mockDismissAuthSession,
}));

vi.mock("./graphql/client", () => ({
  setAuthToken: mockSetAuthToken,
}));

import {
  createOAuthAuthorizeRequest,
  getCurrentUser,
  getStoredOAuthIdToken,
  getStoredOAuthRefreshToken,
  hasStoredSession,
  refreshOAuthTokens,
  signOut,
  storeOAuthTokens,
  validateOAuthTokens,
} from "./auth";
import { CognitoSecureStorage } from "./cognito-storage";
import {
  addOrUpdateEnvironment,
  getActiveEnvironmentEntry,
  resetEnvironmentStoreForTests,
  setEnvironmentStoreStorageForTests,
} from "./environments/store";
import {
  removeEnvironmentWithSessionCleanup,
  switchActiveEnvironment,
} from "./environments/switch";
import {
  resetDeploymentProfileForTests,
  setDeploymentProfileStorageForTests,
} from "./deployment-profile";
import type { EnvironmentRuntimeConfig } from "./environments/runtime-config-fetch";

describe("mobile auth environment storage", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    storage = new Map<string, string>();
    mockSetAuthToken.mockReset();
    mockOpenAuthSessionAsync.mockClear();
    mockDismissAuthSession.mockReset();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
    resetDeploymentProfileForTests();
    resetEnvironmentStoreForTests();
    CognitoSecureStorage.clear();
    const adapter = {
      async getItem(key: string) {
        return storage.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        storage.set(key, value);
      },
      async removeItem(key: string) {
        storage.delete(key);
      },
    };
    setDeploymentProfileStorageForTests(adapter);
    setEnvironmentStoreStorageForTests(adapter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    CognitoSecureStorage.clear();
    resetDeploymentProfileForTests();
    resetEnvironmentStoreForTests();
  });

  it("keeps getCurrentUser synchronous for a stored id token", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });
    const idToken = jwt({ sub: "user-a", email: "a@example.com" });

    storeOAuthTokens({
      id_token: idToken,
      access_token: "access-a",
      refresh_token: "refresh-a",
    });

    expect(getCurrentUser()).toMatchObject({
      sub: "user-a",
      email: "a@example.com",
    });
  });

  it("preserves hasStoredSession semantics for one environment", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });

    expect(hasStoredSession()).toBe(false);
    storeOAuthTokens({
      id_token: jwt({ sub: "user-a" }),
      access_token: "access-a",
      refresh_token: "refresh-a",
    });

    expect(hasStoredSession()).toBe(true);
  });

  it("refreshes OAuth tokens for the active environment client", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({
        cognitoClientId: "client-a",
        cognitoDomain: "auth-a.example.com",
      }),
    });
    const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool";
    const nextIdToken = jwt({
      iss: issuer,
      aud: "client-a",
      token_use: "id",
      sub: "user-a",
      email: "new@example.com",
    });
    storeOAuthTokens({
      id_token: jwt({ sub: "user-a", email: "old@example.com", exp: 1 }),
      access_token: "old-access",
      refresh_token: "refresh-a",
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id_token: nextIdToken,
        access_token: jwt({
          iss: issuer,
          client_id: "client-a",
          token_use: "access",
          sub: "user-a",
        }),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshOAuthTokens()).resolves.toBe(nextIdToken);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth-a.example.com/oauth2/token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("client_id=client-a"),
      }),
    );
    expect(getStoredOAuthIdToken()).toBe(nextIdToken);
  });

  it("builds a provider-specific Cognito authorize request with PKCE and state", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "local-client" }),
    });
    const request = await createOAuthAuthorizeRequest(
      {
        route: {
          clientId: "microsoft-client",
          identityProvider: "MicrosoftOrganizations",
          prompt: "select_account",
        },
      },
      "thinkwork://auth/callback",
    );
    const url = new URL(request.authorizeUrl);
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("microsoft-client");
    expect(url.searchParams.get("identity_provider")).toBe(
      "MicrosoftOrganizations",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(url.searchParams.get("nonce")).toBe(request.nonce);
    expect(request.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it("revokes the refresh token, terminates the Cognito hosted session, and clears local state", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({
        cognitoClientId: "client-a",
        cognitoDomain: "auth-a.example.com",
      }),
    });
    storeOAuthTokens({
      id_token: jwt({ sub: "user-a" }),
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await signOut();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth-a.example.com/oauth2/revoke",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("token=refresh-a"),
      }),
    );
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      "https://auth-a.example.com/logout?client_id=client-a&logout_uri=thinkwork%3A%2F%2F",
      "thinkwork://",
    );
    expect(getStoredOAuthRefreshToken()).toBeNull();
  });

  it("still clears local state when remote sign-out is offline", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({
        cognitoClientId: "client-a",
        cognitoDomain: "auth-a.example.com",
      }),
    });
    storeOAuthTokens({
      id_token: jwt({ sub: "user-a" }),
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    mockOpenAuthSessionAsync.mockRejectedValueOnce(new Error("offline"));

    await expect(signOut()).resolves.toBeUndefined();
    expect(getStoredOAuthRefreshToken()).toBeNull();
  });

  it("dismisses a native hosted-session logout that exceeds the sign-out deadline", async () => {
    vi.useFakeTimers();
    try {
      await addOrUpdateEnvironment({
        host: "one.thinkwork.ai",
        config: runtimeConfig({
          cognitoClientId: "client-a",
          cognitoDomain: "auth-a.example.com",
        }),
      });
      storeOAuthTokens({
        id_token: jwt({ sub: "user-a" }),
        access_token: "access-a",
        refresh_token: "refresh-a",
      });
      mockOpenAuthSessionAsync.mockImplementationOnce(
        () => new Promise(() => undefined),
      );

      const pendingSignOut = signOut();
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(pendingSignOut).resolves.toBeUndefined();

      expect(mockDismissAuthSession).toHaveBeenCalledOnce();
      expect(getStoredOAuthRefreshToken()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates Cognito OAuth issuer, app client, token type, subject, and nonce", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "local-client" }),
    });
    const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool";
    const tokens = {
      id_token: jwt({
        iss: issuer,
        aud: "microsoft-client",
        token_use: "id",
        sub: "user-a",
        nonce: "nonce-a",
      }),
      access_token: jwt({
        iss: issuer,
        client_id: "microsoft-client",
        token_use: "access",
        sub: "user-a",
      }),
    };

    expect(
      validateOAuthTokens(tokens, {
        clientId: "microsoft-client",
        nonce: "nonce-a",
      }),
    ).toMatchObject({ sub: "user-a" });
    expect(() =>
      validateOAuthTokens(tokens, {
        clientId: "microsoft-client",
        nonce: "attacker-nonce",
      }),
    ).toThrow("OAuth nonce verification failed");
  });

  it("switches between two stored environment sessions without leaking tokens", async () => {
    const envA = await addOrUpdateEnvironment({
      host: "a.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });
    const tokenA = jwt({ sub: "user-a", email: "a@example.com" });
    storeOAuthTokens({
      id_token: tokenA,
      access_token: "access-a",
      refresh_token: "refresh-a",
    });

    const envB = await addOrUpdateEnvironment({
      host: "b.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-b" }),
    });
    const tokenB = jwt({ sub: "user-b", email: "b@example.com" });
    storeOAuthTokens({
      id_token: tokenB,
      access_token: "access-b",
      refresh_token: "refresh-b",
    });

    await expect(switchActiveEnvironment(envA.id)).resolves.toMatchObject({
      status: "restored",
      token: tokenA,
    });
    expect(getStoredOAuthIdToken()).toBe(tokenA);
    expect(getStoredOAuthIdToken()).not.toBe(tokenB);
    expect(mockSetAuthToken).toHaveBeenLastCalledWith(tokenA);

    await expect(switchActiveEnvironment(envB.id)).resolves.toMatchObject({
      status: "restored",
      token: tokenB,
    });
    expect(getStoredOAuthIdToken()).toBe(tokenB);
    expect(getStoredOAuthIdToken()).not.toBe(tokenA);
    expect(mockSetAuthToken).toHaveBeenLastCalledWith(tokenB);
  });

  it("switches to login when the target environment has no session", async () => {
    const envA = await addOrUpdateEnvironment({
      host: "a.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });
    const tokenA = jwt({ sub: "user-a" });
    storeOAuthTokens({
      id_token: tokenA,
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    const envB = await addOrUpdateEnvironment({
      host: "b.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-b" }),
    });

    await expect(switchActiveEnvironment(envB.id)).resolves.toMatchObject({
      status: "needs-login",
      environment: { id: envB.id },
    });
    expect(mockSetAuthToken).toHaveBeenLastCalledWith(null);

    await switchActiveEnvironment(envA.id);
    expect(getStoredOAuthIdToken()).toBe(tokenA);
  });

  it("removes only the selected environment session and falls back when active is removed", async () => {
    const envA = await addOrUpdateEnvironment({
      host: "a.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });
    const tokenA = jwt({ sub: "user-a" });
    storeOAuthTokens({
      id_token: tokenA,
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    const envB = await addOrUpdateEnvironment({
      host: "b.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-b" }),
    });
    const tokenB = jwt({ sub: "user-b" });
    storeOAuthTokens({
      id_token: tokenB,
      access_token: "access-b",
      refresh_token: "refresh-b",
    });

    await removeEnvironmentWithSessionCleanup(envB.id);
    expect(getActiveEnvironmentEntry()).toMatchObject({ id: envA.id });
    expect(getStoredOAuthIdToken()).toBe(tokenA);

    await removeEnvironmentWithSessionCleanup(envA.id);
    expect(getActiveEnvironmentEntry()).toBeNull();
    expect(mockSetAuthToken).toHaveBeenLastCalledWith(null);
  });

  it("removes a non-active environment without touching the active session", async () => {
    const envA = await addOrUpdateEnvironment({
      host: "a.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-a" }),
    });
    const tokenA = jwt({ sub: "user-a" });
    storeOAuthTokens({
      id_token: tokenA,
      access_token: "access-a",
      refresh_token: "refresh-a",
    });
    const envB = await addOrUpdateEnvironment({
      host: "b.thinkwork.ai",
      config: runtimeConfig({ cognitoClientId: "client-b" }),
    });
    const tokenB = jwt({ sub: "user-b" });
    storeOAuthTokens({
      id_token: tokenB,
      access_token: "access-b",
      refresh_token: "refresh-b",
    });

    await removeEnvironmentWithSessionCleanup(envA.id);

    expect(getActiveEnvironmentEntry()).toMatchObject({ id: envB.id });
    expect(getStoredOAuthIdToken()).toBe(tokenB);
    await switchActiveEnvironment(envB.id);
    expect(getStoredOAuthIdToken()).toBe(tokenB);
  });
});

function runtimeConfig(
  overrides: Partial<EnvironmentRuntimeConfig> = {},
): EnvironmentRuntimeConfig {
  return {
    apiUrl: "https://api.example.com",
    graphqlHttpUrl: "https://api.example.com/graphql",
    graphqlUrl: "https://appsync.example.com/graphql",
    graphqlWsUrl: "wss://appsync.example.com/graphql",
    cognitoDomain: "auth.example.com",
    cognitoUserPoolId: "us-east-1_pool",
    cognitoClientId: "client-id",
    deploymentId: "deployment-1",
    displayName: "Customer",
    stage: "dev",
    region: "us-east-1",
    ...overrides,
  };
}

function jwt(payload: Record<string, unknown>): string {
  const merged = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  };
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode(merged),
    "signature",
  ].join(".");
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
