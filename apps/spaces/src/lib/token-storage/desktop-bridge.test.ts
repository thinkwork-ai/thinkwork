import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ThinkworkBridge,
  TokenStorageSnapshot,
} from "@thinkwork/desktop-ipc";
import { DesktopBridgeTokenStorage } from "./desktop-bridge";

function makeBridge(
  initial: TokenStorageSnapshot | null = null,
): ThinkworkBridge & {
  emitTokensChanged(snapshot: TokenStorageSnapshot): void;
  getSessionTokensCalls: () => number;
} {
  let snapshot = initial;
  let listener: ((tokens: TokenStorageSnapshot) => void) | null = null;
  let getSessionTokensCalls = 0;

  return {
    async getSessionTokens() {
      getSessionTokensCalls += 1;
      return snapshot;
    },
    async setTokenStorageItem(request) {
      snapshot = {
        items: { ...(snapshot?.items ?? {}), [request.key]: request.value },
        version: (snapshot?.version ?? 0) + 1,
      };
    },
    async removeTokenStorageItem(request) {
      const items = { ...(snapshot?.items ?? {}) };
      delete items[request.key];
      snapshot = { items, version: (snapshot?.version ?? 0) + 1 };
    },
    async clearTokenStorage() {
      snapshot = { items: {}, version: (snapshot?.version ?? 0) + 1 };
    },
    onTokensChanged(nextListener) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    async startOAuth() {
      return {
        url: "https://auth.example/oauth2/authorize?state=xyz",
        state: "xyz",
      };
    },
    async signOut() {
      return { ok: true, revokeFailed: false };
    },
    onSignedOut() {
      return () => {};
    },
    async consumePendingOAuth() {
      return null;
    },
    onDeepLink() {
      return () => {};
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
    emitTokensChanged(nextSnapshot) {
      snapshot = nextSnapshot;
      listener?.(nextSnapshot);
    },
    getSessionTokensCalls: () => getSessionTokensCalls,
  };
}

describe("DesktopBridgeTokenStorage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates cache from the bridge on every mount", async () => {
    const bridge = makeBridge({
      items: { token: "one" },
      version: 1,
    });
    const storage = new DesktopBridgeTokenStorage(bridge);

    await storage.hydrate();
    await storage.hydrate();

    expect(storage.getItem("token")).toBe("one");
    expect(bridge.getSessionTokensCalls()).toBe(2);
  });

  it("updates from token change broadcasts", async () => {
    const bridge = makeBridge({ items: { token: "one" }, version: 1 });
    const storage = new DesktopBridgeTokenStorage(bridge);
    const listener = vi.fn();
    storage.subscribe(listener);
    await storage.hydrate();

    bridge.emitTokensChanged({ items: { token: "two" }, version: 2 });

    expect(storage.getItem("token")).toBe("two");
    expect(listener).toHaveBeenCalled();
  });

  it("rehydrates when a version gap indicates a missed broadcast", async () => {
    const bridge = makeBridge({ items: { token: "one" }, version: 5 });
    const storage = new DesktopBridgeTokenStorage(bridge);
    await storage.hydrate();

    bridge.emitTokensChanged({ items: { token: "latest" }, version: 7 });
    await vi.waitFor(() => expect(storage.getItem("token")).toBe("latest"));

    expect(bridge.getSessionTokensCalls()).toBe(2);
  });

  it("updates the local cache synchronously and persists mutations through the bridge", async () => {
    const bridge = makeBridge({ items: {}, version: 0 });
    const setSpy = vi.spyOn(bridge, "setTokenStorageItem");
    const storage = new DesktopBridgeTokenStorage(bridge);

    storage.setItem("token", "value");

    expect(storage.getItem("token")).toBe("value");
    expect(setSpy).toHaveBeenCalledWith({ key: "token", value: "value" });
  });

  it("clears the cache when the bridge returns no tokens", async () => {
    const bridge = makeBridge(null);
    const storage = new DesktopBridgeTokenStorage(bridge);

    await storage.hydrate();

    expect(storage.getItem("token")).toBeNull();
  });
});
