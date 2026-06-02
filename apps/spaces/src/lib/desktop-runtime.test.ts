import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopBridge,
  isDesktopBuild,
  normalizeDesktopNext,
} from "./desktop-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop runtime detection", () => {
  it("detects non-desktop builds without exposing local Pi dispatch", () => {
    expect(isDesktopBuild()).toBe(false);
    expect(getDesktopBridge()).toBeNull();
  });

  it("returns the desktop bridge for shell-only features", () => {
    const bridge = {
      app: { platform: "darwin" },
    };
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: bridge,
    });

    expect(isDesktopBuild()).toBe(true);
    expect(getDesktopBridge()).toBe(bridge);
  });

  it("normalizes desktop callback next routes", () => {
    expect(normalizeDesktopNext("/settings")).toBe("/settings");
    expect(normalizeDesktopNext("//example.com")).toBeUndefined();
    expect(normalizeDesktopNext("https://example.com")).toBeUndefined();
    expect(normalizeDesktopNext(null)).toBeUndefined();
  });
});
