import { BrowserWindow, app, ipcMain, safeStorage, shell } from "electron";
import { join } from "node:path";
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
  PREWARM_PI_WORKSPACE_CHANNEL,
  READ_WORKSPACE_FILE_CHANNEL,
  READ_WORKSPACE_TREE_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  START_PI_TURN_CHANNEL,
  RAISE_THREAD_NOTIFICATION_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT_CHANNEL,
  CheckForUpdatesRequestSchema,
  DownloadUpdateRequestSchema,
  GetDesktopConfigRequestSchema,
  GetPiStatusRequestSchema,
  GetUpdateStateRequestSchema,
  InstallUpdateRequestSchema,
  PiCancelTurnRequestSchema,
  PiPrewarmWorkspaceRequestSchema,
  PiStartTurnRequestSchema,
  ReadWorkspaceFileRequestSchema,
  ReadWorkspaceTreeRequestSchema,
  ReportInstallOutcomeRequestSchema,
  RaiseThreadNotificationRequestSchema,
  assertSafeSenderFrame,
  rateLimit,
  type DeepLinkCallback,
} from "@thinkwork/desktop-ipc";
import { WORKSPACE_CACHE_DIRNAME } from "../sidecar/workspace-cache.js";
import {
  readCacheFile,
  resolveCacheRoot,
  walkCacheTree,
} from "./workspace-cache-reader.js";
import { raiseThreadNotification } from "./notifications.js";
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
import {
  createPiSidecarDiagnostics,
  disabledPiSidecarState,
} from "./pi-sidecar-diagnostics.js";
import {
  createPiRuntimeSessionPreparer,
  createPiWorkspacePrewarmPreparer,
} from "./pi-runtime-session-client.js";
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
  const piDiagnostics = createPiSidecarDiagnostics({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
    stage: options.env.stage,
    runtimeEnabled: options.env.desktopLocalPiEnabled,
    hostType: app.isPackaged ? "packaged" : "development",
  });
  piDiagnostics.logger.info("desktop local pi runtime configured", {
    runtimeEnabled: options.env.desktopLocalPiEnabled,
    stage: options.env.stage,
    hostType: app.isPackaged ? "packaged" : "development",
  });
  const piSidecar =
    options.piSidecar ??
    (options.env.desktopLocalPiEnabled
      ? createPiSidecarController({
          prepareTurn: createPiRuntimeSessionPreparer({
            env: options.env,
            tokenSnapshot: () => storage.snapshot(),
          }),
          prepareWorkspacePrewarm: createPiWorkspacePrewarmPreparer({
            env: options.env,
            tokenSnapshot: () => storage.snapshot(),
          }),
          workspaceCacheRoot: join(
            app.getPath("userData"),
            WORKSPACE_CACHE_DIRNAME,
          ),
          logger: piDiagnostics.logger,
        })
      : null);
  piSidecar?.start();

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
    return piSidecar?.getStatus() ?? disabledPiSidecarState();
  });
  ipcMain.handle(START_PI_TURN_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    const request = PiStartTurnRequestSchema.parse(payload);
    if (!piSidecar) {
      throw new Error("Desktop local Pi is disabled for this stage");
    }
    return piSidecar.startTurn(request);
  });
  ipcMain.handle(PREWARM_PI_WORKSPACE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    const request = PiPrewarmWorkspaceRequestSchema.parse(payload);
    if (!piSidecar) {
      throw new Error("Desktop local Pi is disabled for this stage");
    }
    return piSidecar.prewarmWorkspace(request);
  });
  ipcMain.handle(CANCEL_PI_TURN_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    const request = PiCancelTurnRequestSchema.parse(payload);
    return piSidecar?.cancelTurn(request) ?? { cancelled: false };
  });
  ipcMain.handle(RAISE_THREAD_NOTIFICATION_CHANNEL, (event, payload) => {
    assertSafeSenderFrame(event);
    raiseThreadNotification(
      RaiseThreadNotificationRequestSchema.parse(payload),
    );
  });
  ipcMain.handle(READ_WORKSPACE_TREE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    ReadWorkspaceTreeRequestSchema.parse(payload);
    return walkCacheTree(resolveCacheRoot(app));
  });
  ipcMain.handle(READ_WORKSPACE_FILE_CHANNEL, async (event, payload) => {
    assertSafeSenderFrame(event);
    const request = ReadWorkspaceFileRequestSchema.parse(payload);
    rateLimit({ key: "read-workspace-file", intervalMs: 50 });
    return readCacheFile(resolveCacheRoot(app), request.path);
  });

  app.on("before-quit", () => {
    void piSidecar?.stop();
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
