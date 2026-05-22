import type { UpdateState } from "@thinkwork/desktop-ipc";

export type UpdateErrorContext = "check" | "download" | "install";

export interface DesktopRuntimeInfo {
  hostArch: string;
  appArch: string;
  runningUnderArm64Translation: boolean;
}

export interface InitialUpdateStateOptions {
  channel: string;
  currentVersion: string;
  runtimeInfo: DesktopRuntimeInfo;
}

export type DesktopUpdateAction =
  | { type: "checking-for-update"; checkedAt: string }
  | { type: "update-available"; version: string; checkedAt: string }
  | { type: "update-not-available"; checkedAt: string }
  | { type: "download-started" }
  | { type: "download-progress"; percent: number }
  | { type: "update-downloaded"; version: string }
  | {
      type: "error";
      message: string;
      context?: UpdateErrorContext;
    }
  | { type: "install-error"; message: string };

export function createInitialUpdateState(
  options: InitialUpdateStateOptions,
): UpdateState {
  return {
    status: "disabled",
    currentVersion: options.currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    hostArch: options.runtimeInfo.hostArch,
    appArch: options.runtimeInfo.appArch,
    runningUnderArm64Translation:
      options.runtimeInfo.runningUnderArm64Translation,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
    channel: options.channel,
  };
}

export function reduceUpdateState(
  state: UpdateState,
  action: DesktopUpdateAction,
): UpdateState {
  switch (action.type) {
    case "checking-for-update":
      return {
        ...state,
        status: "checking",
        checkedAt: action.checkedAt,
        downloadPercent: null,
        message: null,
        errorContext: null,
        canRetry: false,
      };
    case "update-available":
      return {
        ...state,
        status: "available",
        availableVersion: action.version,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: action.checkedAt,
        message: null,
        errorContext: null,
        canRetry: false,
      };
    case "update-not-available":
      return {
        ...state,
        status: "up-to-date",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: action.checkedAt,
        message: null,
        errorContext: null,
        canRetry: false,
      };
    case "download-started":
      return {
        ...state,
        status: "downloading",
        downloadPercent: 0,
        message: null,
        errorContext: null,
        canRetry: false,
      };
    case "download-progress":
      return {
        ...state,
        status: "downloading",
        downloadPercent: clampPercent(action.percent),
        message: null,
        errorContext: null,
        canRetry: false,
      };
    case "update-downloaded":
      return {
        ...state,
        status: "downloaded",
        availableVersion: action.version,
        downloadedVersion: action.version,
        downloadPercent: 100,
        message: null,
        errorContext: null,
        canRetry: true,
      };
    case "error": {
      const context = action.context ?? inferErrorContext(state);
      const downloadCanRetry =
        context === "download" && !!state.availableVersion;
      return {
        ...state,
        status: downloadCanRetry ? "available" : "error",
        downloadPercent: null,
        message: action.message,
        errorContext: context,
        canRetry: context === "check" || downloadCanRetry,
      };
    }
    case "install-error":
      return {
        ...state,
        status: "downloaded",
        message: action.message,
        errorContext: "install",
        canRetry: true,
      };
  }
}

function inferErrorContext(state: UpdateState): UpdateErrorContext {
  if (state.status === "downloading") return "download";
  if (state.status === "checking") return "check";
  return "check";
}

function clampPercent(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}
