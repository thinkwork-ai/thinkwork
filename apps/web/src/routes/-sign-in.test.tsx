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
  search: {
    next: undefined as string | undefined,
    legacyMigration: undefined as "workos" | undefined,
  },
}));

const authContextMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  configurePasswordAuthClient: vi.fn(),
  confirmForgotPassword: vi.fn(),
  forgotPassword: vi.fn(),
  getAuthOptionSignInUrl: vi.fn(),
  getLegacyIdentityMigrationStartUrl: vi.fn(),
  isPasswordSignInConfigured: vi.fn(),
}));

const authOptionsMocks = vi.hoisted(() => ({
  fetchPublicAuthOptions: vi.fn(),
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
  configurePasswordAuthClient: authMocks.configurePasswordAuthClient,
  confirmForgotPassword: authMocks.confirmForgotPassword,
  forgotPassword: authMocks.forgotPassword,
  getAuthOptionSignInUrl: authMocks.getAuthOptionSignInUrl,
  getLegacyIdentityMigrationStartUrl:
    authMocks.getLegacyIdentityMigrationStartUrl,
  isPasswordSignInConfigured: authMocks.isPasswordSignInConfigured,
}));

vi.mock("@/lib/auth-options", () => ({
  fetchPublicAuthOptions: authOptionsMocks.fetchPublicAuthOptions,
}));

vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);

const ORIGINAL_LOCATION = window.location;

function setWindowLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: parsed.href,
      hostname: parsed.hostname,
      origin: parsed.origin,
      pathname: parsed.pathname,
    },
  });
}

