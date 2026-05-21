import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");

const ORIGINAL_LOCATION = window.location;

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
});

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
