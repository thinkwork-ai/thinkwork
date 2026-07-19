import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");

const ORIGINAL_LOCATION = window.location;
const ORIGINAL_LOCAL_STORAGE = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
  window.sessionStorage.clear();
});

function stubLocation(origin: string): { navigations: string[] } {
  const navigations: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin,
      host: new URL(origin).host,
      hostname: new URL(origin).hostname,
      set href(target: string) {
        navigations.push(target);
      },
      get href() {
        return navigations[navigations.length - 1] ?? `${origin}/`;
      },
    },
  });
  return { navigations };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  window.localStorage.clear();
  if (ORIGINAL_LOCAL_STORAGE) {
    Object.defineProperty(window, "localStorage", ORIGINAL_LOCAL_STORAGE);
  }
  vi.resetModules();
});

function base64Url(payload: object): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeIdToken(payload: object): string {
  return ["header", base64Url(payload), "signature"].join(".");
}

describe("getAuthOptionSignInUrl", () => {
  it("starts direct Cognito authorization with state, nonce, and S256 PKCE", async () => {
    stubLocation("https://app.example");
    const { getAuthOptionSignInUrl } = await import("./auth");

    const url = new URL(
      await getAuthOptionSignInUrl(
        {
          key: "microsoft",
          label: "Continue with Microsoft",
          icon: "microsoft",
          provider: "microsoft",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "microsoft-client",
            identityProvider: "MicrosoftOrganizations",
            prompt: "select_account",
          },
        },
        "/automations/123",
      ),
    );

    expect(url.origin).toBe(
      "https://thinkwork-test.auth.us-east-1.amazoncognito.com",
    );
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("microsoft-client");
    expect(url.searchParams.get("identity_provider")).toBe(
      "MicrosoftOrganizations",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/auth/callback",
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(url.searchParams.get("nonce")).toBeTruthy();
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const stored = JSON.parse(
      window.sessionStorage.getItem(`thinkwork:oauth-flow:${state}`) ?? "{}",
    );
    expect(stored).toEqual(
      expect.objectContaining({
        clientId: "microsoft-client",
        initiatingOrigin: "https://app.example",
        next: "/automations/123",
      }),
    );
  });
});

describe("getAuthOptionProviderSwitchUrl", () => {
  it("binds the selected provider to the admitted session and revokes the previous route", async () => {
    stubLocation("https://app.example");
    const auth = await import("./auth");
    const currentIdToken = makeIdToken({
      sub: "microsoft-cognito-sub",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    auth.storeTokensInCognitoStorage(
      {
        id_token: currentIdToken,
        access_token: "microsoft-access-token",
        refresh_token: "microsoft-refresh-token",
      },
      "microsoft-client",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            startToken: "switch-start-token",
            recipientChallenge: "87654321",
            routeKeys: ["google-web"],
            expiresAt: "2026-07-19T12:00:00.000Z",
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ revoked: true }));
    vi.stubGlobal("fetch", fetchMock);

    const url = new URL(
      await auth.getAuthOptionProviderSwitchUrl(
        {
          key: "google",
          label: "Continue with Google",
          icon: "google",
          provider: "google",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "google-client",
            identityProvider: "Google",
            prompt: "select_account",
          },
        },
        "/profile",
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      "/api/auth/enrollment/switch",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: `Bearer ${currentIdToken}`,
      }),
      body: JSON.stringify({
        targetClientId: "google-client",
        redirectUri: "https://app.example/auth/callback",
      }),
    });
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe(
      "/api/auth/revoke",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      body: JSON.stringify({ refreshToken: "microsoft-refresh-token" }),
    });
    expect(url.searchParams.get("client_id")).toBe("google-client");
    expect(url.searchParams.get("identity_provider")).toBe("Google");
    const state = url.searchParams.get("state");
    const stored = JSON.parse(
      window.sessionStorage.getItem(`thinkwork:oauth-flow:${state}`) ?? "{}",
    );
    expect(stored).toEqual(
      expect.objectContaining({
        purpose: "provider_switch",
        next: "/profile",
        enrollment: {
          startToken: "switch-start-token",
          recipientChallenge: "87654321",
        },
      }),
    );
    expect(
      window.localStorage.getItem(
        "CognitoIdentityServiceProvider.microsoft-client.microsoft-cognito-sub.refreshToken",
      ),
    ).toBeNull();
  });
});