function publishDesktopGoogleOption(): void {
  authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
    password: { enabled: false },
    oauthOptions: [
      {
        key: "google",
        label: "Continue with Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "desktop-google-client",
          identityProvider: "Google",
          prompt: "select_account",
        },
      },
    ],
  });
}

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
  authMocks.getAuthOptionSignInUrl.mockResolvedValue(
    "https://thinkwork-test.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=google-client",
  );
  authMocks.getLegacyIdentityMigrationStartUrl.mockReturnValue(
    "https://api.example.com/api/auth/workos/authorize?migration=1",
  );
  authMocks.isPasswordSignInConfigured.mockReturnValue(false);
  authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
    password: { enabled: true, clientId: "local-client" },
    oauthOptions: [],
  });
  routerMocks.search = { next: undefined, legacyMigration: undefined };
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
  it("never renders the legacy migration action on the normal sign-in route", async () => {
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: false },
      oauthOptions: [],
      legacyMigration: { authorizePath: "/api/auth/workos/authorize" },
    });

    render(<SignInPage />);

    await waitFor(() =>
      expect(authOptionsMocks.fetchPublicAuthOptions).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("button", { name: "Continue account migration" }),
    ).toBeNull();
  });

  it("renders the dedicated migration action only for an explicit coexistence entry", async () => {
    routerMocks.search = { next: "/new", legacyMigration: "workos" };
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [],
      legacyMigration: { authorizePath: "/api/auth/workos/authorize" },
    });
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

    render(<SignInPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue account migration" }),
    );

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(authMocks.getLegacyIdentityMigrationStartUrl).toHaveBeenCalledWith(
      "/api/auth/workos/authorize",
      "/new",
    );
    expect(navigations).toEqual([
      "https://api.example.com/api/auth/workos/authorize?migration=1",
    ]);
  });
  it("renders no browser OAuth button when public auth options are empty", () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(
      screen.getByRole("heading", { name: "Log in to ThinkWork" }),
    ).toBeTruthy();
    expect(screen.queryByText("Spaces")).toBeNull();
    expect(screen.getByText("Acme ThinkWork · dev · us-east-1")).toBeTruthy();
    // Trust plumbing (e.g. "Unsigned build-time fallback") must not leak
    // onto the end-user login page.
    expect(screen.queryByText("Unsigned build-time fallback")).toBeNull();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue with/i })).toBeNull();
    expect(screen.getByText("Sign-in options are unavailable.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Create one" })).toBeNull();
  });

  it("renders a single OAuth provider full-width (no two-column grid)", async () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: false },
      oauthOptions: [
        {
        key: "google",
        label: "Continue with Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "web-google-client",
          identityProvider: "Google",
          prompt: "select_account",
        },
      },
      ],
    });

    render(<SignInPage />);

    const googleButton = await screen.findByRole("button", {
      name: "Continue with Google",
    });
    expect(googleButton.parentElement?.className).not.toContain("grid-cols-2");
  });

  it("renders two OAuth providers in a two-column grid", async () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: false },
      oauthOptions: [
        {
        key: "google",
        label: "Continue with Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "web-google-client",
          identityProvider: "Google",
          prompt: "select_account",
        },
      },
        {
        key: "microsoft",
        label: "Continue with Microsoft",
        icon: "microsoft",
        provider: "microsoft",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "web-microsoft-client",
          identityProvider: "Microsoft",
          prompt: "select_account",
        },
      },
      ],
    });

    render(<SignInPage />);

    const googleButton = await screen.findByRole("button", {
      name: "Continue with Google",
    });
    expect(googleButton.parentElement?.className).toContain("grid-cols-2");
  });

  it("shows environment creation only on the central app host", () => {
    setWindowLocation("https://app.thinkwork.ai/sign-in");
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(
      screen.getByRole("link", { name: "Create one" }).getAttribute("href"),
    ).toBe("/onboarding/welcome");
  });

  it("hides environment creation on customer hosts", () => {
    setWindowLocation("https://mcpherson.thinkwork.ai/sign-in");
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.queryByText("Don't have an environment?")).toBeNull();
    expect(screen.queryByRole("link", { name: "Create one" })).toBeNull();
  });

  it("waits for auth restoration before enabling login", async () => {
    authContextMocks.useAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        {
          key: "google",
          label: "Continue with Google",
          icon: "google",
          provider: "google",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "google-client",
            identityProvider: "Google",
            prompt: "select_account",
          },
        },
      ],
    });

    render(<SignInPage />);

    expect(
      (
        (await screen.findByRole("button", {
          name: "Checking session",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("starts desktop OAuth with the sanitized next destination", async () => {
    const startOAuth = vi.fn().mockResolvedValue({
      url: "https://auth.example/oauth2/authorize?state=xyz",
      state: "xyz",
    });
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    publishDesktopGoogleOption();
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue({
      startOAuth,
      onOAuthError: () => () => {},
    });
    routerMocks.search = {
      next: "/automations/123",
      legacyMigration: undefined,
    };

    render(<SignInPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(startOAuth).toHaveBeenCalledWith({
        authOptionKey: "google",
        next: "/automations/123",
      }),
    );
  });

  it("renders draggable desktop chrome in the Electron sign-in shell", async () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    publishDesktopGoogleOption();
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(screen.getByRole("banner").textContent).toContain("ThinkWork");
    expect(
      await screen.findByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
  });

  it("shows incomplete packaged desktop configuration before OAuth starts", async () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    publishDesktopGoogleOption();
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
      (await screen.findByRole("button", {
        name: "Continue with Google",
      })) as HTMLButtonElement,
    ).toHaveProperty("disabled", true);
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
    expect(screen.queryByRole("link", { name: "Create one" })).toBeNull();
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

  it("uses the direct Google option from public auth options outside desktop mode", async () => {
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        {
          key: "google",
          label: "Continue with Google",
          icon: "google",
          provider: "google",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "google-client",
            identityProvider: "Google",
            prompt: "select_account",
          },
        },
      ],
    });
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
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(navigations).toEqual([
        "https://thinkwork-test.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=google-client",
      ]),
    );
    expect(authMocks.getAuthOptionSignInUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "google",
        route: {
          type: "cognitoHostedUi",
          clientId: "google-client",
          identityProvider: "Google",
          prompt: "select_account",
        },
      }),
      "/new",
    );
  });

  it("shows OAuth progress only on the provider being opened", async () => {
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        {
          key: "google",
          label: "Continue with Google",
          icon: "google",
          provider: "google",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "google-client",
            identityProvider: "Google",
            prompt: "select_account",
          },
        },
        {
          key: "microsoft",
          label: "Continue with Microsoft",
          icon: "microsoft",
          provider: "microsoft",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "microsoft-client",
            identityProvider: "MicrosoftOrganizations",
            prompt: "select_account",
          },
        },
      ],
    });
    authMocks.getAuthOptionSignInUrl.mockReturnValue(new Promise(() => {}));
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    const openingGoogle = await screen.findByRole("button", {
      name: "Opening Google",
    });
    expect(openingGoogle).toHaveProperty("disabled", true);
    expect(screen.getByRole("status", { name: "Opening Google" })).toBeTruthy();
    expect(openingGoogle.textContent).toBe("");
    expect(
      screen.getByRole("button", { name: "Continue with Microsoft" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.queryByRole("button", { name: "Opening Microsoft" }),
    ).toBeNull();
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
      VITE_RELEASE_VERSION: "v0.1.0-canary.379",
      VITE_STAGE: "tei-e2e",
      VITE_AWS_REGION: "us-east-1",
    });
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(
      screen.getByText("v0.1.0-canary.379 · tei-e2e · us-east-1"),
    ).toBeTruthy();
    expect(screen.getByText("Sign-in options are unavailable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
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
    expect(screen.getByText("Sign-in options are unavailable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
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

  it("renders the email/password form when password sign-in is configured", async () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);

    render(<SignInPage />);

    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue with/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("renders Google and Microsoft before password when native options are returned", async () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        {
          key: "google",
          label: "Continue with Google",
          icon: "google",
          provider: "google",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "google-client",
            identityProvider: "Google",
            prompt: "select_account",
          },
        },
        {
          key: "microsoft",
          label: "Continue with Microsoft",
          icon: "microsoft",
          provider: "microsoft",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "microsoft-client",
            identityProvider: "MicrosoftOrganizations",
            prompt: "select_account",
          },
        },
      ],
    });
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
    expect(
      await screen.findByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with Microsoft" }),
    ).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Microsoft")).toBeTruthy();
    expect(screen.getByText("or")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(navigations).toEqual([
        "https://thinkwork-test.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=google-client",
      ]),
    );
    expect(authMocks.getAuthOptionSignInUrl).toHaveBeenCalledWith(
      expect.any(Object),
      "/new",
    );
  });

  it("renders published email/password and OAuth options in the desktop shell", async () => {
    authMocks.isPasswordSignInConfigured.mockReturnValue(true);
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);
    authOptionsMocks.fetchPublicAuthOptions.mockResolvedValue({
      password: { enabled: true, clientId: "desktop-local-client" },
      oauthOptions: [
        {
          key: "microsoft",
          label: "Continue with Microsoft",
          icon: "microsoft",
          provider: "microsoft",
          providerSpecific: true,
          route: {
            type: "cognitoHostedUi",
            clientId: "desktop-microsoft-client",
            identityProvider: "MicrosoftOrganizations",
          },
        },
      ],
    });

    render(<SignInPage />);

    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with Microsoft" }),
    ).toBeTruthy();
  });
});
