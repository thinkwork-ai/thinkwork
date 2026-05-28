import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";
import {
  desktopLocalPiDisplayStatus,
  isDesktopBuild,
  shouldUseDesktopLocalPiDispatch,
  shouldUseDesktopLocalPiDispatchNow,
} from "./desktop-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop runtime detection", () => {
  it("does not enable desktop-local dispatch outside the desktop shell", () => {
    expect(isDesktopBuild()).toBe(false);
    expect(shouldUseDesktopLocalPiDispatch(null)).toBe(false);
  });

  it("enables desktop-local dispatch only for ready local Pi statuses", () => {
    const bridge = {
      pi: { status: "healthy" },
    } as unknown as ThinkworkBridge;
    expect(shouldUseDesktopLocalPiDispatch(bridge)).toBe(true);

    const unavailableBridge = {
      pi: { status: "unavailable" },
    } as unknown as ThinkworkBridge;
    expect(shouldUseDesktopLocalPiDispatch(unavailableBridge)).toBe(false);
  });

  it("hydrates desktop-local dispatch readiness from the bridge before sending", async () => {
    const bridge = {
      pi: {
        status: "unavailable",
        getStatus: vi.fn(async () => ({ status: "healthy" })),
      },
    } as unknown as ThinkworkBridge;

    await expect(shouldUseDesktopLocalPiDispatchNow(bridge)).resolves.toBe(
      true,
    );
    expect(bridge.pi?.getStatus).toHaveBeenCalled();
  });

  it("summarizes local Pi display states for compact desktop chrome", () => {
    const bridge = {
      pi: { status: "healthy" },
    } as unknown as ThinkworkBridge;

    expect(desktopLocalPiDisplayStatus({ bridge })).toBe("healthy");
    expect(
      desktopLocalPiDisplayStatus({ bridge, localTurnRunning: true }),
    ).toBe("running");
    expect(desktopLocalPiDisplayStatus({ bridge, fallbackActive: true })).toBe(
      "fallback",
    );
    expect(
      desktopLocalPiDisplayStatus({
        bridge,
        state: {
          status: "unavailable",
          pid: null,
          version: null,
          restartCount: 0,
          startedAt: null,
          updatedAt: "2026-05-28T12:00:00.000Z",
          lastExitCode: null,
          lastError: null,
        },
      }),
    ).toBe("unavailable");
    expect(desktopLocalPiDisplayStatus({ bridge: null })).toBe("hidden");
  });
});
