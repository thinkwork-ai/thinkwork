import { machine } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { UpdateState, UpdateTelemetryEvent } from "@thinkwork/desktop-ipc";
import { UpdateTelemetry } from "./telemetry.js";
import {
  createInitialUpdateState,
  reduceUpdateState,
  type DesktopRuntimeInfo,
} from "./update-machine.js";

export interface UpdatesAppLike {
  getPath(name: "userData"): string;
  getVersion(): string;
  isPackaged: boolean;
  runningUnderARM64Translation?: boolean;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease?: boolean;
  channel?: string | null;
  on(event: string, listener: (...args: unknown[]) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface CreateDesktopUpdatesControllerOptions {
  app: UpdatesAppLike;
  autoUpdater?: AutoUpdaterLike;
  now?: () => Date;
  runtimeInfo?: DesktopRuntimeInfo;
  channel?: string;
  checkOnStart?: boolean;
  updatesEnabled?: boolean;
  onStateChange?: (state: UpdateState) => void;
  onTelemetry?: (event: UpdateTelemetryEvent) => void;
  logger?: Pick<typeof console, "warn">;
}

export interface DesktopUpdatesControllerOptions extends CreateDesktopUpdatesControllerOptions {
  autoUpdater?: AutoUpdaterLike;
}

export class DesktopUpdatesController {
  private readonly app: UpdatesAppLike;
  private readonly autoUpdater?: AutoUpdaterLike;
  private readonly now: () => Date;
  private readonly checkOnStart: boolean;
  private readonly updatesEnabled: boolean;
  private readonly onStateChange: (state: UpdateState) => void;
  private readonly telemetry: UpdateTelemetry;
  private readonly logger: Pick<typeof console, "warn">;
  private started = false;
  private state: UpdateState;

  constructor(options: DesktopUpdatesControllerOptions) {
    this.app = options.app;
    this.autoUpdater = options.autoUpdater;
    this.now = options.now ?? (() => new Date());
    this.checkOnStart = options.checkOnStart ?? true;
    this.updatesEnabled = options.updatesEnabled ?? shouldEnableUpdates(this.app);
    this.onStateChange = options.onStateChange ?? (() => {});
    this.logger = options.logger ?? console;
    const channel =
      options.channel ?? resolveUpdateChannel(this.app.getVersion());
    this.state = createInitialUpdateState({
      channel,
      currentVersion: this.app.getVersion(),
      runtimeInfo: options.runtimeInfo ?? detectRuntimeInfo(this.app),
    });
    this.telemetry = new UpdateTelemetry({
      app: this.app,
      emit: options.onTelemetry ?? (() => {}),
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.telemetry.reportLaunchOutcome();

    if (!this.updatesEnabled || !this.autoUpdater) return;

    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.allowPrerelease = this.state.channel !== "latest";
    this.autoUpdater.channel = this.state.channel;
    this.registerUpdaterEvents();

    if (this.checkOnStart) {
      void this.checkForUpdates();
    }
  }

  getState(): UpdateState {
    return this.state;
  }

  async checkForUpdates(): Promise<void> {
    if (!this.updatesEnabled || !this.autoUpdater) return;

    this.dispatch({
      type: "checking-for-update",
      checkedAt: this.now().toISOString(),
    });
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.dispatch({
        type: "error",
        context: "check",
        message: errorMessage(error),
      });
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.updatesEnabled || !this.autoUpdater) return;

    this.dispatch({ type: "download-started" });
    try {
      await this.autoUpdater.downloadUpdate();
    } catch (error) {
      this.dispatch({
        type: "error",
        context: "download",
        message: errorMessage(error),
      });
    }
  }

  installUpdate(): void {
    if (
      !this.updatesEnabled ||
      !this.autoUpdater ||
      !this.state.downloadedVersion
    ) {
      return;
    }

    this.autoUpdater.quitAndInstall();
  }

  async reportInstallOutcome(outcome: {
    version: string;
    outcome: "installed" | "failed" | "skipped";
    error?: string;
  }): Promise<void> {
    await this.telemetry.reportRendererOutcome(outcome);
    if (outcome.outcome !== "installed") {
      this.dispatch({
        type: "install-error",
        message: outcome.error ?? `Update ${outcome.outcome}`,
      });
    }
  }

  private registerUpdaterEvents(): void {
    if (!this.autoUpdater) return;

    this.autoUpdater.on("checking-for-update", () => {
      this.dispatch({
        type: "checking-for-update",
        checkedAt: this.now().toISOString(),
      });
    });
    this.autoUpdater.on("update-available", (info) => {
      this.dispatch({
        type: "update-available",
        version: updateInfoVersion(info),
        checkedAt: this.now().toISOString(),
      });
    });
    this.autoUpdater.on("update-not-available", () => {
      this.dispatch({
        type: "update-not-available",
        checkedAt: this.now().toISOString(),
      });
    });
    this.autoUpdater.on("download-progress", (progress) => {
      this.dispatch({
        type: "download-progress",
        percent: updateProgressPercent(progress),
      });
    });
    this.autoUpdater.on("update-downloaded", (info) => {
      const version = updateInfoVersion(info);
      this.dispatch({ type: "update-downloaded", version });
      void this.telemetry.reportDownloadCompleted({
        version,
        channel: this.state.channel,
        fromVersion: this.state.currentVersion,
      });
    });
    this.autoUpdater.on("error", (error) => {
      this.dispatch({ type: "error", message: errorMessage(error) });
    });
  }

  private dispatch(action: Parameters<typeof reduceUpdateState>[1]): void {
    this.state = reduceUpdateState(this.state, action);
    this.onStateChange(this.state);
  }
}

export async function createDesktopUpdatesController(
  options: Omit<CreateDesktopUpdatesControllerOptions, "autoUpdater">,
): Promise<DesktopUpdatesController> {
  const { autoUpdater } = await import("electron-updater");
  return new DesktopUpdatesController({ ...options, autoUpdater });
}

export function detectRuntimeInfo(app: UpdatesAppLike): DesktopRuntimeInfo {
  return {
    hostArch: machine(),
    appArch: process.arch,
    runningUnderArm64Translation: app.runningUnderARM64Translation === true,
  };
}

export function resolveUpdateChannel(version: string): string {
  const prerelease = version.match(/-(canary|beta|alpha)(?:[.-]|$)/);
  return prerelease?.[1] ?? "latest";
}

export function shouldEnableUpdates(app: UpdatesAppLike): boolean {
  if (app.isPackaged) return true;

  try {
    return existsSync(join(process.resourcesPath, "app-update.yml"));
  } catch {
    return false;
  }
}

function updateInfoVersion(info: unknown): string {
  if (info && typeof info === "object" && "version" in info) {
    const version = (info as { version?: unknown }).version;
    if (typeof version === "string" && version.length > 0) return version;
  }
  return "unknown";
}

function updateProgressPercent(progress: unknown): number {
  if (progress && typeof progress === "object" && "percent" in progress) {
    const percent = (progress as { percent?: unknown }).percent;
    if (typeof percent === "number") return percent;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
