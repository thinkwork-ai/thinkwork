import { BrowserWindow, app, ipcMain, safeStorage, shell } from "electron";
import { SafeStorageCognitoStorage } from "./cognito-storage.js";
import {
  registerAuthBridgeHandlers,
  type AuthBridgeState,
} from "./auth-bridge.js";
import type { DeepLinkCallback } from "@thinkwork/desktop-ipc";
import type { DeepLinkDispatcher } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";
import { DesktopOAuthController } from "./oauth.js";

export interface RegisterDesktopIpcHandlersOptions {
  env: DesktopEnvSnapshot;
  consumePendingOAuthDeepLink: () => DeepLinkCallback | null;
  markDeepLinkIpcReady: (dispatcher: DeepLinkDispatcher) => void;
}

export async function registerDesktopIpcHandlers(
  options: RegisterDesktopIpcHandlersOptions,
): Promise<AuthBridgeState> {
  const storage = await SafeStorageCognitoStorage.create({
    app,
    safeStorage,
    logger: console,
  });
  const oauth = new DesktopOAuthController({
    env: options.env,
    storage,
    app,
    shell,
    logger: console,
  });

  await oauth.drainPendingRevocations();
  app.on("before-quit", () => {
    oauth.dispose();
  });

  return registerAuthBridgeHandlers({
    ipcMain,
    storage,
    getWindows: () => BrowserWindow.getAllWindows(),
    consumePendingOAuth: options.consumePendingOAuthDeepLink,
    markDeepLinkReady: options.markDeepLinkIpcReady,
    oauth,
    logger: console,
  });
}
