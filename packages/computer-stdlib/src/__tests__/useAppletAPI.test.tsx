import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppletAPI, type AppletAPI } from "../index.js";

afterEach(() => {
  delete globalThis.__THINKWORK_APPLET_HOST__;
});

describe("useAppletAPI", () => {
  it("throws the inert wiring error when the host registry is missing", () => {
    expect(() => useAppletAPI("app-1", "instance-1")).toThrow(
      /INERT_NOT_WIRED/,
    );
    expect(() => useAppletAPI("app-1", "instance-1")).toThrow(
      /__THINKWORK_APPLET_HOST__/,
    );
  });

  it("delegates to the host registry when apps/computer registers it", () => {
    const api: AppletAPI = {
      useAppletState: vi.fn(),
      useAppletQuery: vi.fn(),
      useAppletMutation: vi.fn(),
      refresh: vi.fn(),
    };
    const hostHook = vi.fn(() => api);
    globalThis.__THINKWORK_APPLET_HOST__ = { useAppletAPI: hostHook };

    expect(useAppletAPI("app-1", "instance-1")).toBe(api);
    expect(hostHook).toHaveBeenCalledWith("app-1", "instance-1");
  });
});
