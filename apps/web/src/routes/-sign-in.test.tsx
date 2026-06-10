import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeConfigForTest } from "@/lib/runtime-config";
import { SignInPage } from "./sign-in";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { next: undefined as string | undefined },
}));

const authContextMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getHostedSignInUrl: vi.fn(),
  getGoogleSignInUrl: vi.fn(),
  isPasswordSignInConfigured: vi.fn(),
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
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
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
  getHostedSignInUrl: authMocks.getHostedSignInUrl,
  getGoogleSignInUrl: authMocks.getGoogleSignInUrl,
  isPasswordSignInConfigured: authMocks.isPasswordSignInConfigured,
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
  authMocks.getHostedSignInUrl.mockReturnValue("https://auth.example/login");
  authMocks.getGoogleSignInUrl.mockReturnValue(
    "https://auth.example/login?identity_provider=Google",
  );
  authMocks.isPasswordSignInConfigured.mockReturnValue(false);
  routerMocks.search = { next: undefined };
  desktopRuntimeMocks.isDesktopBuild.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  setRuntimeConfigForTest({});
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

    expect(screen.getByRole("heading", { name: "Log in to ThinkWork" })).toBeTruthy();
    expect(screen.queryByText("Spaces")).toBeNull();
    expect(screen.getByText("Acme ThinkWork · dev · us-east-1")).toBeTruthy();
    // Trust plumbing (e.g. "Unsigned build-time fallback") must not leak
    // onto the end-user login page.
    expect(screen.queryByText("Unsigned build-time fallback")).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Create one" })
        .getAttribute("href"),
    ).toBe("/onboarding/welcome");
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

    expect(screen.getByRole("banner").textContent).toContain("ThinkWork");
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
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(screen.queryByText("File")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Create one" }),
    ).toBeTruthy();
  });

  it("imports desktop deployment profile JSON from a deep link", async () => {
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
    const deepLink: {
      listener:
        | ((callback: { type: "deployment-profile"; json: string }) => void)
        | null;
    } = { listener: null };
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
      onDeepLink(
        listener: (callback: {
          type: "deployment-profile";
          json: string;
        }) => void,
      ) {
        deepLink.listener = listener;
        return () => {
          deepLink.listener = null;
        };
      },
    });

    render(<SignInPage />);
    await screen.findByText("Connected to dev");
    expect(screen.queryByLabelText("Deployment profile JSON")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(screen.queryByText("File")).toBeNull();

    deepLink.listener?.({
      type: "deployment-profile",
      json: '{"schemaVersion":1}',
    });

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

  it("uses Terraform-provided runtime config when build-time env is empty", () => {
    for (const key of [
      "VITE_API_URL",
      "VITE_GRAPHQL_HTTP_URL",
      "VITE_GRAPHQL_URL",
      "VITE_GRAPHQL_WS_URL",
      "VITE_COGNITO_USER_POOL_ID",
      "VITE_COGNITO_CLIENT_ID",
      "VITE_COGNITO_DOMAIN",
    ]) {
      vi.stubEnv(key, "");
    }
    setRuntimeConfigForTest({
      VITE_API_URL: "https://runtime-api.example.com",
      VITE_GRAPHQL_HTTP_URL: "https://runtime-api.example.com/graphql",
      VITE_GRAPHQL_URL: "https://runtime-appsync.example.com/graphql",
      VITE_GRAPHQL_WS_URL: "wss://runtime-appsync.example.com/graphql",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_RuntimePool",
      VITE_COGNITO_CLIENT_ID: "runtime-client-id",
      VITE_COGNITO_DOMAIN: "https://runtime-auth.example.com",
      VITE_DEPLOYMENT_DISPLAY_NAME: "Runtime ThinkWork",
      VITE_STAGE: "tei-e2e",
      VITE_AWS_REGION: "us-east-1",
    });
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(
      screen.getByText("Runtime ThinkWork · tei-e2e · us-east-1"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
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

  it("renders the email/password form when password sign-in is configured", () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    // OAuth demotes to a secondary action alongside the form.
    expect(
      screen.getByRole("button", { name: "Log in with Google" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("sends the Google button straight to the Google IdP, not the hosted login page", () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
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
    fireEvent.click(
      screen.getByRole("button", { name: "Log in with Google" }),
    );

    expect(navigations).toEqual([
      "https://auth.example/login?identity_provider=Google",
    ]);
    expect(authMocks.getHostedSignInUrl).not.toHaveBeenCalled();
  });

  it("hides the email/password form in the desktop shell", () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });
});
