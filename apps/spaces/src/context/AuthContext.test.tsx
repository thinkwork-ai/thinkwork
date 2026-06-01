import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";
import type { TokenStorage } from "@/lib/token-storage";

vi.mock("@/lib/graphql-client", () => ({
  setAuthToken: vi.fn(),
  setTokenProvider: vi.fn(),
  startTokenRefresh: vi.fn(),
  stopTokenRefresh: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  storage: null as TokenStorage | null,
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  configureTokenStorage(storage: TokenStorage) {
    authMocks.storage = storage;
  },
  getTokenStorage() {
    return authMocks.storage;
  },
  async getIdToken() {
    return authMocks.storage?.getItem("idToken") ?? null;
  },
  getCurrentUser() {
    const email = authMocks.storage?.getItem("email");
    if (!email) return null;
    return { email, sub: "user-sub", groups: [] };
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signOut: authMocks.signOut,
}));

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal("__DESKTOP_BUILD__", true);
  authMocks.storage = null;
  authMocks.signOut.mockReset();
});

describe("AuthProvider desktop mode", () => {
  it("hydrates desktop token storage on every mount", async () => {
    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage(sessionItems("user@example.com"));
    const bridge = makeBridge();

    function Probe() {
      const { user, isLoading } = useAuth();
      return <p>{isLoading ? "loading" : (user?.email ?? "anonymous")}</p>;
    }

    const first = render(
      <AuthProvider tokenStorage={storage} desktopBridge={bridge}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("user@example.com");
    first.unmount();

    render(
      <AuthProvider tokenStorage={storage} desktopBridge={bridge}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("user@example.com");

    expect(storage.hydrateCalls).toBe(2);
  });

  it("rehydrates when a desktop deep-link event arrives after mount", async () => {
    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage();
    const bridge = makeBridge();

    function Probe() {
      const { user, isLoading } = useAuth();
      return <p>{isLoading ? "loading" : (user?.email ?? "anonymous")}</p>;
    }

    render(
      <AuthProvider tokenStorage={storage} desktopBridge={bridge}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("anonymous");

    storage.replace(sessionItems("late@example.com"));
    bridge.emitDeepLink();

    await screen.findByText("late@example.com");
    expect(storage.hydrateCalls).toBe(2);
  });

  it("uses the desktop bridge for sign-out and clears local auth state", async () => {
    const { AuthProvider, useAuth } = await import("./AuthContext");
    const storage = new MemoryTokenStorage(sessionItems("user@example.com"));
    const bridge = makeBridge();

    function Probe() {
      const { user, isLoading, signOut } = useAuth();
      return (
        <button onClick={signOut}>
          {isLoading ? "loading" : (user?.email ?? "anonymous")}
        </button>
      );
    }

    render(
      <AuthProvider tokenStorage={storage} desktopBridge={bridge}>
        <Probe />
      </AuthProvider>,
    );
    const button = await screen.findByRole("button", {
      name: "user@example.com",
    });

    fireEvent.click(button);
    bridge.emitSignedOut();

    await waitFor(() => expect(button.textContent).toBe("anonymous"));
    expect(bridge.signOutCalls()).toBe(1);
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

function makeBridge(): ThinkworkBridge & {
  emitDeepLink(): void;
  emitSignedOut(): void;
  signOutCalls(): number;
} {
  let deepLinkListener: (() => void) | null = null;
  let signedOutListener: (() => void) | null = null;
  let signOutCalls = 0;

  return {
    async getSessionTokens() {
      return { items: {}, version: 0 };
    },
    async setTokenStorageItem() {},
    async removeTokenStorageItem() {},
    async clearTokenStorage() {},
    onTokensChanged() {
      return () => {};
    },
    async startOAuth() {
      return {
        url: "https://auth.example/oauth2/authorize?state=xyz",
        state: "xyz",
      };
    },
    async signOut() {
      signOutCalls += 1;
      return { ok: true, revokeFailed: false };
    },
    onSignedOut(listener) {
      signedOutListener = () => listener({ ok: true, revokeFailed: false });
      return () => {
        signedOutListener = null;
      };
    },
    async consumePendingOAuth() {
      return null;
    },
    onDeepLink(listener) {
      deepLinkListener = () => listener({ code: "code", state: "state" });
      return () => {
        deepLinkListener = null;
      };
    },
    onOAuthError() {
      return () => {};
    },
    async getDesktopConfig() {
      return {
        stage: "dev",
        configured: true,
        missing: [],
        oauthRedirectUri: "thinkwork-dev://oauth/callback",
        endpoints: {
          apiUrl: "https://api.example.com",
          graphqlHttpUrl: "https://api.example.com/graphql",
          graphqlUrl: "https://appsync.example.com/graphql",
          graphqlWsUrl: "wss://appsync.example.com/graphql",
          cognitoDomain: "https://auth.example.com",
        },
      };
    },
    async getUpdateState() {
      return {
        status: "disabled",
        currentVersion: "0.1.0",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        hostArch: "arm64",
        appArch: "arm64",
        runningUnderArm64Translation: false,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
        channel: "latest",
      };
    },
    async checkForUpdates() {},
    async downloadUpdate() {},
    async installUpdate() {},
    onUpdateState() {
      return () => {};
    },
    onUpdateTelemetry() {
      return () => {};
    },
    async reportInstallOutcome() {},
    async raiseThreadNotification() {},
    onOpenThread() {
      return () => {};
    },
    onWindowFocusChange() {
      return () => {};
    },
    async readWorkspaceTree() {
      return { status: "empty" as const };
    },
    async readWorkspaceFile() {
      return { status: "vanished" as const };
    },
    setNativeTheme() {},
    emitDeepLink() {
      deepLinkListener?.();
    },
    emitSignedOut() {
      signedOutListener?.();
    },
    signOutCalls() {
      return signOutCalls;
    },
  };
}
