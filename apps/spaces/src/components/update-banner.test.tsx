import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkworkBridge, UpdateState } from "@thinkwork/desktop-ipc";
import { UpdateBanner } from "./update-banner";

const desktopDetectionMocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  getDesktopBridge: vi.fn(),
}));

vi.mock("@/lib/desktop-detection", () => desktopDetectionMocks);
vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);

beforeEach(() => {
  desktopDetectionMocks.isDesktop.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UpdateBanner", () => {
  it("renders an available desktop update and downloads on click", async () => {
    const bridge = createBridge(
      updateState({ status: "available", availableVersion: "1.2.3" }),
    );
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(bridge);

    render(<UpdateBanner />);

    expect(await screen.findByText("Update v1.2.3 available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not render in web mode", async () => {
    desktopDetectionMocks.isDesktop.mockReturnValue(false);
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(
      createBridge(updateState({ status: "available" })),
    );

    render(<UpdateBanner />);

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("renders retry for retryable errors", async () => {
    const bridge = createBridge(
      updateState({
        status: "error",
        message: "network",
        errorContext: "check",
        canRetry: true,
      }),
    );
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(bridge);

    render(<UpdateBanner />);

    expect(await screen.findByText("Update failed: network")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("shows a Rosetta hint when an update is available under translation", async () => {
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(
      createBridge(
        updateState({
          status: "available",
          availableVersion: "1.2.3",
          runningUnderArm64Translation: true,
        }),
      ),
    );

    render(<UpdateBanner />);

    expect(
      await screen.findByText(/running the Intel build on Apple silicon/i),
    ).toBeTruthy();
  });

  it("installs a downloaded update", async () => {
    const bridge = createBridge(
      updateState({ status: "downloaded", downloadedVersion: "1.2.3" }),
    );
    desktopRuntimeMocks.getDesktopBridge.mockReturnValue(bridge);

    render(<UpdateBanner />);

    expect(await screen.findByText("Update v1.2.3 downloaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart to install" }));

    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });
});

function createBridge(state: UpdateState): ThinkworkBridge {
  return {
    getSessionTokens: vi.fn(),
    setTokenStorageItem: vi.fn(),
    removeTokenStorageItem: vi.fn(),
    clearTokenStorage: vi.fn(),
    onTokensChanged: vi.fn(() => () => {}),
    startOAuth: vi.fn(),
    signOut: vi.fn(),
    onSignedOut: vi.fn(() => () => {}),
    onOAuthError: vi.fn(() => () => {}),
    consumePendingOAuth: vi.fn(),
    onDeepLink: vi.fn(() => () => {}),
    getUpdateState: vi.fn(async () => state),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    onUpdateState: vi.fn(() => () => {}),
    onUpdateTelemetry: vi.fn(() => () => {}),
    reportInstallOutcome: vi.fn(),
  };
}

function updateState(overrides: Partial<UpdateState>): UpdateState {
  return {
    status: "disabled",
    currentVersion: "1.0.0",
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
    channel: "latest",
    ...overrides,
  };
}
