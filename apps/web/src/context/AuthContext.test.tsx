import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenStorage } from "@/lib/token-storage";

const ORIGINAL_LOCATION = Object.getOwnPropertyDescriptor(window, "location");

vi.mock("@/lib/graphql-client", () => ({
  setAuthToken: vi.fn(),
  setTokenProvider: vi.fn(),
  startTokenRefresh: vi.fn(),
  stopTokenRefresh: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  storage: null as TokenStorage | null,
  getIdToken: vi.fn(async () => authMocks.storage?.getItem("idToken") ?? null),
  signOut: vi.fn(),
  clearLocalAuthSession: vi.fn(),
}));

const bindingMocks = vi.hoisted(() => ({
  bindingKey: "thinkwork.authDeploymentBinding.v2",
  storageKey: "thinkwork.authDeploymentProfileSha256.v1",
  ensureAuthStorageMatchesDeploymentProfile: vi.fn(() => true),
  markAuthStorageDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  configureTokenStorage(storage: TokenStorage) {
    authMocks.storage = storage;
  },
  getTokenStorage() {
    return authMocks.storage;
  },
  getIdToken: authMocks.getIdToken,
  getCurrentUser() {
    const email = authMocks.storage?.getItem("email");
    if (!email) return null;
    return { email, sub: "user-sub", groups: [] };
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signOut: authMocks.signOut,
  clearLocalAuthSession: authMocks.clearLocalAuthSession,
}));

vi.mock("@/lib/auth-deployment-binding", () => ({
  AUTH_DEPLOYMENT_BINDING_STORAGE_KEY: bindingMocks.bindingKey,
  AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY: bindingMocks.storageKey,
  ensureAuthStorageMatchesDeploymentProfile:
    bindingMocks.ensureAuthStorageMatchesDeploymentProfile,
  markAuthStorageDeploymentProfile:
    bindingMocks.markAuthStorageDeploymentProfile,
}));

afterEach(() => {
  cleanup();
  if (ORIGINAL_LOCATION) {
    Object.defineProperty(window, "location", ORIGINAL_LOCATION);
  }
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  vi.stubEnv("VITE_GRAPHQL_HTTP_URL", "https://api.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_URL", "https://appsync.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_WS_URL", "wss://appsync.example.com/graphql");
  vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");
  vi.stubEnv("VITE_DEPLOYMENT_ID", "thinkwork-dev");
  vi.stubEnv("VITE_DEPLOYMENT_DISPLAY_NAME", "ThinkWork Dev");
  vi.stubEnv("VITE_STAGE", "dev");
  vi.stubEnv("VITE_AWS_REGION", "us-east-1");
  authMocks.storage = null;
  authMocks.getIdToken.mockReset();
  authMocks.getIdToken.mockImplementation(
    async () => authMocks.storage?.getItem("idToken") ?? null,
  );
  authMocks.signOut.mockReset();
  authMocks.signOut.mockResolvedValue(undefined);
  authMocks.clearLocalAuthSession.mockReset();
  bindingMocks.ensureAuthStorageMatchesDeploymentProfile.mockReset();
  bindingMocks.ensureAuthStorageMatchesDeploymentProfile.mockReturnValue(true);
  bindingMocks.markAuthStorageDeploymentProfile.mockReset();
});

describe("AuthProvider", () => {
  it("does not restore stale cached auth during web sign-out", async () => {
    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage({
      ...sessionItems("user@example.com"),
      [bindingMocks.bindingKey]: "deployment-binding",
      [bindingMocks.storageKey]: "deployment-profile",
    });

    function Probe() {
      const { user, isLoading, signOut } = useAuth();
      return (
        <button onClick={signOut}>
          {isLoading ? "loading" : (user?.email ?? "anonymous")}
        </button>
      );
    }

    render(
      <AuthProvider tokenStorage={storage}>
        <Probe />
      </AuthProvider>,
    );
    const button = await screen.findByRole("button", {
      name: "user@example.com",
    });
    expect(authMocks.getIdToken).toHaveBeenCalledTimes(1);

    fireEvent.click(button);

    await waitFor(() => expect(button.textContent).toBe("anonymous"));
    await Promise.resolve();
    await Promise.resolve();

    expect(button.textContent).toBe("anonymous");
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
    expect(authMocks.getIdToken).toHaveBeenCalledTimes(1);
  });

  it("refuses to restore cached auth for a different deployment profile", async () => {
    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage({
      ...sessionItems("user@example.com"),
      [bindingMocks.storageKey]: "0".repeat(64),
    });
    bindingMocks.ensureAuthStorageMatchesDeploymentProfile.mockReturnValue(
      false,
    );

    function Probe() {
      const { user, isLoading } = useAuth();
      return <p>{isLoading ? "loading" : (user?.email ?? "anonymous")}</p>;
    }

    render(
      <AuthProvider tokenStorage={storage}>
        <Probe />
      </AuthProvider>,
    );

    await screen.findByText("anonymous");
    expect(authMocks.clearLocalAuthSession).toHaveBeenCalled();
  });

  it("times out a stuck session restore instead of leaving the shell loading", async () => {
    const restoreError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    authMocks.getIdToken.mockReturnValue(new Promise(() => undefined));

    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage(sessionItems("user@example.com"));

    function Probe() {
      const { user, isLoading } = useAuth();
      return <p>{isLoading ? "loading" : (user?.email ?? "anonymous")}</p>;
    }

    render(
      <AuthProvider tokenStorage={storage} sessionRestoreTimeoutMs={1}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText("loading")).toBeTruthy();

    await screen.findByText("anonymous");
    expect(restoreError).toHaveBeenCalledWith(
      "[auth] session restore failed",
      expect.any(Error),
    );
  });
});

function sessionItems(email: string): Record<string, string> {
  return {
    idToken: "id-token",
    email,
  };
}

class MemoryTokenStorage implements TokenStorage {
  hydrateCalls = 0;
  private items = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  constructor(items: Record<string, string> = {}) {
    this.replace(items);
  }

  async hydrate(): Promise<void> {
    this.hydrateCalls += 1;
  }

  replace(items: Record<string, string>): void {
    this.items = new Map(Object.entries(items));
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.emit();
  }

  removeItem(key: string): void {
    this.items.delete(key);
    this.emit();
  }

  clear(): void {
    this.items.clear();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
