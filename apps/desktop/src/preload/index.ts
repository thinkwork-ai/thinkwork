import { contextBridge, ipcRenderer } from "electron";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";
import {
  CHECK_FOR_UPDATES_CHANNEL,
  CANCEL_PI_TURN_CHANNEL,
  CLEAR_TOKEN_STORAGE_CHANNEL,
  CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  GET_DESKTOP_CONFIG_CHANNEL,
  GET_PI_STATUS_CHANNEL,
  GET_SESSION_TOKENS_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  OAUTH_ERROR_EVENT_CHANNEL,
  PI_DIAGNOSTIC_EVENT_CHANNEL,
  PI_STATUS_EVENT_CHANNEL,
  REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  SIGN_OUT_CHANNEL,
  SIGNED_OUT_EVENT_CHANNEL,
  START_PI_TURN_CHANNEL,
  START_OAUTH_CHANNEL,
  SET_TOKEN_STORAGE_ITEM_CHANNEL,
  TOKENS_CHANGED_EVENT_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  UPDATE_TELEMETRY_EVENT_CHANNEL,
  RAISE_THREAD_NOTIFICATION_CHANNEL,
  OPEN_THREAD_EVENT_CHANNEL,
  WINDOW_FOCUS_EVENT_CHANNEL,
  DeepLinkEventSchema,
  GetDesktopConfigResponseSchema,
  GetPiStatusResponseSchema,
  GetSessionTokensResponseSchema,
  GetUpdateStateResponseSchema,
  ConsumePendingOAuthResponseSchema,
  RemoveTokenStorageItemRequestSchema,
  OAuthErrorEventSchema,
  PiCancelTurnRequestSchema,
  PiCancelTurnResponseSchema,
  PiDiagnosticEventSchema,
  PiStartTurnRequestSchema,
  PiStartTurnResponseSchema,
  PiStatusEventSchema,
  ReportInstallOutcomeRequestSchema,
  RaiseThreadNotificationRequestSchema,
  OpenThreadEventSchema,
  WindowFocusEventSchema,
  SetTokenStorageItemRequestSchema,
  SignOutResponseSchema,
  SignedOutEventSchema,
  StartOAuthRequestSchema,
  StartOAuthResponseSchema,
  TokensChangedEventSchema,
  UpdateStateEventSchema,
  UpdateTelemetryEventSchema,
} from "@thinkwork/desktop-ipc";

type PiDiagnosticListener =
  NonNullable<NonNullable<ThinkworkBridge["pi"]>["onDiagnostic"]> extends (
    listener: infer Listener,
  ) => unknown
    ? Listener
    : never;

const MAX_BUFFERED_PI_DIAGNOSTICS = 200;
const piDiagnosticBuffer: Parameters<PiDiagnosticListener>[0][] = [];
const piDiagnosticListeners = new Set<PiDiagnosticListener>();

ipcRenderer.on(PI_DIAGNOSTIC_EVENT_CHANNEL, (_event, payload: unknown) => {
  const diagnostic = PiDiagnosticEventSchema.parse(payload);
  piDiagnosticBuffer.push(diagnostic);
  if (piDiagnosticBuffer.length > MAX_BUFFERED_PI_DIAGNOSTICS) {
    piDiagnosticBuffer.splice(
      0,
      piDiagnosticBuffer.length - MAX_BUFFERED_PI_DIAGNOSTICS,
    );
  }
  for (const listener of piDiagnosticListeners) {
    listener(diagnostic);
  }
});

const piBridge: NonNullable<ThinkworkBridge["pi"]> = {
  status: "unavailable",
  async getStatus() {
    const state = GetPiStatusResponseSchema.parse(
      await ipcRenderer.invoke(GET_PI_STATUS_CHANNEL),
    );
    piBridge.status = state.status;
    return state;
  },
  async startTurn(request) {
    return PiStartTurnResponseSchema.parse(
      await ipcRenderer.invoke(
        START_PI_TURN_CHANNEL,
        PiStartTurnRequestSchema.parse(request),
      ),
    );
  },
  async cancelTurn(request) {
    return PiCancelTurnResponseSchema.parse(
      await ipcRenderer.invoke(
        CANCEL_PI_TURN_CHANNEL,
        PiCancelTurnRequestSchema.parse(request),
      ),
    );
  },
  onStatusChanged(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      const state = PiStatusEventSchema.parse(payload);
      piBridge.status = state.status;
      listener(state);
    };
    ipcRenderer.on(PI_STATUS_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(PI_STATUS_EVENT_CHANNEL, wrappedListener);
  },
  onDiagnostic(listener) {
    piDiagnosticListeners.add(listener);
    for (const diagnostic of piDiagnosticBuffer) {
      listener(diagnostic);
    }
    return () => {
      piDiagnosticListeners.delete(listener);
    };
  },
};