describe("native Cognito callback exchange", () => {
  it("uses the selected route client and one-time PKCE state", async () => {
    stubLocation("https://app.example");
    const auth = await import("./auth");
    const authorizeUrl = new URL(
      await auth.getAuthOptionSignInUrl({
        key: "google",
        label: "Continue with Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "google-client",
          identityProvider: "Google",
          prompt: "select_account",
        },
      }),
    );
    const state = authorizeUrl.searchParams.get("state")!;
    const nonce = authorizeUrl.searchParams.get("nonce")!;
    const issuer =
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id_token: makeIdToken({
          token_use: "id",
          aud: "google-client",
          nonce,
          iss: issuer,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        access_token: makeIdToken({
          token_use: "access",
          client_id: "google-client",
          iss: issuer,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        refresh_token: "refresh-token",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await auth.exchangeCodeForSession("one-time-code", state);
    expect(result.clientId).toBe("google-client");
    expect(result.next).toBe("/new");
    const request = fetchMock.mock.calls[0][1];
    const body = request?.body as URLSearchParams;
    expect(body.get("client_id")).toBe("google-client");
    expect(body.get("code_verifier")).toBeTruthy();
    await expect(
      auth.exchangeCodeForSession("replayed-code", state),
    ).rejects.toThrow(/missing, expired, or already used/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("binds a native subject with the one-use legacy-session migration grant before returning tokens", async () => {
    stubLocation("https://app.example");
    const auth = await import("./auth");
    const authorizeUrl = new URL(
      await auth.getAuthOptionIdentityMigrationUrl(
        {
          key: "microsoft",
          label: "Microsoft",
          icon: "microsoft",
          provider: "microsoft",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "microsoft-client",
            identityProvider: "MicrosoftOrganizations",
          },
        },
        {
          startToken: "migration-start-token",
          recipientChallenge: "12345678",
        },
        "/spaces",
      ),
    );
    const state = authorizeUrl.searchParams.get("state")!;
    const nonce = authorizeUrl.searchParams.get("nonce")!;
    const issuer =
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool";
    const idToken = makeIdToken({
      token_use: "id",
      aud: "microsoft-client",
      nonce,
      iss: issuer,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id_token: idToken,
          access_token: makeIdToken({
            token_use: "access",
            client_id: "microsoft-client",
            iss: issuer,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
          refresh_token: "refresh-token",
        }),
      )
      .mockResolvedValueOnce(Response.json({ outcome: "consumed" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await auth.exchangeCodeForSession("one-time-code", state);

    expect(result.next).toBe("/spaces");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe(
      "/api/auth/enrollment/consume",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ Authorization: `Bearer ${idToken}` }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      startToken: "migration-start-token",
      recipientChallenge: "12345678",
      redirectUri: "https://app.example/auth/callback",
    });
  });

  it("binds a switched provider before returning its replacement session", async () => {
    stubLocation("https://app.example");
    const auth = await import("./auth");
    auth.storeTokensInCognitoStorage(
      {
        id_token: makeIdToken({
          sub: "microsoft-cognito-sub",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        access_token: "microsoft-access-token",
        refresh_token: "microsoft-refresh-token",
      },
      "microsoft-client",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          startToken: "switch-start-token",
          recipientChallenge: "87654321",
          routeKeys: ["google-web"],
          expiresAt: "2026-07-19T12:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(Response.json({ revoked: true }));
    vi.stubGlobal("fetch", fetchMock);
    const authorizeUrl = new URL(
      await auth.getAuthOptionProviderSwitchUrl({
        key: "google",
        label: "Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "google-client",
          identityProvider: "Google",
        },
      }),
    );
    const state = authorizeUrl.searchParams.get("state")!;
    const nonce = authorizeUrl.searchParams.get("nonce")!;
    const issuer =
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool";
    const googleIdToken = makeIdToken({
      token_use: "id",
      aud: "google-client",
      nonce,
      iss: issuer,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          id_token: googleIdToken,
          access_token: makeIdToken({
            token_use: "access",
            client_id: "google-client",
            iss: issuer,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
          refresh_token: "google-refresh-token",
        }),
      )
      .mockResolvedValueOnce(Response.json({ outcome: "consumed" }));

    const result = await auth.exchangeCodeForSession("google-code", state);

    expect(result.clientId).toBe("google-client");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new URL(String(fetchMock.mock.calls[3][0])).pathname).toBe(
      "/api/auth/enrollment/consume",
    );
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: `Bearer ${googleIdToken}`,
      }),
      body: JSON.stringify({
        startToken: "switch-start-token",
        recipientChallenge: "87654321",
        redirectUri: "https://app.example/auth/callback",
      }),
    });
  });
});

describe("signOut", () => {
  it("redirects through the Cognito /logout endpoint to clear the hosted-UI session", async () => {
    const { signOut } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");

    await signOut();

    expect(navigations).toHaveLength(1);
    const target = new URL(navigations[0]);
    expect(target.pathname).toBe("/logout");
    expect(target.searchParams.get("client_id")).toBe("test-client-id");
    // Cognito LogoutURLs allowlist contains bare origins; the `_authed` route
    // guard bounces the unauthenticated user to /sign-in once they land.
    expect(target.searchParams.get("logout_uri")).toBe("https://app.example");
  });

  it("revokes the refresh token before deleting local credentials", async () => {
    const { signOut, storeTokensInCognitoStorage } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");
    const idToken = makeIdToken({
      sub: "user-sub",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    storeTokensInCognitoStorage({
      id_token: idToken,
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(
          window.localStorage.getItem(`${prefix}.user-sub.refreshToken`),
        ).toBe("refresh-token");
        expect(init).toMatchObject({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${idToken}`,
          }),
          body: JSON.stringify({ refreshToken: "refresh-token" }),
        });
        return Response.json({ revoked: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await signOut();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      "/api/auth/revoke",
    );
    expect(
      window.localStorage.getItem(`${prefix}.user-sub.refreshToken`),
    ).toBeNull();
    expect(new URL(navigations[0]).pathname).toBe("/logout");
  });

  it("still clears local credentials and logs out when revocation fails", async () => {
    const { signOut, storeTokensInCognitoStorage } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");
    storeTokensInCognitoStorage({
      id_token: makeIdToken({ sub: "user-sub" }),
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(signOut()).resolves.toBeUndefined();

    expect(window.localStorage.length).toBe(0);
    expect(new URL(navigations[0]).pathname).toBe("/logout");
  });
});

describe("post-auth redirects", () => {
  it("stores and consumes safe relative redirect paths", async () => {
    const { consumePostAuthRedirect, rememberPostAuthRedirect } =
      await import("./auth");

    rememberPostAuthRedirect("/onboarding/welcome?session_id=cs_test_123");

    expect(window.sessionStorage.getItem("thinkwork:post-auth-redirect")).toBe(
      "/onboarding/welcome?session_id=cs_test_123",
    );
    expect(consumePostAuthRedirect()).toBe(
      "/onboarding/welcome?session_id=cs_test_123",
    );
    expect(
      window.sessionStorage.getItem("thinkwork:post-auth-redirect"),
    ).toBeNull();
  });

  it("ignores unsafe post-auth redirect paths", async () => {
    const { consumePostAuthRedirect, rememberPostAuthRedirect } =
      await import("./auth");

    rememberPostAuthRedirect("https://evil.example");
    expect(
      window.sessionStorage.getItem("thinkwork:post-auth-redirect"),
    ).toBeNull();

    rememberPostAuthRedirect("//evil.example");
    expect(
      window.sessionStorage.getItem("thinkwork:post-auth-redirect"),
    ).toBeNull();

    window.sessionStorage.setItem(
      "thinkwork:post-auth-redirect",
      "//evil.example",
    );
    expect(consumePostAuthRedirect("/new")).toBe("/new");
    expect(
      window.sessionStorage.getItem("thinkwork:post-auth-redirect"),
    ).toBeNull();
  });
});

describe("Cognito token storage", () => {
  it("persists OAuth callback tokens with the existing Cognito key layout", async () => {
    const { storeTokensInCognitoStorage } = await import("./auth");
    const idToken = makeIdToken({
      sub: "user-sub",
      "cognito:username": "google-user",
    });

    storeTokensInCognitoStorage({
      id_token: idToken,
      access_token: "access-token",
      refresh_token: "refresh-token",
    });

    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    expect(window.localStorage.getItem(`${prefix}.LastAuthUser`)).toBe(
      "google-user",
    );
    expect(window.localStorage.getItem(`${prefix}.google-user.idToken`)).toBe(
      idToken,
    );
    expect(
      window.localStorage.getItem(`${prefix}.google-user.accessToken`),
    ).toBe("access-token");
    expect(
      window.localStorage.getItem(`${prefix}.google-user.refreshToken`),
    ).toBe("refresh-token");
  });

  it("restores federated id/access tokens from storage after a cold module reload", async () => {
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    const idToken = makeIdToken({
      email: "user@example.com",
      name: "User Example",
      sub: "user-sub",
      "custom:tenant_id": "tenant-id",
      "cognito:groups": ["users"],
    });
    window.localStorage.setItem(`${prefix}.LastAuthUser`, "google-user");
    window.localStorage.setItem(`${prefix}.google-user.idToken`, idToken);
    window.localStorage.setItem(
      `${prefix}.google-user.accessToken`,
      "access-token",
    );

    vi.resetModules();
    const { getIdToken, getAccessToken, getCurrentUser } =
      await import("./auth");

    await expect(getIdToken()).resolves.toBe(idToken);
    await expect(getAccessToken()).resolves.toBe("access-token");
    expect(getCurrentUser()).toEqual({
      email: "user@example.com",
      name: "User Example",
      sub: "user-sub",
      tenantId: "tenant-id",
      groups: ["users"],
    });
  });

  it("clears federated tokens so logout cannot immediately restore the session", async () => {
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    const idToken = makeIdToken({
      email: "user@example.com",
      sub: "user-sub",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    window.localStorage.setItem(`${prefix}.LastAuthUser`, "federated-user");
    window.localStorage.setItem(`${prefix}.federated-user.idToken`, idToken);
    window.localStorage.setItem(
      `${prefix}.federated-user.accessToken`,
      "access-token",
    );
    window.localStorage.setItem(
      `${prefix}.federated-user.refreshToken`,
      "refresh-token",
    );
    window.localStorage.setItem(`${prefix}.federated-user.clockDrift`, "0");

    vi.resetModules();
    const { clearLocalAuthSession, getIdToken } = await import("./auth");

    clearLocalAuthSession();

    expect(window.localStorage.getItem(`${prefix}.LastAuthUser`)).toBeNull();
    expect(
      window.localStorage.getItem(`${prefix}.federated-user.idToken`),
    ).toBeNull();
    expect(
      window.localStorage.getItem(`${prefix}.federated-user.accessToken`),
    ).toBeNull();
    expect(
      window.localStorage.getItem(`${prefix}.federated-user.refreshToken`),
    ).toBeNull();
    await expect(getIdToken()).resolves.toBeNull();
  });

  it("refreshes expired federated tokens from the stored refresh token", async () => {
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    const expiredIdToken = makeIdToken({
      email: "user@example.com",
      sub: "user-sub",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const expiredAccessToken = makeIdToken({
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const refreshedIdToken = makeIdToken({
      email: "user@example.com",
      sub: "user-sub",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const refreshedAccessToken = makeIdToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    window.localStorage.setItem(`${prefix}.LastAuthUser`, "google-user");
    window.localStorage.setItem(
      `${prefix}.google-user.idToken`,
      expiredIdToken,
    );
    window.localStorage.setItem(
      `${prefix}.google-user.accessToken`,
      expiredAccessToken,
    );
    window.localStorage.setItem(
      `${prefix}.google-user.refreshToken`,
      "refresh-token",
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id_token: refreshedIdToken,
            access_token: refreshedAccessToken,
          }),
          { status: 200 },
        ),
      ),
    );

    vi.resetModules();
    const { getIdToken, getAccessToken } = await import("./auth");

    await expect(getIdToken()).resolves.toBe(refreshedIdToken);
    await expect(getAccessToken()).resolves.toBe(refreshedAccessToken);
    expect(window.localStorage.getItem(`${prefix}.google-user.idToken`)).toBe(
      refreshedIdToken,
    );
    expect(
      window.localStorage.getItem(`${prefix}.google-user.accessToken`),
    ).toBe(refreshedAccessToken);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://thinkwork-test.auth.us-east-1.amazoncognito.com/oauth2/token",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}
