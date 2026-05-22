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

describe("signOut", () => {
  it("redirects through the Cognito /logout endpoint to clear the hosted-UI session", async () => {
    const { signOut } = await import("./auth");
    const { navigations } = stubLocation("https://app.example");

    signOut();

    expect(navigations).toHaveLength(1);
    const target = new URL(navigations[0]);
    expect(target.pathname).toBe("/logout");
    expect(target.searchParams.get("client_id")).toBe("test-client-id");
    // Cognito LogoutURLs allowlist contains bare origins; the `_authed` route
    // guard bounces the unauthenticated user to /sign-in once they land.
    expect(target.searchParams.get("logout_uri")).toBe("https://app.example");
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
