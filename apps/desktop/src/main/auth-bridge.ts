import {
  CLEAR_TOKEN_STORAGE_CHANNEL,
  CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT_CHANNEL,
  GET_SESSION_TOKENS_CHANNEL,
  REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
  SIGN_OUT_CHANNEL,
  SET_TOKEN_STORAGE_ITEM_CHANNEL,
  TOKENS_CHANGED_EVENT_CHANNEL,
  assertSafeSenderFrame,
  rateLimit,
  ClearTokenStorageRequestSchema,
  ConsumePendingOAuthRequestSchema,
  RemoveTokenStorageItemRequestSchema,
  SetTokenStorageItemRequestSchema,
  SignOutRequestSchema,
  type DeepLinkCallback,
  type SenderFrameEvent,
  type TokenStorageSnapshot,
} from "@thinkwork/desktop-ipc";
import type { ICognitoStorage } from "./cognito-storage.js";
import type { DeepLinkDispatcher } from "./deep-link.js";

export interface TokenSnapshotStorage extends ICognitoStorage {
  snapshot(): Record<string, string>;
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: SenderFrameEvent, payload?: unknown) => unknown,
  ): void;
}

export interface WebContentsLike {
  send(channel: string, payload: unknown): void;
}

export interface BrowserWindowLike {
  webContents: WebContentsLike;
}

export interface RegisterAuthBridgeOptions {
  ipcMain: IpcMainLike;
  storage: TokenSnapshotStorage;
  getWindows: () => BrowserWindowLike[];
  consumePendingOAuth: () => DeepLinkCallback | null;
  markDeepLinkReady: (dispatcher: DeepLinkDispatcher) => void;
  now?: () => number;
}

export interface AuthBridgeState {
  snapshot(): TokenStorageSnapshot;
}

export function registerAuthBridgeHandlers(
  options: RegisterAuthBridgeOptions,
): AuthBridgeState {
  let version = 0;
  const pendingCallbacks: DeepLinkCallback[] = [];

  function snapshot(): TokenStorageSnapshot {
    return {
      items: options.storage.snapshot(),
      version,
    };
  }

  function broadcastTokensChanged(): void {
    const payload = snapshot();
    for (const window of options.getWindows()) {
      window.webContents.send(TOKENS_CHANGED_EVENT_CHANNEL, payload);
    }
  }

  function acceptDeepLink(callback: DeepLinkCallback): void {
    pendingCallbacks.push(callback);
    for (const window of options.getWindows()) {
      window.webContents.send(DEEP_LINK_EVENT_CHANNEL, callback);
    }
  }

  options.markDeepLinkReady(acceptDeepLink);

  options.ipcMain.handle(GET_SESSION_TOKENS_CHANNEL, (event) => {
    assertSafeSenderFrame(event);
    return snapshot();
  });

  options.ipcMain.handle(SET_TOKEN_STORAGE_ITEM_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    const request = SetTokenStorageItemRequestSchema.parse(payload);
    options.storage.setItem(request.key, request.value);
    version += 1;
    broadcastTokensChanged();
  });

  options.ipcMain.handle(
    REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
    (event, payload) => {
      assertSafeSenderFrame(event);
      const request = RemoveTokenStorageItemRequestSchema.parse(payload);
      options.storage.removeItem(request.key);
      version += 1;
      broadcastTokensChanged();
    },
  );

  options.ipcMain.handle(CLEAR_TOKEN_STORAGE_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    ClearTokenStorageRequestSchema.parse(payload);
    options.storage.clear();
    version += 1;
    broadcastTokensChanged();
  });

  options.ipcMain.handle(SIGN_OUT_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    SignOutRequestSchema.parse(payload);
    rateLimit({
      key: SIGN_OUT_CHANNEL,
      intervalMs: 500,
      now: options.now,
    });
    options.storage.clear();
    version += 1;
    broadcastTokensChanged();
  });

  options.ipcMain.handle(CONSUME_PENDING_OAUTH_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    ConsumePendingOAuthRequestSchema.parse(payload);
    return pendingCallbacks.shift() ?? options.consumePendingOAuth();
  });

  return { snapshot };
}
