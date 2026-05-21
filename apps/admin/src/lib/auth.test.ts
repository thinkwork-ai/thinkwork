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

afterEach(() => {
  // Drop the stub so test isolation holds.
  delete (globalThis as { window?: unknown }).window;
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
    expect(target.searchParams.get("logout_uri")).toBe(
      "https://admin.example/sign-in",
    );
  });
});
