import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_TOKEN_STORAGE_CHANNEL,
  CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT_CHANNEL,
  GET_SESSION_TOKENS_CHANNEL,
  OAUTH_ERROR_EVENT_CHANNEL,
  START_OAUTH_CHANNEL,
  REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
  SIGN_OUT_CHANNEL,
  SIGNED_OUT_EVENT_CHANNEL,
  SET_TOKEN_STORAGE_ITEM_CHANNEL,
  TOKENS_CHANGED_EVENT_CHANNEL,
  resetRateLimits,
  type DeepLinkCallback,
} from "@thinkwork/desktop-ipc";
import {
  registerAuthBridgeHandlers,
  type IpcMainLike,
  type TokenSnapshotStorage,
} from "../../src/main/auth-bridge";

const trustedEvent = {
  senderFrame: { url: "thinkwork://app/" },
};

function createIpcMain(): IpcMainLike & {
  invoke(channel: string, payload?: unknown, event?: unknown): unknown;
} {
  const handlers = new Map<
    string,
    (event: never, payload?: unknown) => unknown
  >();

  return {
    handle(channel, listener) {
      handlers.set(channel, listener as never);
    },
    invoke(channel, payload, event = trustedEvent) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`missing handler for ${channel}`);
      return handler(event as never, payload);
    },
  };
}

function createStorage(
  initial: Record<string, string> = {},
): TokenSnapshotStorage {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      return value;
    },
    removeItem: (key) => {
      values.delete(key);
      return true;
    },
    clear: () => {
      values.clear();
      return {};
    },
    snapshot: () => Object.fromEntries(values),
  };
}

