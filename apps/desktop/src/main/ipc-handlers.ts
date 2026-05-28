import { BrowserWindow, app, ipcMain, safeStorage, shell } from "electron";
import { SafeStorageCognitoStorage } from "./cognito-storage.js";
import { registerAuthBridgeHandlers } from "./auth-bridge.js";
import {
  CHECK_FOR_UPDATES_CHANNEL,
  CANCEL_PI_TURN_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  GET_DESKTOP_CONFIG_CHANNEL,
  GET_PI_STATUS_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  START_PI_TURN_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT_CHANNEL,
  CheckForUpdatesRequestSchema,
  DownloadUpdateRequestSchema,
  GetDesktopConfigRequestSchema,
  GetPiStatusRequestSchema,
  GetUpdateStateRequestSchema,
  InstallUpdateRequestSchema,
  PiCancelTurnRequestSchema,
  PiStartTurnRequestSchema,
  ReportInstallOutcomeRequestSchema,
  assertSafeSenderFrame,
  type DeepLinkCallback,
} from "@thinkwork/desktop-ipc";
import type { DeepLinkDispatcher } from "./deep-link.js";
import { resolveDeepLinkScheme } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";
import { validateDesktopEnv } from "./env.js";
import type { DesktopMenuCommandHandlers } from "./menus.js";
import { DesktopOAuthController } from "./oauth.js";
import {
  createPiSidecarController,
  type PiSidecarController,
} from "./pi-sidecar-controller.js";
import { createDesktopUpdatesController } from "./updates.js";

export interface RegisterDesktopIpcHandlersOptions {
  env: DesktopEnvSnapshot;
  consumePendingOAuthDeepLink: () => DeepLinkCallback | null;
  markDeepLinkIpcReady: (dispatcher: DeepLinkDispatcher) => void;
  piSidecar?: PiSidecarController;
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
  const piSidecar = options.piSidecar ?? createPiSidecarController();
  piSidecar.start();

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
  ipcMain.handle(GET_PI_STATUS_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    GetPiStatusRequestSchema.parse(payload);
    return piSidecar.getStatus();
  });
  ipcMain.handle(START_PI_TURN_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    const request = PiStartTurnRequestSchema.parse(payload);
    return piSidecar.startTurn(request);
  });
  ipcMain.handle(CANCEL_PI_TURN_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    const request = PiCancelTurnRequestSchema.parse(payload);
    return piSidecar.cancelTurn(request);
  });

  app.on("before-quit", () => {
    void piSidecar.stop();
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
