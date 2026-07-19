import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "./callback";

const routerMocks = vi.hoisted(() => ({
  search: {
    code: "",
    state: "",
    error: "",
    error_description: "",
    workos_bridge: "",
  },
}));

const authMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  exchangeLegacyWorkosBridge: vi.fn(),
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
    state: "",
    error: "",
    error_description: "",
    workos_bridge: "",
  };
  authMocks.exchangeCodeForSession.mockReset();
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

describe("AuthCallback native Cognito route", () => {
  it("exchanges code and state with the selected app client", async () => {
    const tokens = {
      id_token: "id-token",
      access_token: "access-token",
      refresh_token: "refresh-token",
    };
    routerMocks.search = {
      code: "native-code",
      state: "bound-state",
      error: "",
      error_description: "",
      workos_bridge: "",
    };
    authMocks.exchangeCodeForSession.mockResolvedValue({
      tokens,
      clientId: "google-client",
      next: "/new",
    });

    render(<AuthCallback />);

    await waitFor(() =>
      expect(authMocks.storeTokensInCognitoStorage).toHaveBeenCalledWith(
        tokens,
        "google-client",
      ),
    );
    expect(authMocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "native-code",
      "bound-state",
    );
    expect(window.location.href).toBe("/new");
  });

  it("exchanges the dedicated legacy migration bridge without native OAuth state", async () => {
    const tokens = {
      id_token: "id-token",
      access_token: "access-token",
      refresh_token: "refresh-token",
    };
    routerMocks.search = {
      code: "",
      state: "",
      error: "",
      error_description: "",
      workos_bridge: "one-use-bridge",
    };
    authMocks.exchangeLegacyWorkosBridge.mockResolvedValue({
      tokens,
      clientId: "legacy-client",
      next: "/new",
    });

    render(<AuthCallback />);

    await waitFor(() =>
      expect(authMocks.storeTokensInCognitoStorage).toHaveBeenCalledWith(
        tokens,
        "legacy-client",
      ),
    );
    expect(authMocks.exchangeLegacyWorkosBridge).toHaveBeenCalledWith(
      "one-use-bridge",
    );
    expect(authMocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
