import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopAuthCallback } from "./desktop-callback";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  getDesktopBridge: vi.fn(),
  normalizeDesktopNext: (value: unknown) =>
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
      ? value
      : undefined,
}));

const authMocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  getTokenStorage: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => routerMocks.navigate,
}));

vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);

vi.mock("@/lib/auth", () => ({
  getTokenStorage: authMocks.getTokenStorage,
}));

beforeEach(() => {
  authMocks.hydrate.mockResolvedValue(undefined);
  authMocks.getTokenStorage.mockReturnValue({ hydrate: authMocks.hydrate });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DesktopAuthCallback", () => {
  it("consumes the pending desktop OAuth callback and routes to main-owned next", async () => {
    const bridge = {
      consumePendingOAuth: vi.fn().mockResolvedValue({
        code: "code",
        state: "state",
        next: "/automations/123",
      }),
    };
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(bridge);

    render(<DesktopAuthCallback />);

    await waitFor(() =>
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: "/automations/123",
        replace: true,
      }),
    );
    expect(bridge.consumePendingOAuth).toHaveBeenCalledTimes(1);
    expect(authMocks.hydrate).toHaveBeenCalledTimes(1);
  });

  it("defaults to /new when no next destination is supplied", async () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      consumePendingOAuth: vi.fn().mockResolvedValue({
        code: "code",
        state: "state",
      }),
    });

    render(<DesktopAuthCallback />);

    await waitFor(() =>
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: "/new",
        replace: true,
      }),
    );
  });

  it("surfaces a missing pending callback instead of silently navigating", async () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      consumePendingOAuth: vi.fn().mockResolvedValue(null),
    });

    render(<DesktopAuthCallback />);

    await screen.findByText("No pending desktop sign-in callback.");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("guards against repeated consumes on rerender", async () => {
    const bridge = {
      consumePendingOAuth: vi.fn().mockResolvedValue({
        code: "code",
        state: "state",
      }),
    };
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(bridge);

    const view = render(<DesktopAuthCallback />);
    view.rerender(<DesktopAuthCallback />);

    await waitFor(() => expect(bridge.consumePendingOAuth).toHaveBeenCalled());
    expect(bridge.consumePendingOAuth).toHaveBeenCalledTimes(1);
  });
});
