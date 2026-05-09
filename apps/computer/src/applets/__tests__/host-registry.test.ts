import { afterEach, describe, expect, it } from "vitest";
import {
  loadAppletHostExternals,
  registerAppletHost,
} from "../host-registry";

afterEach(() => {
  delete globalThis.__THINKWORK_APPLET_HOST__;
});

describe("registerAppletHost", () => {
  it("registers the host externals and inert applet API placeholder once", () => {
    const registry = registerAppletHost();

    expect(globalThis.__THINKWORK_APPLET_HOST__).toBe(registry);
    expect(registry["@thinkwork/ui"]).toBeUndefined();
    expect(registry["@thinkwork/computer-stdlib"]).toBeUndefined();
    expect(registry["react/jsx-runtime"]).toBeUndefined();
    expect(() => registry.useAppletAPI("app-1", "instance-1")).toThrow(
      /INERT_NOT_WIRED/,
    );
  });

  it("loads applet externals lazily for the future mount path", async () => {
    const registry = await loadAppletHostExternals(async (key) => {
      return { marker: key } as never;
    });

    expect(registry.react).toEqual({ marker: "react" });
    expect(registry["@thinkwork/ui"]).toEqual({ marker: "@thinkwork/ui" });
    expect(registry["@thinkwork/computer-stdlib"]).toEqual({
      marker: "@thinkwork/computer-stdlib",
    });
    expect(registry.recharts).toEqual({ marker: "recharts" });
  });

  it("is deterministic when called repeatedly by the same owner", () => {
    const first = registerAppletHost();
    const second = registerAppletHost();

    expect(second).toBe(first);
  });

  it("rejects a registry written by another owner", () => {
    globalThis.__THINKWORK_APPLET_HOST__ = {
      useAppletAPI: () => {
        throw new Error("foreign");
      },
    } as unknown as typeof globalThis.__THINKWORK_APPLET_HOST__;

    expect(() => registerAppletHost()).toThrow(/already registered/);
  });
});
