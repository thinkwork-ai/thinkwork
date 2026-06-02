import {
  BrowserWindow,
  app,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
} from "electron";
import { join } from "node:path";
import { SafeStorageCognitoStorage } from "./cognito-storage.js";
import { registerAuthBridgeHandlers } from "./auth-bridge.js";
import {
  CHECK_FOR_UPDATES_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  GET_DESKTOP_CONFIG_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  SET_NATIVE_THEME_CHANNEL,
  RAISE_THREAD_NOTIFICATION_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT_CHANNEL,
  CheckForUpdatesRequestSchema,
  DownloadUpdateRequestSchema,
  GetDesktopConfigRequestSchema,
  GetUpdateStateRequestSchema,
  InstallUpdateRequestSchema,
  ReportInstallOutcomeRequestSchema,
  RaiseThreadNotificationRequestSchema,
  assertSafeSenderFrame,
  type DeepLinkCallback,
} from "@thinkwork/desktop-ipc";
import { raiseThreadNotification } from "./notifications.js";
import type { DeepLinkDispatcher } from "./deep-link.js";
import { resolveDeepLinkScheme } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";
import { validateDesktopEnv } from "./env.js";
import type { DesktopMenuCommandHandlers } from "./menus.js";
import { DesktopOAuthController } from "./oauth.js";
import { createDesktopUpdatesController } from "./updates.js";

export interface RegisterDesktopIpcHandlersOptions {
  env: DesktopEnvSnapshot;
  consumePendingOAuthDeepLink: () => DeepLinkCallback | null;
  markDeepLinkIpcReady: (dispatcher: DeepLinkDispatcher) => void;
}

export async function registerDesktopIpcHandlers(
  options: RegisterDesktopIpcHandlersOptions,
): Promise<DesktopMenuCommandHandlers> {
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
  const updates = await createDesktopUpdatesController({
    app,
    onStateChange: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(UPDATE_STATE_EVENT_CHANNEL, state);
      }
    },
    onTelemetry: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(UPDATE_TELEMETRY_EVENT_CHANNEL, event);
      }
    },
    logger: console,
  });
  await updates.start();

  // Sync the native window appearance to the app theme so macOS vibrancy
  // materials render light/dark to match (the in-app theme is renderer-owned;
  // without this the material follows the OS, muddying the light sidebar).
  ipcMain.on(SET_NATIVE_THEME_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    nativeTheme.themeSource = payload === "light" ? "light" : "dark";
  });

  ipcMain.handle(GET_DESKTOP_CONFIG_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    GetDesktopConfigRequestSchema.parse(payload);
    const validation = validateDesktopEnv(options.env);
    const deepLinkScheme = resolveDeepLinkScheme(
      options.env.deepLinkScheme ?? options.env.stage,
    );
    return {
      stage: options.env.stage,
      configured: validation.configured,
      missing: validation.missing,
      oauthRedirectUri: `${deepLinkScheme}://oauth/callback`,
      endpoints: {
        apiUrl: options.env.apiUrl,
        graphqlHttpUrl: options.env.graphqlHttpUrl,
        graphqlUrl: options.env.graphqlUrl,
        graphqlWsUrl: options.env.graphqlWsUrl,
        cognitoDomain: options.env.cognito.domain,
      },
    };
  });
  ipcMain.handle(GET_UPDATE_STATE_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    GetUpdateStateRequestSchema.parse(payload);
    return updates.getState();
  });
  ipcMain.handle(CHECK_FOR_UPDATES_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    CheckForUpdatesRequestSchema.parse(payload);
    await updates.checkForUpdates();
  });
  ipcMain.handle(DOWNLOAD_UPDATE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    DownloadUpdateRequestSchema.parse(payload);
    await updates.downloadUpdate();
  });
  ipcMain.handle(INSTALL_UPDATE_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    InstallUpdateRequestSchema.parse(payload);
    updates.installUpdate();
  });
  ipcMain.handle(REPORT_INSTALL_OUTCOME_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    const outcome = ReportInstallOutcomeRequestSchema.parse(payload);
    await updates.reportInstallOutcome(outcome);
  });
  ipcMain.handle(RAISE_THREAD_NOTIFICATION_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    raiseThreadNotification(
      RaiseThreadNotificationRequestSchema.parse(payload),
    );
  });

  app.on("before-quit", () => {
    updates.dispose();
    oauth.dispose();
  });

  const auth = registerAuthBridgeHandlers({
    ipcMain,
    storage,
    getWindows: () => BrowserWindow.getAllWindows(),
    consumePendingOAuth: options.consumePendingOAuthDeepLink,
    markDeepLinkReady: options.markDeepLinkIpcReady,
    oauth,
    logger: console,
  });

  return {
    checkForUpdates: () => updates.checkForUpdates(),
    signOut: () => auth.signOut(),
    isAuthenticated: () => hasAuthenticatedSession(auth.snapshot().items),
    onAuthenticationChanged: (listener) => auth.onAuthStateChanged(listener),
  };
}

function hasAuthenticatedSession(items: Record<string, string>): boolean {
  return Object.keys(items).some((key) => key.endsWith(".LastAuthUser"));
}
