import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "./callback";

const routerMocks = vi.hoisted(() => ({
  search: {
    code: "",
    workos_bridge: "",
    next: "",
    error: "",
    error_description: "",
  },
}));

const authMocks = vi.hoisted(() => ({
  consumePostAuthRedirect: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  exchangeWorkosBridgeForSession: vi.fn(),
  getGoogleSignInUrl: vi.fn(),
  storeTokensInCognitoStorage: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => routerMocks.search,
  }),
}));

vi.mock("@/lib/auth", () => authMocks);

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  routerMocks.search = {
    code: "",
    workos_bridge: "",
    next: "",
    error: "",
    error_description: "",
  };
  authMocks.consumePostAuthRedirect.mockImplementation((fallback = "/new") => fallback);
  authMocks.exchangeCodeForSession.mockReset();
  authMocks.exchangeWorkosBridgeForSession.mockReset();
  authMocks.getGoogleSignInUrl.mockReturnValue("/google");
  authMocks.storeTokensInCognitoStorage.mockReset();

  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "https://app.example/auth/callback",
      origin: "https://app.example",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("AuthCallback WorkOS bridge", () => {
  it("stores Cognito tokens returned by the verified WorkOS bridge", async () => {
    const tokens = {
      id_token: "id-token",
      access_token: "access-token",
      refresh_token: "refresh-token",
    };
    routerMocks.search = {
      code: "",
      workos_bridge: "one-time-bridge",
      next: "/new",
      error: "",
      error_description: "",
    };
    authMocks.exchangeWorkosBridgeForSession.mockResolvedValue(tokens);

    render(<AuthCallback />);

    await waitFor(() =>
      expect(authMocks.storeTokensInCognitoStorage).toHaveBeenCalledWith(tokens),
    );
    expect(authMocks.exchangeWorkosBridgeForSession).toHaveBeenCalledWith(
      "one-time-bridge",
    );
    expect(authMocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(authMocks.consumePostAuthRedirect).toHaveBeenCalledWith("/new");
    expect(window.location.href).toBe("/new");
  });

  it("does not store Cognito tokens when the WorkOS bridge exchange fails", async () => {
    routerMocks.search = {
      code: "",
      workos_bridge: "bad-bridge",
      next: "/new",
      error: "",
      error_description: "",
    };
    authMocks.exchangeWorkosBridgeForSession.mockRejectedValue(
      new Error("WorkOS bridge exchange failed"),
    );

    render(<AuthCallback />);

    await screen.findByText("WorkOS bridge exchange failed");
    expect(authMocks.storeTokensInCognitoStorage).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://app.example/auth/callback");
  });
});