describe("auth bridge handlers", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("returns the current token storage snapshot", () => {
    const ipcMain = createIpcMain();
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage({ token: "value" }),
      getWindows: () => [],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
    });

    expect(ipcMain.invoke(GET_SESSION_TOKENS_CHANNEL)).toEqual({
      items: { token: "value" },
      version: 0,
    });
  });

  it("persists storage mutations and broadcasts versioned snapshots", () => {
    const ipcMain = createIpcMain();
    const sent = vi.fn();
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [{ webContents: { send: sent } }],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
    });

    ipcMain.invoke(SET_TOKEN_STORAGE_ITEM_CHANNEL, {
      key: "token",
      value: "value",
    });
    ipcMain.invoke(REMOVE_TOKEN_STORAGE_ITEM_CHANNEL, { key: "token" });
    ipcMain.invoke(CLEAR_TOKEN_STORAGE_CHANNEL);

    expect(sent).toHaveBeenNthCalledWith(1, TOKENS_CHANGED_EVENT_CHANNEL, {
      items: { token: "value" },
      version: 1,
    });
    expect(sent).toHaveBeenNthCalledWith(2, TOKENS_CHANGED_EVENT_CHANNEL, {
      items: {},
      version: 2,
    });
    expect(sent).toHaveBeenNthCalledWith(3, TOKENS_CHANGED_EVENT_CHANNEL, {
      items: {},
      version: 3,
    });
  });

  it("queues deep links and lets the renderer consume them", () => {
    const ipcMain = createIpcMain();
    const dispatchers: Array<(callback: DeepLinkCallback) => void> = [];
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [],
      consumePendingOAuth: () => null,
      markDeepLinkReady: (nextDispatcher) => {
        dispatchers.push(nextDispatcher);
      },
    });

    dispatchers[0]?.({ code: "abc", state: "xyz" });

    expect(ipcMain.invoke(CONSUME_PENDING_OAUTH_CHANNEL)).toEqual({
      code: "abc",
      state: "xyz",
    });
  });

  it("broadcasts OAuth error callbacks without attempting token exchange", () => {
    const ipcMain = createIpcMain();
    const sent = vi.fn();
    const completeOAuthCallback = vi.fn();
    const dispatchers: Array<(callback: DeepLinkCallback) => void> = [];
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [{ webContents: { send: sent } }],
      consumePendingOAuth: () => null,
      markDeepLinkReady: (nextDispatcher) => {
        dispatchers.push(nextDispatcher);
      },
      oauth: {
        startOAuth: vi.fn(),
        completeOAuthCallback,
        signOut: vi.fn(),
      },
    });

    dispatchers[0]?.({
      error: "invalid_request",
      errorDescription: "Bad redirect",
      state: "xyz",
    });

    expect(completeOAuthCallback).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledWith(OAUTH_ERROR_EVENT_CHANNEL, {
      message: "invalid_request: Bad redirect",
    });
  });

  it("broadcasts deployment profile deep links without OAuth exchange", () => {
    const ipcMain = createIpcMain();
    const sent = vi.fn();
    const completeOAuthCallback = vi.fn();
    const dispatchers: Array<(callback: DeepLinkCallback) => void> = [];
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [{ webContents: { send: sent } }],
      consumePendingOAuth: () => null,
      markDeepLinkReady: (nextDispatcher) => {
        dispatchers.push(nextDispatcher);
      },
      oauth: {
        startOAuth: vi.fn(),
        completeOAuthCallback,
        signOut: vi.fn(),
      },
    });

    dispatchers[0]?.({
      type: "deployment-profile",
      json: '{"schemaVersion":1}',
    });

    expect(completeOAuthCallback).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledWith(DEEP_LINK_EVENT_CHANNEL, {
      type: "deployment-profile",
      json: '{"schemaVersion":1}',
    });
    expect(ipcMain.invoke(CONSUME_PENDING_OAUTH_CHANNEL)).toBeNull();
  });

  it("rejects untrusted sender frames", () => {
    const ipcMain = createIpcMain();
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
    });

    expect(() =>
      ipcMain.invoke(GET_SESSION_TOKENS_CHANNEL, undefined, {
        senderFrame: { url: "https://evil.example/" },
      }),
    ).toThrow(/untrusted sender frame/);
  });

  it("delegates startOAuth through the guarded IPC handler", async () => {
    const ipcMain = createIpcMain();
    const startOAuth = vi.fn(async () => ({
      url: "https://auth.example/oauth2/authorize?state=xyz",
      state: "xyz",
    }));
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage(),
      getWindows: () => [],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
      oauth: {
        startOAuth,
        completeOAuthCallback: vi.fn(),
        signOut: vi.fn(),
      },
    });

    await expect(
      ipcMain.invoke(START_OAUTH_CHANNEL, { next: "/automations/123" }),
    ).resolves.toEqual({
      url: "https://auth.example/oauth2/authorize?state=xyz",
      state: "xyz",
    });
    expect(startOAuth).toHaveBeenCalledWith({ next: "/automations/123" });
  });

  it("clears local storage before revoking during sign-out", async () => {
    const ipcMain = createIpcMain();
    const sent = vi.fn();
    const signOut = vi.fn(async () => ({
      ok: true as const,
      revokeFailed: false,
    }));
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage({
        "thinkwork:auth-source": "workos",
        "CognitoIdentityServiceProvider.client.LastAuthUser": "user-id",
        "CognitoIdentityServiceProvider.client.user-id.idToken": "id-token",
        "CognitoIdentityServiceProvider.client.user-id.refreshToken":
          "refresh-token",
      }),
      getWindows: () => [{ webContents: { send: sent } }],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
      oauth: {
        startOAuth: vi.fn(),
        completeOAuthCallback: vi.fn(),
        signOut,
      },
    });

    await expect(ipcMain.invoke(SIGN_OUT_CHANNEL)).resolves.toEqual({
      ok: true,
      revokeFailed: false,
    });

    expect(signOut).toHaveBeenCalledWith({
      authSource: "workos",
      idToken: "id-token",
      refreshToken: "refresh-token",
    });
    expect(sent).toHaveBeenNthCalledWith(1, TOKENS_CHANGED_EVENT_CHANNEL, {
      items: {},
      version: 1,
    });
    expect(sent).toHaveBeenNthCalledWith(2, SIGNED_OUT_EVENT_CHANNEL, {
      ok: true,
      revokeFailed: false,
    });
  });

  it("rate limits sign-out requests", async () => {
    const ipcMain = createIpcMain();
    registerAuthBridgeHandlers({
      ipcMain,
      storage: createStorage({ token: "value" }),
      getWindows: () => [],
      consumePendingOAuth: () => null,
      markDeepLinkReady: () => {},
      now: () => 1_000,
    });

    await ipcMain.invoke(SIGN_OUT_CHANNEL);

    await expect(ipcMain.invoke(SIGN_OUT_CHANNEL)).rejects.toThrow(
      /Rate limit/,
    );
  });
});
