import { machine } from "node:os";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { UpdateState, UpdateTelemetryEvent } from "@thinkwork/desktop-ipc";
import { UpdateTelemetry } from "./telemetry.js";
import {
  createInitialUpdateState,
  reduceUpdateState,
  type DesktopRuntimeInfo,
} from "./update-machine.js";

export interface UpdatesAppLike {
  getAppPath?(): string;
  getPath(name: "userData"): string;
  getVersion(): string;
  isPackaged: boolean;
  runningUnderARM64Translation?: boolean;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease?: boolean;
  forceDevUpdateConfig?: boolean;
  channel?: string | null;
  updateConfigPath?: string | null;
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
  private readonly updateConfigPath: string | null;
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
    this.updateConfigPath = resolveUpdateConfigPath(this.app);
    this.updatesEnabled =
      options.updatesEnabled ?? shouldEnableUpdates(this.app);
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
    if (!this.app.isPackaged && this.updateConfigPath) {
      this.autoUpdater.forceDevUpdateConfig = true;
      this.autoUpdater.updateConfigPath = this.updateConfigPath;
    }
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
  const autoUpdater = resolveImportedAutoUpdater(await import("electron-updater"));
  return new DesktopUpdatesController({ ...options, autoUpdater });
}

export function resolveImportedAutoUpdater(module: unknown): AutoUpdaterLike {
  const candidates = [
    module,
    readModuleProperty(module, "default"),
    readModuleProperty(module, "module.exports"),
  ];

  for (const candidate of candidates) {
    const autoUpdater = readModuleProperty(candidate, "autoUpdater");
    if (isAutoUpdaterLike(autoUpdater)) return autoUpdater;
  }

  throw new Error("electron-updater did not expose autoUpdater");
}

function readModuleProperty(module: unknown, key: string): unknown {
  if (!module || typeof module !== "object") return undefined;
  return (module as Record<string, unknown>)[key];
}

function isAutoUpdaterLike(value: unknown): value is AutoUpdaterLike {
  return (
    !!value &&
    typeof value === "object" &&
    "checkForUpdates" in value &&
    typeof (value as { checkForUpdates?: unknown }).checkForUpdates ===
      "function"
  );
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

  return !!resolveUpdateConfigPath(app);
}

function resolveUpdateConfigPath(app: UpdatesAppLike): string | null {
  return (
    candidateUpdateConfigPaths(app).find((path) => existsSync(path)) ?? null
  );
}

function candidateUpdateConfigPaths(app: UpdatesAppLike): string[] {
  const paths = new Set<string>();

  if (process.resourcesPath) {
    paths.add(join(process.resourcesPath, "app-update.yml"));
    addBundleResourceCandidates(paths, process.resourcesPath);
  }

  if (process.execPath) {
    paths.add(resolve(dirname(process.execPath), "../Resources/app-update.yml"));
    addBundleResourceCandidates(paths, process.execPath);
  }

  const appPath = app.getAppPath?.();
  if (appPath) {
    paths.add(join(appPath, "app-update.yml"));
    paths.add(join(dirname(appPath), "app-update.yml"));
    addBundleResourceCandidates(paths, appPath);
  }

  return [...paths];
}

function addBundleResourceCandidates(
  paths: Set<string>,
  startPath: string,
): void {
  let current = startPath;
  for (let depth = 0; depth < 16; depth += 1) {
    const name = basename(current);

    if (name === "Contents") {
      paths.add(join(current, "Resources/app-update.yml"));
    }
    if (name.endsWith(".app")) {
      paths.add(join(current, "Contents/Resources/app-update.yml"));
    }

    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
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
