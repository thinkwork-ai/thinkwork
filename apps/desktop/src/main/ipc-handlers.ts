import {
  BrowserWindow,
  app,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
} from "electron";
import {
  CHECK_FOR_UPDATES_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  GET_DESKTOP_CONFIG_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  IMPORT_DEPLOYMENT_PROFILE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  REMOVE_DEPLOYMENT_PROFILE_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  SET_NATIVE_THEME_CHANNEL,
  RAISE_THREAD_NOTIFICATION_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT_CHANNEL,
  CheckForUpdatesRequestSchema,
  DownloadUpdateRequestSchema,
  GetDesktopConfigRequestSchema,
  GetDesktopConfigResponseSchema,
  GetUpdateStateRequestSchema,
  ImportDeploymentProfileRequestSchema,
  ImportDeploymentProfileResponseSchema,
  InstallUpdateRequestSchema,
  ReportInstallOutcomeRequestSchema,
  RaiseThreadNotificationRequestSchema,
  RemoveDeploymentProfileRequestSchema,
  RemoveDeploymentProfileResponseSchema,
  assertSafeSenderFrame,
  type DeepLinkCallback,
} from "@thinkwork/desktop-ipc";
import { registerAuthBridgeHandlers } from "./auth-bridge.js";
import { SafeStorageCognitoStorage } from "./cognito-storage.js";
import { DesktopDeploymentProfileManager } from "./deployment-profile.js";
import { raiseThreadNotification } from "./notifications.js";
import type { DeepLinkDispatcher } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";
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
  const deploymentProfiles = new DesktopDeploymentProfileManager({
    app,
    env: options.env,
    logger: console,
  });
  const oauth = new DesktopOAuthController({
    env: () => deploymentProfiles.activeEnv(),
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

  const auth = registerAuthBridgeHandlers({
    ipcMain,
    storage,
    getWindows: () => BrowserWindow.getAllWindows(),
    consumePendingOAuth: options.consumePendingOAuthDeepLink,
    markDeepLinkReady: options.markDeepLinkIpcReady,
    oauth,
    logger: console,
  });

  // Sync the native window appearance to the app theme so macOS vibrancy
  // materials render light/dark to match (the in-app theme is renderer-owned;
  // without this the material follows the OS, muddying the light sidebar).
  ipcMain.on(SET_NATIVE_THEME_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    nativeTheme.themeSource = payload === "light" ? "light" : "dark";
  });

  ipcMain.handle(GET_DESKTOP_CONFIG_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    GetDesktopConfigRequestSchema.parse(payload);
    return GetDesktopConfigResponseSchema.parse(
      await deploymentProfiles.getDesktopConfig(),
    );
  });
  ipcMain.handle(IMPORT_DEPLOYMENT_PROFILE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    if (hasAuthenticatedSession(auth.snapshot().items)) {
      throw new Error("Sign out before changing deployment profiles.");
    }
    const request = ImportDeploymentProfileRequestSchema.parse(payload);
    const config = await deploymentProfiles.importProfileJson(request.json);
    auth.clearTokenStorage();
    return ImportDeploymentProfileResponseSchema.parse(config);
  });
  ipcMain.handle(REMOVE_DEPLOYMENT_PROFILE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    RemoveDeploymentProfileRequestSchema.parse(payload);
    if (hasAuthenticatedSession(auth.snapshot().items)) {
      throw new Error("Sign out before changing deployment profiles.");
    }
    const config = await deploymentProfiles.removeProfile();
    auth.clearTokenStorage();
    return RemoveDeploymentProfileResponseSchema.parse(config);
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
