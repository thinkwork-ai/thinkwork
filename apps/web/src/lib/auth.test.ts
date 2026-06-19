import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");
vi.stubEnv("VITE_API_URL", "https://api.example.com");

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
});

function stubLocation(origin: string): { navigations: string[] } {
  const navigations: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin,
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

async function flushAsyncLogout(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("getGoogleSignInUrl", () => {
  it("forces the Google account chooser with prompt=select_account", async () => {
    stubLocation("https://app.example");
    const { getGoogleSignInUrl } = await import("./auth");

    const url = new URL(getGoogleSignInUrl());
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("identity_provider")).toBe("Google");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("getHostedSignInUrl", () => {
  it("uses the Cognito hosted UI without forcing an identity provider", async () => {
    stubLocation("https://app.example");
    const { getHostedSignInUrl } = await import("./auth");

    const url = new URL(getHostedSignInUrl());
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("identity_provider")).toBeNull();
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
  });
});

describe("getAuthOptionSignInUrl", () => {
  it("routes public auth options through the returned Cognito IdP", async () => {
    stubLocation("https://app.example");
    const { getAuthOptionSignInUrl } = await import("./auth");

    const url = new URL(
      getAuthOptionSignInUrl({
        key: "workos-sso",
        label: "Continue with SSO",
        icon: "sso",
        provider: "workos",
        providerSpecific: false,
        cognitoIdentityProviderName: "WorkOSAuth",
        route: {
          type: "cognitoHostedUi",
          identityProvider: "WorkOSAuth",
        },
      }),
    );

    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("identity_provider")).toBe("WorkOSAuth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
  });
});

describe("signOut", () => {
  it("redirects through the Cognito /logout endpoint to clear the hosted-UI session", async () => {
    const { signOut } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    signOut();
    await flushAsyncLogout();

    expect(navigations).toHaveLength(1);
    const target = new URL(navigations[0]);
    expect(target.pathname).toBe("/logout");
    expect(target.searchParams.get("client_id")).toBe("test-client-id");
    // Cognito LogoutURLs allowlist contains bare origins; the `_authed` route
    // guard bounces the unauthenticated user to /sign-in once they land.
    expect(target.searchParams.get("logout_uri")).toBe("https://app.example");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokes upstream WorkOS sessions before redirecting through Cognito logout", async () => {
    const idToken = makeIdToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "user-sub",
      "cognito:username": "workos-user",
    });
    window.localStorage.setItem(
      "CognitoIdentityServiceProvider.test-client-id.LastAuthUser",
      "workos-user",
    );
    window.localStorage.setItem(
      "CognitoIdentityServiceProvider.test-client-id.workos-user.idToken",
      idToken,
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { signOut } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");

    signOut();
    await flushAsyncLogout();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/workos/logout",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      }),
    );
    expect(navigations).toHaveLength(1);
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
