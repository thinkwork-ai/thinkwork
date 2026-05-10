import type { LoadedAppletHostRegistry } from "../applets/host-registry";

const INSTALLED = Symbol.for("thinkwork.iframeShell.leafletCdnCompat");

type PatchedNodePrototype = Node & {
  [INSTALLED]?: true;
  appendChild<T extends Node>(node: T): T;
};

type MaybeLeafletWindow = Window & {
  L?: unknown;
};

type LeafletWithTileLayer = {
  tileLayer?: (url: string, options?: Record<string, unknown>) => unknown;
  __thinkworkMapboxTileCompat?: true;
};

const MAPBOX_USERNAME = "ericodom";
const MAPBOX_STYLES = {
  dark: "clkeb986f001e01oh4hmn7i0w",
  light: "cijsn8buv007j8zkqcvbbvkzf",
} as const;

function isKnownLeafletAsset(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return (
      (parsed.hostname === "unpkg.com" ||
        parsed.hostname === "cdn.jsdelivr.net") &&
      /\/leaflet(@|\/|%40)/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function dispatchLoad(element: HTMLElement): void {
  queueMicrotask(() => {
    element.dispatchEvent(new Event("load"));
  });
}

function isOpenStreetMapTileUrl(url: string): boolean {
  return url.includes("tile.openstreetmap.org/{z}/{x}/{y}.png");
}

function readMapboxToken(): string | undefined {
  return import.meta.env?.VITE_MAPBOX_PUBLIC_TOKEN || undefined;
}

function buildMapboxTileUrl(token: string): string {
  const theme =
    document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";
  const styleId = MAPBOX_STYLES[theme];
  return `https://api.mapbox.com/styles/v1/${MAPBOX_USERNAME}/${styleId}/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`;
}

function installMapboxTileCompat(leaflet: unknown): void {
  const token = readMapboxToken();
  if (!token) return;

  const leafletWithTileLayer = leaflet as LeafletWithTileLayer;
  if (
    leafletWithTileLayer.__thinkworkMapboxTileCompat ||
    typeof leafletWithTileLayer.tileLayer !== "function"
  ) {
    return;
  }

  const originalTileLayer = leafletWithTileLayer.tileLayer.bind(leaflet);
  leafletWithTileLayer.tileLayer = (url, options = {}) => {
    if (!isOpenStreetMapTileUrl(url)) {
      return originalTileLayer(url, options);
    }

    return originalTileLayer(buildMapboxTileUrl(token), {
      ...options,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      tileSize: 256,
      zoomOffset: 0,
    });
  };
  leafletWithTileLayer.__thinkworkMapboxTileCompat = true;
}

/**
 * Compatibility bridge for early generated map applets that hand-rolled
 * Leaflet by appending CDN script/link tags. The sandbox intentionally
 * blocks arbitrary external scripts; for known Leaflet CDN URLs we route
 * the request to the already-bundled registry module and fire the script's
 * load handler without adding a network-loaded script to the document.
 *
 * New applets should import `MapView` from `@thinkwork/computer-stdlib`.
 * This bridge keeps existing artifacts usable while preserving the offline
 * sandbox invariant.
 */
export function installLeafletCdnCompatibilityBridge(
  registryReady: Promise<LoadedAppletHostRegistry>,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const proto = Node.prototype as PatchedNodePrototype;
  if (proto[INSTALLED]) return () => undefined;

  const originalAppendChild = proto.appendChild;
  proto[INSTALLED] = true;

  proto.appendChild = function appendChildWithLeafletCompat<T extends Node>(
    this: Node,
    node: T,
  ): T {
    if (
      node instanceof HTMLScriptElement &&
      isKnownLeafletAsset(node.src)
    ) {
      void registryReady.then((registry) => {
        const leafletModule = registry.leaflet as typeof registry.leaflet & {
          default?: unknown;
        };
        const leaflet = leafletModule.default ?? leafletModule;
        installMapboxTileCompat(leaflet);
        (window as MaybeLeafletWindow).L = leaflet;
        dispatchLoad(node);
      });
      return node;
    }

    if (
      node instanceof HTMLLinkElement &&
      node.rel.toLowerCase() === "stylesheet" &&
      isKnownLeafletAsset(node.href)
    ) {
      dispatchLoad(node);
      return node;
    }

    return originalAppendChild.call(this, node) as T;
  };

  return () => {
    proto.appendChild = originalAppendChild;
    delete proto[INSTALLED];
  };
}
