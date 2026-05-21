import type { AppletAPI, ThinkworkAppletHost } from "@thinkwork/computer-stdlib";
import { createElement, type ComponentProps, type ComponentType } from "react";
import { createHostAppletAPI } from "./host-applet-api";

const REGISTRY_OWNER = Symbol.for("thinkwork.appletHostRegistry.owner");

interface AppletHostRegistryModules {
  react?: typeof import("react");
  "react-dom"?: typeof import("react-dom");
  "react/jsx-runtime"?: typeof import("react/jsx-runtime");
  "react/jsx-dev-runtime"?: typeof import("react/jsx-dev-runtime");
  "@thinkwork/ui"?: typeof import("@thinkwork/ui");
  "@thinkwork/computer-stdlib"?: typeof import("@thinkwork/computer-stdlib");
  recharts?: typeof import("recharts");
  "lucide-react"?: typeof import("lucide-react");
  leaflet?: typeof import("leaflet");
  "react-leaflet"?: typeof import("react-leaflet");
  [REGISTRY_OWNER]?: true;
}

declare module "@thinkwork/computer-stdlib" {
  interface ThinkworkAppletHost extends AppletHostRegistryModules {}
}

export type AppletHostRegistry = ThinkworkAppletHost &
  AppletHostRegistryModules & {
    useAppletAPI: (appId: string, instanceId: string) => AppletAPI;
    [REGISTRY_OWNER]: true;
  };

export type LoadedAppletHostRegistry = AppletHostRegistry &
  RequiredAppletHostModules;

type AppletHostModuleKey =
  | "react"
  | "react-dom"
  | "react/jsx-runtime"
  | "react/jsx-dev-runtime"
  | "@thinkwork/ui"
  | "@thinkwork/computer-stdlib"
  | "recharts"
  | "lucide-react"
  | "leaflet"
  | "react-leaflet";

type RequiredAppletHostModules = {
  [K in AppletHostModuleKey]-?: NonNullable<AppletHostRegistryModules[K]>;
};

type AppletHostModule =
  RequiredAppletHostModules[keyof RequiredAppletHostModules];

type AppletHostModuleLoader = (
  key: AppletHostModuleKey,
) => Promise<AppletHostModule>;

type LeafletModule = typeof import("leaflet");
type LeafletModuleWithDefault = LeafletModule & { default?: LeafletModule };
type ReactLeafletModule = typeof import("react-leaflet");
type LeafletMapFactory = LeafletModule["map"];
type LeafletTileLayerFactory = LeafletModule["tileLayer"];

const MAPBOX_USERNAME = "ericodom";
const MAPBOX_STYLES = {
  dark: "clkeb986f001e01oh4hmn7i0w",
  light: "cijsn8buv007j8zkqcvbbvkzf",
} as const;

function isOpenStreetMapTileUrl(url: string): boolean {
  return /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/.test(url);
}

function readMapboxToken(): string | undefined {
  return import.meta.env?.VITE_MAPBOX_PUBLIC_TOKEN || undefined;
}

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark"
  );
}

function mapboxTileUrl(token: string): string {
  const styleId = isDarkTheme() ? MAPBOX_STYLES.dark : MAPBOX_STYLES.light;
  return `https://api.mapbox.com/styles/v1/${MAPBOX_USERNAME}/${styleId}/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`;
}

function mapboxAttribution(): string {
  return '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>';
}

function normalizeTileLayerProps<P extends { url?: string }>(
  props: P,
): P {
  const token = readMapboxToken();
  if (!token || typeof props.url !== "string" || !isOpenStreetMapTileUrl(props.url)) {
    return props;
  }

  return {
    ...props,
    url: mapboxTileUrl(token),
    attribution: mapboxAttribution(),
    tileSize: 256,
    zoomOffset: 0,
  };
}

function createLeafletCompatModule(leaflet: LeafletModule): LeafletModule {
  const source = ((leaflet as LeafletModuleWithDefault).default ?? leaflet) as LeafletModule;
  if (typeof source.map !== "function" || typeof source.tileLayer !== "function") {
    return leaflet;
  }

  const originalMap = source.map.bind(source) as LeafletMapFactory;
  const originalTileLayer = source.tileLayer.bind(source) as LeafletTileLayerFactory;
  const compat = Object.create(source) as LeafletModule;
  (compat as LeafletModule & { default?: LeafletModule }).default = compat;

  compat.map = ((element: Parameters<LeafletMapFactory>[0], options = {}) => {
    const map = originalMap(element, {
      scrollWheelZoom: false,
      ...options,
    });
    map.scrollWheelZoom.disable();
    return map;
  }) as LeafletMapFactory;

  compat.tileLayer = ((url: string, options = {}) => {
    const token = readMapboxToken();
    if (!token || !isOpenStreetMapTileUrl(url)) {
      return originalTileLayer(url, options);
    }

    return originalTileLayer(mapboxTileUrl(token), {
      ...options,
      attribution: mapboxAttribution(),
      tileSize: 256,
      zoomOffset: 0,
    });
  }) as LeafletTileLayerFactory;

  return compat;
}

