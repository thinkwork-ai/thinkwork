import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");

// Admin's vitest runs in the default Node environment, so `window` does not
// exist. Stub the minimum surface auth.ts uses inside its functions (origin +
// href) on `globalThis` before importing the module.

function stubWindow(origin: string): { navigations: string[] } {
  const navigations: string[] = [];
  const stub = {
    origin,
    set href(target: string) {
      navigations.push(target);
    },
    get href() {
      return navigations[navigations.length - 1] ?? `${origin}/`;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: stub },
  });
  return { navigations };
}

function stubSessionStorage(): Map<string, string> {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  return storage;
}

afterEach(() => {
  // Drop the stub so test isolation holds.
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe("getGoogleSignInUrl", () => {
  it("forces the Google account chooser with prompt=select_account", async () => {
    stubWindow("https://admin.example");
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
    const { navigations } = stubWindow("https://admin.example");

    signOut();

    expect(navigations).toHaveLength(1);
    const target = new URL(navigations[0]);
    expect(target.pathname).toBe("/logout");
    expect(target.searchParams.get("client_id")).toBe("test-client-id");
    // Cognito LogoutURLs allowlist contains bare origins; the `_authed` route
    // guard bounces the unauthenticated user to /sign-in once they land.
    expect(target.searchParams.get("logout_uri")).toBe("https://admin.example");
  });
});

describe("post-auth redirects", () => {
  it("stores and consumes safe relative redirect paths", async () => {
    const storage = stubSessionStorage();
    const { consumePostAuthRedirect, rememberPostAuthRedirect } =
      await import("./auth");

    rememberPostAuthRedirect("/onboarding/welcome?session_id=cs_test_123");

    expect(storage.get("thinkwork:post-auth-redirect")).toBe(
      "/onboarding/welcome?session_id=cs_test_123",
    );
    expect(consumePostAuthRedirect()).toBe(
      "/onboarding/welcome?session_id=cs_test_123",
    );
    expect(storage.has("thinkwork:post-auth-redirect")).toBe(false);
  });

  it("ignores unsafe post-auth redirect paths", async () => {
    const storage = stubSessionStorage();
    const { consumePostAuthRedirect, rememberPostAuthRedirect } =
      await import("./auth");

    rememberPostAuthRedirect("https://evil.example");
    expect(storage.has("thinkwork:post-auth-redirect")).toBe(false);

    rememberPostAuthRedirect("//evil.example");
    expect(storage.has("thinkwork:post-auth-redirect")).toBe(false);

    storage.set("thinkwork:post-auth-redirect", "//evil.example");
    expect(consumePostAuthRedirect("/dashboard")).toBe("/dashboard");
    expect(storage.has("thinkwork:post-auth-redirect")).toBe(false);
  });
});
