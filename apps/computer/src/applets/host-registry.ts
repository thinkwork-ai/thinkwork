import type { AppletAPI, ThinkworkAppletHost } from "@thinkwork/computer-stdlib";

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
  | "lucide-react";

type RequiredAppletHostModules = {
  [K in AppletHostModuleKey]-?: NonNullable<AppletHostRegistryModules[K]>;
};

type AppletHostModule =
  RequiredAppletHostModules[keyof RequiredAppletHostModules];

type AppletHostModuleLoader = (
  key: AppletHostModuleKey,
) => Promise<AppletHostModule>;

export function registerAppletHost(): AppletHostRegistry {
  const existing = globalThis.__THINKWORK_APPLET_HOST__;
  if (existing) {
    if (existing[REGISTRY_OWNER]) return existing as AppletHostRegistry;
    throw new Error(
      "globalThis.__THINKWORK_APPLET_HOST__ is already registered by another owner",
    );
  }

  const useAppletAPI = () => {
    throw new Error(
      "INERT_NOT_WIRED: globalThis.__THINKWORK_APPLET_HOST__.useAppletAPI is registered but U9 will activate it",
    );
  };

  const registry = {
    useAppletAPI,
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
  ] = await Promise.all([
    loadModule("react"),
    loadModule("react-dom"),
    loadModule("react/jsx-runtime"),
    loadModule("react/jsx-dev-runtime"),
    loadModule("@thinkwork/ui"),
    loadModule("@thinkwork/computer-stdlib"),
    loadModule("recharts"),
    loadModule("lucide-react"),
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
  }
}