const bridge = {
  async getSessionTokens() {
    return GetSessionTokensResponseSchema.parse(
      await ipcRenderer.invoke(GET_SESSION_TOKENS_CHANNEL),
    );
  },
  async setTokenStorageItem(request) {
    await ipcRenderer.invoke(
      SET_TOKEN_STORAGE_ITEM_CHANNEL,
      SetTokenStorageItemRequestSchema.parse(request),
    );
  },
  async removeTokenStorageItem(request) {
    await ipcRenderer.invoke(
      REMOVE_TOKEN_STORAGE_ITEM_CHANNEL,
      RemoveTokenStorageItemRequestSchema.parse(request),
    );
  },
  async clearTokenStorage() {
    await ipcRenderer.invoke(CLEAR_TOKEN_STORAGE_CHANNEL);
  },
  onTokensChanged(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(TokensChangedEventSchema.parse(payload));
    };
    ipcRenderer.on(TOKENS_CHANGED_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(TOKENS_CHANGED_EVENT_CHANNEL, wrappedListener);
  },
  async startOAuth(request) {
    return StartOAuthResponseSchema.parse(
      await ipcRenderer.invoke(
        START_OAUTH_CHANNEL,
        StartOAuthRequestSchema.parse(request),
      ),
    );
  },
  async signOut() {
    return SignOutResponseSchema.parse(
      await ipcRenderer.invoke(SIGN_OUT_CHANNEL),
    );
  },
  onSignedOut(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(SignedOutEventSchema.parse(payload));
    };
    ipcRenderer.on(SIGNED_OUT_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(SIGNED_OUT_EVENT_CHANNEL, wrappedListener);
  },
  async consumePendingOAuth() {
    return ConsumePendingOAuthResponseSchema.parse(
      await ipcRenderer.invoke(CONSUME_PENDING_OAUTH_CHANNEL),
    );
  },
  onDeepLink(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(DeepLinkEventSchema.parse(payload));
    };
    ipcRenderer.on(DEEP_LINK_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(DEEP_LINK_EVENT_CHANNEL, wrappedListener);
  },
  onOAuthError(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(OAuthErrorEventSchema.parse(payload));
    };
    ipcRenderer.on(OAUTH_ERROR_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(OAUTH_ERROR_EVENT_CHANNEL, wrappedListener);
  },
  async getDesktopConfig() {
    return GetDesktopConfigResponseSchema.parse(
      await ipcRenderer.invoke(GET_DESKTOP_CONFIG_CHANNEL),
    );
  },
  async getUpdateState() {
    return GetUpdateStateResponseSchema.parse(
      await ipcRenderer.invoke(GET_UPDATE_STATE_CHANNEL),
    );
  },
  async checkForUpdates() {
    await ipcRenderer.invoke(CHECK_FOR_UPDATES_CHANNEL);
  },
  async downloadUpdate() {
    await ipcRenderer.invoke(DOWNLOAD_UPDATE_CHANNEL);
  },
  async installUpdate() {
    await ipcRenderer.invoke(INSTALL_UPDATE_CHANNEL);
  },
  onUpdateState(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(UpdateStateEventSchema.parse(payload));
    };
    ipcRenderer.on(UPDATE_STATE_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(UPDATE_STATE_EVENT_CHANNEL, wrappedListener);
  },
  onUpdateTelemetry(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(UpdateTelemetryEventSchema.parse(payload));
    };
    ipcRenderer.on(UPDATE_TELEMETRY_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(
        UPDATE_TELEMETRY_EVENT_CHANNEL,
        wrappedListener,
      );
  },
  async reportInstallOutcome(outcome) {
    await ipcRenderer.invoke(
      REPORT_INSTALL_OUTCOME_CHANNEL,
      ReportInstallOutcomeRequestSchema.parse(outcome),
    );
  },
  async raiseThreadNotification(request) {
    await ipcRenderer.invoke(
      RAISE_THREAD_NOTIFICATION_CHANNEL,
      RaiseThreadNotificationRequestSchema.parse(request),
    );
  },
  onOpenThread(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(OpenThreadEventSchema.parse(payload));
    };
    ipcRenderer.on(OPEN_THREAD_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(OPEN_THREAD_EVENT_CHANNEL, wrappedListener);
  },
  onWindowFocusChange(listener) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => {
      listener(WindowFocusEventSchema.parse(payload));
    };
    ipcRenderer.on(WINDOW_FOCUS_EVENT_CHANNEL, wrappedListener);
    return () =>
      ipcRenderer.removeListener(WINDOW_FOCUS_EVENT_CHANNEL, wrappedListener);
  },
  pi: piBridge,
} satisfies ThinkworkBridge;

void piBridge.getStatus().catch(() => {
  piBridge.status = "unavailable";
});

contextBridge.exposeInMainWorld("thinkworkBridge", bridge);
