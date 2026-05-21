import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  loadAppletHostExternals,
  registerAppletHost,
} from "../host-registry";

type LeafletWithDefault = typeof import("leaflet") & {
  default: typeof import("leaflet");
};

afterEach(() => {
  delete globalThis.__THINKWORK_APPLET_HOST__;
  document.documentElement.classList.remove("dark");
  vi.unstubAllEnvs();
});

describe("registerAppletHost", () => {
  it("registers the host externals and live applet API factory once", () => {
    const registry = registerAppletHost();

    expect(globalThis.__THINKWORK_APPLET_HOST__).toBe(registry);
    expect(registry["@thinkwork/ui"]).toBeUndefined();
    expect(registry["@thinkwork/computer-stdlib"]).toBeUndefined();
    expect(registry["react/jsx-runtime"]).toBeUndefined();
    expect(registry.useAppletAPI("app-1", "instance-1")).toEqual(
      expect.objectContaining({
        useAppletState: expect.any(Function),
        useAppletQuery: expect.any(Function),
        useAppletMutation: expect.any(Function),
        refresh: expect.any(Function),
      }),
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

  it("disables scroll-wheel zoom and upgrades OSM tiles on raw Leaflet imports", async () => {
    vi.stubEnv("VITE_MAPBOX_PUBLIC_TOKEN", "pk.test_mapbox_token");
    document.documentElement.classList.add("dark");
    const disable = vi.fn();
    const map = vi.fn(() => ({ scrollWheelZoom: { disable } }));
    const tileLayer = vi.fn();

    const registry = await loadAppletHostExternals(async (key) => {
      if (key === "leaflet") {
        return {
          default: {
            map,
            tileLayer,
          },
        } as never;
      }
      return { marker: key } as never;
    });

    const leaflet = registry.leaflet as LeafletWithDefault;

    leaflet.default.map("map", { zoomControl: false });
    leaflet.default.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {},
    );

    expect(map).toHaveBeenCalledWith("map", {
      scrollWheelZoom: false,
      zoomControl: false,
    });
    expect(disable).toHaveBeenCalledTimes(1);
    expect(tileLayer).toHaveBeenCalledWith(
      "https://api.mapbox.com/styles/v1/ericodom/clkeb986f001e01oh4hmn7i0w/tiles/256/{z}/{x}/{y}@2x?access_token=pk.test_mapbox_token",
      expect.objectContaining({
        attribution: expect.stringContaining("Mapbox"),
        tileSize: 256,
        zoomOffset: 0,
      }),
    );
  });

  it("disables scroll-wheel zoom and upgrades OSM tiles on react-leaflet imports", async () => {
    vi.stubEnv("VITE_MAPBOX_PUBLIC_TOKEN", "pk.test_mapbox_token");
    const MapContainer = vi.fn(() => null);
    const TileLayer = vi.fn(() => null);

    const registry = await loadAppletHostExternals(async (key) => {
      if (key === "react-leaflet") {
        return {
          MapContainer,
          TileLayer,
        } as never;
      }
      return { marker: key } as never;
    });

    const ReactLeafletMapContainer = registry["react-leaflet"].MapContainer;
    const ReactLeafletTileLayer = registry["react-leaflet"].TileLayer;

    renderToStaticMarkup(
      createElement(ReactLeafletMapContainer, {
        center: [30.27, -97.74],
        zoom: 12,
      }),
    );
    renderToStaticMarkup(
      createElement(ReactLeafletTileLayer, {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      }),
    );

    expect(MapContainer).toHaveBeenCalledWith(
      expect.objectContaining({ scrollWheelZoom: false }),
      undefined,
    );
    expect(TileLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.mapbox.com/styles/v1/ericodom/cijsn8buv007j8zkqcvbbvkzf/tiles/256/{z}/{x}/{y}@2x?access_token=pk.test_mapbox_token",
        attribution: expect.stringContaining("Mapbox"),
        tileSize: 256,
        zoomOffset: 0,
      }),
      undefined,
    );
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
