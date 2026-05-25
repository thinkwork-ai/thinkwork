import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPage } from "./sign-in";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { next: undefined as string | undefined },
}));

const authContextMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getGoogleSignInUrl: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  getDesktopBridge: vi.fn(),
  isDesktopBuild: vi.fn(),
  normalizeDesktopNext: (value: unknown) =>
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
      ? value
      : undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as object),
    useSearch: () => routerMocks.search,
  }),
  useNavigate: () => routerMocks.navigate,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: authContextMocks.useAuth,
}));

vi.mock("@/lib/auth", () => ({
  getGoogleSignInUrl: authMocks.getGoogleSignInUrl,
}));

vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  authContextMocks.useAuth.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
  });
  authMocks.getGoogleSignInUrl.mockReturnValue("https://auth.example/login");
  routerMocks.search = { next: undefined };
  desktopRuntimeMocks.isDesktopBuild.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  vi.clearAllMocks();
});

describe("SignInPage", () => {
  it("renders a blank splash with a single login action for unauthenticated users", () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.getByRole("heading", { name: "ThinkWork" })).toBeTruthy();
    expect(screen.getByText("Spaces")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText(/Sign in with the Google account/i)).toBeNull();
  });

  it("waits for auth restoration before enabling login", () => {
    authContextMocks.useAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    render(<SignInPage />);

    expect(
      (
        screen.getByRole("button", {
          name: "Checking session...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("starts desktop OAuth with the sanitized next destination", async () => {
    const startOAuth = vi.fn().mockResolvedValue({
      url: "https://auth.example/oauth2/authorize?state=xyz",
      state: "xyz",
    });
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      startOAuth,
      onOAuthError: () => () => {},
    });
    routerMocks.search = { next: "/automations/123" };

    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(startOAuth).toHaveBeenCalledWith({ next: "/automations/123" }),
    );
  });

  it("renders draggable desktop chrome in the Electron sign-in shell", () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.getByRole("banner").textContent).toContain(
      "ThinkWork Spaces",
    );
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("shows incomplete packaged desktop configuration before OAuth starts", async () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      getDesktopConfig: vi.fn().mockResolvedValue({
        stage: "dev",
        configured: false,
        missing: ["VITE_API_URL", "VITE_COGNITO_DOMAIN"],
        oauthRedirectUri: "thinkwork-dev://oauth/callback",
        endpoints: {
          apiUrl: null,
          graphqlHttpUrl: "https://api.example.com/graphql",
          graphqlUrl: "https://appsync.example.com/graphql",
          graphqlWsUrl: "wss://appsync.example.com/graphql",
          cognitoDomain: null,
        },
      }),
      startOAuth: vi.fn(),
      onOAuthError: () => () => {},
    });

    render(<SignInPage />);

    await screen.findByText("Configuration incomplete for dev");
    expect(screen.getByText(/Missing VITE_API_URL/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("uses the existing browser OAuth redirect outside desktop mode", () => {
    const navigations: string[] = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        set href(target: string) {
          navigations.push(target);
        },
        get href() {
          return navigations.at(-1) ?? "https://app.example/sign-in";
        },
      },
    });
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(navigations).toEqual(["https://auth.example/login"]);
  });

  it("surfaces desktop OAuth errors broadcast by main", async () => {
    const oauthError = {
      listener: null as ((event: { message: string }) => void) | null,
    };
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      startOAuth: vi.fn(),
      onOAuthError(listener: (event: { message: string }) => void) {
        oauthError.listener = listener;
        return () => {
          oauthError.listener = null;
        };
      },
    });

    render(<SignInPage />);
    expect(oauthError.listener).not.toBeNull();
    oauthError.listener?.({
      message: "No in-flight OAuth attempt for callback state",
    });

    await screen.findByText("No in-flight OAuth attempt for callback state");
  });
});
