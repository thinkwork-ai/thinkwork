import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "./callback";

const routeSearch = vi.hoisted(() => ({
  value: {
    code: "auth-code",
    error: "",
    error_description: "",
  },
}));

const authMocks = vi.hoisted(() => ({
  assertNotStaleWorkosOAuthSession: vi.fn(),
  consumePostAuthRedirect: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getGoogleSignInUrl: vi.fn(),
  storeTokensInCognitoStorage: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as object),
    useSearch: () => routeSearch.value,
  }),
}));

vi.mock("@/lib/auth", () => authMocks);

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  routeSearch.value = {
    code: "auth-code",
    error: "",
    error_description: "",
  };
  authMocks.exchangeCodeForSession.mockResolvedValue({
    id_token: "id-token",
    access_token: "access-token",
    refresh_token: "refresh-token",
  });
  authMocks.assertNotStaleWorkosOAuthSession.mockResolvedValue(undefined);
  authMocks.consumePostAuthRedirect.mockReturnValue("/new");
  authMocks.getGoogleSignInUrl.mockReturnValue(
    "https://auth.example/oauth2/authorize?identity_provider=Google&prompt=select_account",
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

function stubLocation(): { navigations: string[] } {
  const navigations: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(target: string) {
        navigations.push(target);
      },
      get href() {
        return navigations.at(-1) ?? "https://app.example/auth/callback";
      },
    },
  });
  return { navigations };
}

describe("AuthCallback", () => {
  it("redirects stale WorkOS callbacks to the Google account chooser", async () => {
    authMocks.assertNotStaleWorkosOAuthSession.mockRejectedValue(
      new Error(
        "WorkOS is still signed in as the account that just logged out.",
      ),
    );
    const { navigations } = stubLocation();

    render(<AuthCallback />);

    await waitFor(() =>
      expect(authMocks.getGoogleSignInUrl).toHaveBeenCalledTimes(1),
    );
    expect(navigations).toEqual([
      "https://auth.example/oauth2/authorize?identity_provider=Google&prompt=select_account",
    ]);
    expect(authMocks.storeTokensInCognitoStorage).not.toHaveBeenCalled();
  });
});
