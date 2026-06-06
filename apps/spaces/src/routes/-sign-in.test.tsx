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
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  vi.stubEnv("VITE_GRAPHQL_HTTP_URL", "https://api.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_URL", "https://appsync.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_WS_URL", "wss://appsync.example.com/graphql");
  vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");
  vi.stubEnv("VITE_DEPLOYMENT_ID", "thinkwork-dev");
  vi.stubEnv("VITE_DEPLOYMENT_DISPLAY_NAME", "Acme ThinkWork");
  vi.stubEnv("VITE_STAGE", "dev");
  vi.stubEnv("VITE_AWS_REGION", "us-east-1");
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
  vi.unstubAllEnvs();
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
    expect(screen.getByText("Acme ThinkWork · dev · us-east-1")).toBeTruthy();
    expect(screen.getByText("Unsigned build-time fallback")).toBeTruthy();
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

  it("shows the active desktop deployment profile before OAuth starts", async () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      getDesktopConfig: vi.fn().mockResolvedValue({
        stage: "customer-dev",
        configured: true,
        missing: [],
        oauthRedirectUri: "thinkwork-dev://oauth/callback",
        endpoints: {
          apiUrl: "https://api.customer.example.com",
          graphqlHttpUrl: "https://api.customer.example.com/graphql",
          graphqlUrl: "https://appsync.customer.example.com/graphql",
          graphqlWsUrl: "wss://appsync.customer.example.com/graphql",
          cognitoDomain: "https://auth.customer.example.com",
        },
        deployment: {
          source: "profile",
          deploymentId: "acme-dev",
          displayName: "Acme ThinkWork",
          stage: "customer-dev",
          region: "us-west-2",
          profileSha256: "abc123",
          trustStatus: "unsigned",
          trustLabel: "Unsigned development profile",
        },
      }),
      startOAuth: vi.fn(),
      clearTokenStorage: vi.fn(),
      onOAuthError: () => () => {},
      onDeepLink: () => () => {},
    });

    render(<SignInPage />);

    await screen.findByText(
      "Connected to Acme ThinkWork · customer-dev · us-west-2",
    );
    expect(screen.getByText("Unsigned development profile")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("imports pasted desktop deployment profile JSON", async () => {
    const clearTokenStorage = vi.fn().mockResolvedValue(undefined);
    const importDeploymentProfile = vi.fn().mockResolvedValue({
      stage: "customer-dev",
      configured: true,
      missing: [],
      oauthRedirectUri: "thinkwork-dev://oauth/callback",
      endpoints: {
        apiUrl: "https://api.customer.example.com",
        graphqlHttpUrl: "https://api.customer.example.com/graphql",
        graphqlUrl: "https://appsync.customer.example.com/graphql",
        graphqlWsUrl: "wss://appsync.customer.example.com/graphql",
        cognitoDomain: "https://auth.customer.example.com",
      },
      deployment: {
        source: "profile",
        deploymentId: "acme-dev",
        displayName: "Acme ThinkWork",
        stage: "customer-dev",
        region: "us-west-2",
        profileSha256: "abc123",
        trustStatus: "unsigned",
        trustLabel: "Unsigned development profile",
      },
    });
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      getDesktopConfig: vi.fn().mockResolvedValue({
        stage: "dev",
        configured: true,
        missing: [],
        oauthRedirectUri: "thinkwork-dev://oauth/callback",
        endpoints: {
          apiUrl: "https://api.example.com",
          graphqlHttpUrl: "https://api.example.com/graphql",
          graphqlUrl: "https://appsync.example.com/graphql",
          graphqlWsUrl: "wss://appsync.example.com/graphql",
          cognitoDomain: "thinkwork-dev",
        },
      }),
      importDeploymentProfile,
      clearTokenStorage,
      startOAuth: vi.fn(),
      onOAuthError: () => () => {},
      onDeepLink: () => () => {},
    });

    render(<SignInPage />);
    fireEvent.change(await screen.findByLabelText("Deployment profile JSON"), {
      target: { value: '{"schemaVersion":1}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(importDeploymentProfile).toHaveBeenCalledWith({
        json: '{"schemaVersion":1}',
      }),
    );
    expect(clearTokenStorage).toHaveBeenCalled();
    await screen.findByText(
      "Connected to Acme ThinkWork · customer-dev · us-west-2",
    );
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

  it("blocks browser OAuth when required deployment profile fields are missing", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
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

    expect(screen.getByText("Configuration incomplete for dev")).toBeTruthy();
    expect(screen.getByText(/Missing VITE_COGNITO_CLIENT_ID/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(navigations).toEqual([]);
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
