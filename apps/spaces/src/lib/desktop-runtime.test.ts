import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";
import {
  isDesktopBuild,
  shouldUseDesktopLocalPiDispatch,
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
});
