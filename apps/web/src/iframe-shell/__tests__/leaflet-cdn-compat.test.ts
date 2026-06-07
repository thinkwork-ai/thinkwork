// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installLeafletCdnCompatibilityBridge } from "../leaflet-cdn-compat";
import type { LoadedAppletHostRegistry } from "../../applets/host-registry";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  delete (window as Window & { L?: unknown }).L;
  vi.unstubAllEnvs();
});

describe("installLeafletCdnCompatibilityBridge", () => {
  it("routes known Leaflet CDN scripts to the bundled registry module", async () => {
    const leafletModule = { map: vi.fn() };
    cleanup = installLeafletCdnCompatibilityBridge(
      Promise.resolve({
        leaflet: { default: leafletModule },
      } as unknown as LoadedAppletHostRegistry),
    );

    const script = document.createElement("script");
    const onload = vi.fn();
    script.onload = onload;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

    const appended = document.head.appendChild(script);

    expect(appended).toBe(script);
    expect(document.head.contains(script)).toBe(false);
    await vi.waitFor(() => expect(onload).toHaveBeenCalledTimes(1));
    expect((window as Window & { L?: unknown }).L).toBe(leafletModule);
  });

  it("upgrades hand-rolled OpenStreetMap tile layers to configured Mapbox tiles", async () => {
    vi.stubEnv("VITE_MAPBOX_PUBLIC_TOKEN", "pk.test_mapbox_token");
    document.documentElement.classList.add("dark");
    const tileLayer = vi.fn();
    const leafletModule = { tileLayer };
    cleanup = installLeafletCdnCompatibilityBridge(
      Promise.resolve({
        leaflet: { default: leafletModule },
      } as unknown as LoadedAppletHostRegistry),
    );

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    document.head.appendChild(script);

    await vi.waitFor(() => {
      expect((window as Window & { L?: unknown }).L).toBe(leafletModule);
    });

    leafletModule.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {},
    );

    expect(tileLayer).toHaveBeenCalledWith(
      "https://api.mapbox.com/styles/v1/ericodom/clkeb986f001e01oh4hmn7i0w/tiles/256/{z}/{x}/{y}@2x?access_token=pk.test_mapbox_token",
      expect.objectContaining({
        attribution: expect.stringContaining("Mapbox"),
        tileSize: 256,
        zoomOffset: 0,
      }),
    );
    document.documentElement.classList.remove("dark");
  });

  it("drops known Leaflet CDN stylesheet links because Leaflet CSS is bundled", async () => {
    cleanup = installLeafletCdnCompatibilityBridge(
      Promise.resolve({} as LoadedAppletHostRegistry),
    );

    const link = document.createElement("link");
    const onload = vi.fn();
    link.onload = onload;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

    document.head.appendChild(link);

    expect(document.head.contains(link)).toBe(false);
    await vi.waitFor(() => expect(onload).toHaveBeenCalledTimes(1));
  });

  it("leaves unrelated script tags on the normal append path", () => {
    cleanup = installLeafletCdnCompatibilityBridge(
      Promise.resolve({} as LoadedAppletHostRegistry),
    );

    const script = document.createElement("script");
    script.src = "/assets/local.js";

    document.head.appendChild(script);

    expect(document.head.contains(script)).toBe(true);
  });
});
