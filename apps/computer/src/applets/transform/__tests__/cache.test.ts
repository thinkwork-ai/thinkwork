import { afterEach, describe, expect, it, vi } from "vitest";
import { AppletTransformCache, createAppletCacheKey } from "../cache";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppletTransformCache", () => {
  it("returns undefined on miss and the same URL after set", () => {
    const cache = new AppletTransformCache();

    expect(cache.get("missing")).toBeUndefined();
    cache.set("key", "blob:module-1");

    expect(cache.get("key")).toBe("blob:module-1");
  });

  it("revokes the oldest blob URL on eviction", () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const cache = new AppletTransformCache(1);

    cache.set("first", "blob:first");
    cache.set("second", "blob:second");

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe("blob:second");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("keys compiled output by source, stdlib version, and transform version", () => {
    const first = createAppletCacheKey({
      source: "export default 1",
      stdlibVersion: "0.1.0",
      transformVersion: "v1",
    });
    const second = createAppletCacheKey({
      source: "export default 1",
      stdlibVersion: "0.2.0",
      transformVersion: "v1",
    });

    expect(first).not.toBe(second);
  });
});
