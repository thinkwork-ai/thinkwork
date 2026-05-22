import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UpdateState, UpdateTelemetryEvent } from "@thinkwork/desktop-ipc";
import { UpdateTelemetry } from "../../src/main/telemetry";
import {
  createInitialUpdateState,
  reduceUpdateState,
} from "../../src/main/update-machine";
import {
  DesktopUpdatesController,
  detectRuntimeInfo,
  type AutoUpdaterLike,
  type UpdatesAppLike,
} from "../../src/main/updates";

const runtimeInfo = {
  hostArch: "arm64",
  appArch: "x64",
  runningUnderArm64Translation: true,
};

function initialState(): UpdateState {
  return createInitialUpdateState({
    channel: "latest",
    currentVersion: "1.0.0",
    runtimeInfo,
  });
}

describe("desktop update reducer", () => {
  it("moves from disabled to checking", () => {
    expect(
      reduceUpdateState(initialState(), {
        type: "checking-for-update",
        checkedAt: "2026-05-22T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "checking",
      checkedAt: "2026-05-22T00:00:00.000Z",
      canRetry: false,
    });
  });

  it("records an available update with the check timestamp", () => {
    const state = reduceUpdateState(initialState(), {
      type: "checking-for-update",
      checkedAt: "2026-05-22T00:00:00.000Z",
    });

    expect(
      reduceUpdateState(state, {
        type: "update-available",
        version: "1.0.1",
        checkedAt: "2026-05-22T00:01:00.000Z",
      }),
    ).toMatchObject({
      status: "available",
      availableVersion: "1.0.1",
      checkedAt: "2026-05-22T00:01:00.000Z",
    });
  });

  it("tracks download progress and completion", () => {
    const available = reduceUpdateState(initialState(), {
      type: "update-available",
      version: "1.0.1",
      checkedAt: "2026-05-22T00:00:00.000Z",
    });

    const downloading = reduceUpdateState(available, {
      type: "download-progress",
      percent: 42.5,
    });
    const downloaded = reduceUpdateState(downloading, {
      type: "update-downloaded",
      version: "1.0.1",
    });

    expect(downloading).toMatchObject({
      status: "downloading",
      downloadPercent: 42.5,
    });
    expect(downloaded).toMatchObject({
      status: "downloaded",
      downloadedVersion: "1.0.1",
      downloadPercent: 100,
      canRetry: true,
    });
  });

  it("rolls a download failure back to available when a version is known", () => {
    const downloading = reduceUpdateState(
      reduceUpdateState(initialState(), {
        type: "update-available",
        version: "1.0.1",
        checkedAt: "2026-05-22T00:00:00.000Z",
      }),
      { type: "download-progress", percent: 50 },
    );

    expect(
      reduceUpdateState(downloading, {
        type: "error",
        context: "download",
        message: "network",
      }),
    ).toMatchObject({
      status: "available",
      errorContext: "download",
      canRetry: true,
    });
  });

  it("keeps a download failure terminal when no version is known", () => {
    const downloading = reduceUpdateState(initialState(), {
      type: "download-progress",
      percent: 50,
    });

    expect(
      reduceUpdateState(downloading, {
        type: "error",
        context: "download",
        message: "network",
      }),
    ).toMatchObject({
      status: "error",
      errorContext: "download",
      canRetry: false,
    });
  });
});

describe("desktop update telemetry", () => {
  let userDataDir: string;
  let appVersion = "1.0.0";
  let events: UpdateTelemetryEvent[];

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "thinkwork-updates-"));
    appVersion = "1.0.0";
    events = [];
  });

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  function telemetry(): UpdateTelemetry {
    return new UpdateTelemetry({
      app: {
        getPath: () => userDataDir,
        getVersion: () => appVersion,
      },
      emit: (event) => events.push(event),
    });
  }

  it("emits install_completed when the app version increased after download", async () => {
    await writeFile(
      join(userDataDir, "last-known-version.json"),
      JSON.stringify({
        version: "1.0.0",
        pendingDownloadedVersion: "1.0.1",
      }),
    );
    appVersion = "1.0.1";

    await telemetry().reportLaunchOutcome();

    expect(events).toEqual([
      {
        type: "update.install_completed",
        version: "1.0.1",
        fromVersion: "1.0.0",
      },
    ]);
  });

  it("emits install_failed_or_skipped when the pending version was not installed", async () => {
    await writeFile(
      join(userDataDir, "last-known-version.json"),
      JSON.stringify({
        version: "1.0.0",
        pendingDownloadedVersion: "1.0.1",
      }),
    );

    await telemetry().reportLaunchOutcome();

    expect(events).toEqual([
      {
        type: "update.install_failed_or_skipped",
        version: "1.0.0",
        fromVersion: "1.0.0",
        attemptedVersion: "1.0.1",
      },
    ]);
  });
});

describe("desktop updater controller", () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "thinkwork-updater-"));
  });

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it("surfaces Rosetta/runtime metadata in initial state", () => {
    expect(
      detectRuntimeInfo({
        getPath: () => userDataDir,
        getVersion: () => "1.0.0",
        isPackaged: true,
        runningUnderARM64Translation: true,
      }),
    ).toMatchObject({ runningUnderArm64Translation: true });
  });

  it("propagates updater events into state and telemetry callbacks", async () => {
    const updater = new FakeAutoUpdater();
    const states: UpdateState[] = [];
    const telemetryEvents: UpdateTelemetryEvent[] = [];
    const controller = new DesktopUpdatesController({
      app: appLike(userDataDir),
      autoUpdater: updater,
      now: fixedClock(),
      runtimeInfo,
      onStateChange: (state) => states.push(state),
      onTelemetry: (event) => telemetryEvents.push(event),
    });

    await controller.start();
    await controller.checkForUpdates();
    await controller.downloadUpdate();
    controller.installUpdate();
    await tick();

    expect(states.map((state) => state.status)).toContain("checking");
    expect(states.map((state) => state.status)).toContain("available");
    expect(states.map((state) => state.status)).toContain("downloading");
    expect(states.at(-1)).toMatchObject({
      status: "downloaded",
      downloadedVersion: "1.0.1",
    });
    expect(telemetryEvents).toEqual([
      {
        type: "update.download_completed",
        version: "1.0.1",
        channel: "latest",
        fromVersion: "1.0.0",
      },
    ]);
    expect(updater.quitAndInstallCalls).toBe(1);
  });
});

function appLike(userDataDir: string): UpdatesAppLike {
  return {
    getPath: () => userDataDir,
    getVersion: () => "1.0.0",
    isPackaged: true,
    runningUnderARM64Translation: false,
  };
}

function fixedClock(): () => Date {
  return () => new Date("2026-05-22T00:00:00.000Z");
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  channel: string | null = null;
  quitAndInstallCalls = 0;

  async checkForUpdates(): Promise<unknown> {
    this.emit("checking-for-update");
    this.emit("update-available", { version: "1.0.1" });
    return undefined;
  }

  async downloadUpdate(): Promise<unknown> {
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", { version: "1.0.1" });
    return undefined;
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }
}
