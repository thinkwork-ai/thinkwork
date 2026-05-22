import { BrowserWindow, app, ipcMain, safeStorage } from "electron";
import { SafeStorageCognitoStorage } from "./cognito-storage.js";
import {
  registerAuthBridgeHandlers,
  type AuthBridgeState,
} from "./auth-bridge.js";
import type { DeepLinkCallback } from "@thinkwork/desktop-ipc";
import type { DeepLinkDispatcher } from "./deep-link.js";

export interface RegisterDesktopIpcHandlersOptions {
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

  return registerAuthBridgeHandlers({
    ipcMain,
    storage,
    getWindows: () => BrowserWindow.getAllWindows(),
    consumePendingOAuth: options.consumePendingOAuthDeepLink,
    markDeepLinkReady: options.markDeepLinkIpcReady,
  });
}