function createReactLeafletCompatModule(
  reactLeaflet: ReactLeafletModule,
): ReactLeafletModule {
  if (
    typeof reactLeaflet.MapContainer !== "function" ||
    typeof reactLeaflet.TileLayer !== "function"
  ) {
    return reactLeaflet;
  }

  const MapContainer = reactLeaflet.MapContainer as ComponentType<
    ComponentProps<typeof reactLeaflet.MapContainer>
  >;
  const TileLayer = reactLeaflet.TileLayer as ComponentType<
    ComponentProps<typeof reactLeaflet.TileLayer>
  >;

  return {
    ...reactLeaflet,
    MapContainer: (props) =>
      createElement(MapContainer, {
        ...props,
        scrollWheelZoom: false,
      }),
    TileLayer: (props) => createElement(TileLayer, normalizeTileLayerProps(props)),
  } as ReactLeafletModule;
}

export function registerAppletHost(): AppletHostRegistry {
  const existing = globalThis.__THINKWORK_APPLET_HOST__;
  if (existing) {
    if (existing[REGISTRY_OWNER]) return existing as AppletHostRegistry;
    throw new Error(
      "globalThis.__THINKWORK_APPLET_HOST__ is already registered by another owner",
    );
  }

  const registry = {
    useAppletAPI: createHostAppletAPI,
    [REGISTRY_OWNER]: true,
  } as unknown as AppletHostRegistry;

  globalThis.__THINKWORK_APPLET_HOST__ = registry;
  return registry;
}

export async function loadAppletHostExternals(
  loadModule: AppletHostModuleLoader = defaultLoadAppletHostModule,
): Promise<LoadedAppletHostRegistry> {
  const registry = registerAppletHost();
  const [
    react,
    reactDOM,
    reactJsxRuntime,
    reactJsxDevRuntime,
    thinkworkUI,
    computerStdlib,
    recharts,
    lucideReact,
    leaflet,
    reactLeaflet,
  ] = await Promise.all([
    loadModule("react"),
    loadModule("react-dom"),
    loadModule("react/jsx-runtime"),
    loadModule("react/jsx-dev-runtime"),
    loadModule("@thinkwork/ui"),
    loadModule("@thinkwork/computer-stdlib"),
    loadModule("recharts"),
    loadModule("lucide-react"),
    loadModule("leaflet"),
    loadModule("react-leaflet"),
  ]);

  Object.assign(registry, {
    react,
    "react-dom": reactDOM,
    "react/jsx-runtime": reactJsxRuntime,
    "react/jsx-dev-runtime": reactJsxDevRuntime,
    "@thinkwork/ui": thinkworkUI,
    "@thinkwork/computer-stdlib": computerStdlib,
    recharts,
    "lucide-react": lucideReact,
    leaflet: createLeafletCompatModule(leaflet as LeafletModule),
    "react-leaflet": createReactLeafletCompatModule(
      reactLeaflet as ReactLeafletModule,
    ),
  });
  return registry as LoadedAppletHostRegistry;
}

async function defaultLoadAppletHostModule(
  key: AppletHostModuleKey,
): Promise<AppletHostModule> {
  switch (key) {
    case "react":
      return import("react") as unknown as Promise<AppletHostModule>;
    case "react-dom":
      return import("react-dom") as unknown as Promise<AppletHostModule>;
    case "react/jsx-runtime":
      return import("react/jsx-runtime") as unknown as Promise<AppletHostModule>;
    case "react/jsx-dev-runtime":
      return import("react/jsx-dev-runtime") as unknown as Promise<AppletHostModule>;
    case "@thinkwork/ui":
      return import("@thinkwork/ui") as unknown as Promise<AppletHostModule>;
    case "@thinkwork/computer-stdlib":
      return import("@thinkwork/computer-stdlib") as unknown as Promise<AppletHostModule>;
    case "recharts":
      return import("recharts") as unknown as Promise<AppletHostModule>;
    case "lucide-react":
      return import("lucide-react") as unknown as Promise<AppletHostModule>;
    case "leaflet":
      return import("leaflet") as unknown as Promise<AppletHostModule>;
    case "react-leaflet":
      return import("react-leaflet") as unknown as Promise<AppletHostModule>;
  }
}
