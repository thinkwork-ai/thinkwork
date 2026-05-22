import { contextBridge, ipcRenderer } from "electron";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";
import {
  CHECK_FOR_UPDATES_CHANNEL,
  CONSUME_PENDING_OAUTH_CHANNEL,
  DEEP_LINK_EVENT_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  GET_SESSION_TOKENS_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  REPORT_INSTALL_OUTCOME_CHANNEL,
  SIGN_OUT_CHANNEL,
  START_OAUTH_CHANNEL,
  UPDATE_STATE_EVENT_CHANNEL,
  DeepLinkEventSchema,
  GetSessionTokensResponseSchema,
  GetUpdateStateResponseSchema,
  ConsumePendingOAuthResponseSchema,
  ReportInstallOutcomeRequestSchema,
  UpdateStateEventSchema,
} from "@thinkwork/desktop-ipc";

const bridge = {
  async getSessionTokens() {
    return GetSessionTokensResponseSchema.parse(
      await ipcRenderer.invoke(GET_SESSION_TOKENS_CHANNEL),
    );
  },
  async startOAuth() {
    await ipcRenderer.invoke(START_OAUTH_CHANNEL);
  },
  async signOut() {
    await ipcRenderer.invoke(SIGN_OUT_CHANNEL);
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
  async reportInstallOutcome(outcome) {
    await ipcRenderer.invoke(
      REPORT_INSTALL_OUTCOME_CHANNEL,
      ReportInstallOutcomeRequestSchema.parse(outcome),
    );
  },
} satisfies ThinkworkBridge;

contextBridge.exposeInMainWorld("thinkworkBridge", bridge);
