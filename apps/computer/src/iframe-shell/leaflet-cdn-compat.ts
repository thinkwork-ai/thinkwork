import type { LoadedAppletHostRegistry } from "../applets/host-registry";

const INSTALLED = Symbol.for("thinkwork.iframeShell.leafletCdnCompat");

type PatchedNodePrototype = Node & {
  [INSTALLED]?: true;
  appendChild<T extends Node>(node: T): T;
};

type MaybeLeafletWindow = Window & {
  L?: unknown;
};

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
        (window as MaybeLeafletWindow).L = leafletModule.default ?? leafletModule;
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
