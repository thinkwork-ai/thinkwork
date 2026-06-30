import {
  CLEAR_TOKEN_STORAGE_CHANNEL,
  CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT_CHANNEL,
  GET_SESSION_TOKENS_CHANNEL,
  OAUTH_ERROR_EVENT_CHANNEL,
  REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
  SIGN_OUT_CHANNEL,
  SIGNED_OUT_EVENT_CHANNEL,
  SET_TOKEN_STORAGE_ITEM_CHANNEL,
  START_OAUTH_CHANNEL,
  TOKENS_CHANGED_EVENT_CHANNEL,
  assertSafeSenderFrame,
  rateLimit,
  ClearTokenStorageRequestSchema,
  ConsumePendingOAuthRequestSchema,
  RemoveTokenStorageItemRequestSchema,
  SetTokenStorageItemRequestSchema,
  SignOutRequestSchema,
  StartOAuthRequestSchema,
  type DeepLinkCallback,
  type OAuthSuccessCallback,
  type PendingOAuthCallback,
  type SenderFrameEvent,
  type SignOutResponse,
  type StartOAuthRequest,
  type StartOAuthResponse,
  type TokenStorageSnapshot,
  type WorkosBridgeCallback,
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
  oauth?: OAuthBridgeController;
  now?: () => number;
  logger?: Pick<typeof console, "warn">;
}

export interface AuthBridgeState {
  snapshot(): TokenStorageSnapshot;
  clearTokenStorage(): void;
  signOut(): Promise<SignOutResponse>;
  onAuthStateChanged(listener: () => void): () => void;
}

export interface OAuthBridgeController {
  startOAuth(request?: StartOAuthRequest): Promise<StartOAuthResponse>;
  completeOAuthCallback(
    callback: OAuthSuccessCallback | WorkosBridgeCallback,
  ): Promise<PendingOAuthCallback>;
  signOut(session: SignOutSession): Promise<SignOutResponse>;
}

export interface SignOutSession {
  refreshToken: string | null;
  idToken: string | null;
  authSource: string | null;
}

export function registerAuthBridgeHandlers(
  options: RegisterAuthBridgeOptions,
): AuthBridgeState {
  let version = 0;
  const pendingCallbacks: PendingOAuthCallback[] = [];
  const authStateListeners = new Set<() => void>();
  const logger = options.logger ?? console;

  function snapshot(): TokenStorageSnapshot {
    return {
      items: options.storage.snapshot(),
      version,
    };
  }

  function broadcast(channel: string, payload: unknown): void {
    for (const window of options.getWindows()) {
      window.webContents.send(channel, payload);
    }
  }

  function broadcastTokensChanged(): void {
    broadcast(TOKENS_CHANGED_EVENT_CHANNEL, snapshot());
  }

  function notifyAuthStateChanged(): void {
    for (const listener of authStateListeners) {
      listener();
    }
  }

  function publishTokenStorageChange(): void {
    version += 1;
    broadcastTokensChanged();
    notifyAuthStateChanged();
  }

  async function acceptDeepLink(callback: DeepLinkCallback): Promise<void> {
    if ("type" in callback) {
      broadcast(DEEP_LINK_EVENT_CHANNEL, callback);
      return;
    }

    if ("error" in callback) {
      const message = formatOAuthError(callback);
      logger.warn("[desktop:auth-bridge] OAuth returned an error", message);
      broadcast(OAUTH_ERROR_EVENT_CHANNEL, { message });
      return;
    }

    if (options.oauth) {
      try {
        const pending = await options.oauth.completeOAuthCallback(callback);
        pendingCallbacks.push(pending);
        publishTokenStorageChange();
        broadcast(DEEP_LINK_EVENT_CHANNEL, callback);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[desktop:auth-bridge] OAuth callback failed", error);
        broadcast(OAUTH_ERROR_EVENT_CHANNEL, { message });
      }
      return;
    }

    pendingCallbacks.push(callback);
    broadcast(DEEP_LINK_EVENT_CHANNEL, callback);
  }

  async function signOut(): Promise<SignOutResponse> {
    rateLimit({
      key: SIGN_OUT_CHANNEL,
      intervalMs: 2_000,
      now: options.now,
    });
    const signOutSession = currentSignOutSession(options.storage.snapshot());
    options.storage.clear();
    publishTokenStorageChange();
    const result = options.oauth
      ? await options.oauth.signOut(signOutSession)
      : { ok: true as const, revokeFailed: false };
    broadcast(SIGNED_OUT_EVENT_CHANNEL, result);
    return result;
  }

  options.markDeepLinkReady((callback) => {
    void acceptDeepLink(callback);
  });

  options.ipcMain.handle(GET_SESSION_TOKENS_CHANNEL, (event) => {
    assertSafeSenderFrame(event);
    return snapshot();
  });

  options.ipcMain.handle(SET_TOKEN_STORAGE_ITEM_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    const request = SetTokenStorageItemRequestSchema.parse(payload);
    options.storage.setItem(request.key, request.value);
    publishTokenStorageChange();
  });

  options.ipcMain.handle(
    REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
    (event, payload) => {
      assertSafeSenderFrame(event);
      const request = RemoveTokenStorageItemRequestSchema.parse(payload);
      options.storage.removeItem(request.key);
      publishTokenStorageChange();
    },
  );

  options.ipcMain.handle(CLEAR_TOKEN_STORAGE_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    ClearTokenStorageRequestSchema.parse(payload);
    options.storage.clear();
    publishTokenStorageChange();
  });

  options.ipcMain.handle(START_OAUTH_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    const request = StartOAuthRequestSchema.parse(payload);
    rateLimit({
      key: START_OAUTH_CHANNEL,
      intervalMs: 2_000,
      now: options.now,
    });
    if (!options.oauth) {
      throw new Error("OAuth is not configured");
    }
    return options.oauth.startOAuth(request);
  });

  options.ipcMain.handle(SIGN_OUT_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    SignOutRequestSchema.parse(payload);
    return signOut();
  });

  options.ipcMain.handle(CONSUME_PENDING_OAUTH_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    ConsumePendingOAuthRequestSchema.parse(payload);
    return pendingCallbacks.shift() ?? options.consumePendingOAuth();
  });

  return {
    snapshot,
    clearTokenStorage() {
      options.storage.clear();
      publishTokenStorageChange();
    },
    signOut,
    onAuthStateChanged(listener) {
      authStateListeners.add(listener);
      return () => authStateListeners.delete(listener);
    },
  };
}

function formatOAuthError(callback: {
  error: string;
  errorDescription?: string;
}): string {
  const description = callback.errorDescription?.trim();
  if (description) return `${callback.error}: ${description}`;
  return callback.error;
}

function currentSignOutSession(items: Record<string, string>): SignOutSession {
  const lastAuthUserEntry = Object.entries(items).find(([key]) =>
    key.endsWith(".LastAuthUser"),
  );
  if (!lastAuthUserEntry) {
    return {
      authSource: items["thinkwork:auth-source"] ?? null,
      idToken: null,
      refreshToken: null,
    };
  }

  const [lastAuthUserKey, username] = lastAuthUserEntry;
  const prefix = lastAuthUserKey.slice(0, -".LastAuthUser".length);
  return {
    authSource: items["thinkwork:auth-source"] ?? null,
    idToken: items[`${prefix}.${username}.idToken`] ?? null,
    refreshToken: items[`${prefix}.${username}.refreshToken`] ?? null,
  };
}
