import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AppletRefreshResult } from "@thinkwork/computer-stdlib";
import { registerAppletRefreshHandler } from "@/applets/host-applet-api";
import { loadAppletHostExternals } from "@/applets/host-registry";
import { transformApplet } from "@/applets/transform/transform";
import { AppRefreshControl } from "@/components/apps/AppRefreshControl";
import { AppletErrorBoundary } from "@/components/apps/AppletErrorBoundary";
import type { AppletPayload } from "@/lib/app-artifacts";

export type AppletModule = {
  default?: ComponentType<AppletComponentProps>;
  refresh?: () => Promise<AppletRefreshResult>;
};

export type AppletModuleLoader = (moduleUrl: string) => Promise<AppletModule>;

export interface AppletComponentProps {
  appId: string;
  instanceId: string;
  refreshData?: unknown;
}

export const defaultAppletModuleLoader: AppletModuleLoader = (moduleUrl) =>
  import(/* @vite-ignore */ moduleUrl) as Promise<AppletModule>;

export interface AppletMountProps {
  appId: string;
  instanceId: string;
  source: string;
  version: number;
  loadModule?: AppletModuleLoader;
  onHeaderActionChange?: (action: ReactNode | null) => void;
  // When true, hides the AppRefreshControl banner. Used for inline (in-thread)
  // embeds where the surrounding card already provides controls and chrome.
  hideRefreshControl?: boolean;
}

export function AppletMount({
  appId,
  instanceId,
  source,
  version,
  loadModule = defaultAppletModuleLoader,
  onHeaderActionChange,
  hideRefreshControl = false,
}: AppletMountProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | {
        status: "ready";
        Component: ComponentType<AppletComponentProps>;
        resetKey: string;
        refresh?: () => Promise<AppletRefreshResult>;
      }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [refreshData, setRefreshData] = useState<unknown>();

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      setState({ status: "loading" });
      setRefreshData(undefined);
      registerAppletRefreshHandler(appId, instanceId, null);
      await loadAppletHostExternals();
      const transformed = await transformApplet(source, version, { appId });
      if (cancelled) return;
      if (!transformed.ok) {
        setState({ status: "error", message: transformed.error.message });
        return;
      }

      const module = await loadModule(transformed.compiledModuleUrl);
      if (cancelled) return;
      if (typeof module.default !== "function") {
        setState({
          status: "error",
          message: "Applet module must export a default React component.",
        });
        return;
      }

      setState({
        status: "ready",
        Component: module.default,
        resetKey: transformed.cacheKey,
        refresh: module.refresh,
      });
      registerAppletRefreshHandler(appId, instanceId, module.refresh ?? null);
    }

    mount().catch((error: unknown) => {
      if (cancelled) return;
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Applet mount failed.",
      });
    });

    return () => {
      cancelled = true;
      registerAppletRefreshHandler(appId, instanceId, null);
    };
  }, [appId, instanceId, loadModule, source, version]);

  useEffect(() => {
    if (!onHeaderActionChange) return;
    if (state.status !== "ready" || !state.refresh) {
      onHeaderActionChange(null);
      return;
    }

    onHeaderActionChange(
      <AppRefreshControl onRefresh={state.refresh} onData={setRefreshData} />,
    );
    return () => onHeaderActionChange(null);
  }, [onHeaderActionChange, state]);

  if (state.status === "loading") {
    return <AppletLoading />;
  }

  if (state.status === "error") {
    return <AppletFailure>{state.message}</AppletFailure>;
  }

  const MountedApplet = state.Component;
  return (
    <div className="grid min-w-0">
      {state.refresh && !hideRefreshControl && !onHeaderActionChange ? (
        <AppRefreshControl onRefresh={state.refresh} onData={setRefreshData} />
      ) : null}
      <AppletErrorBoundary resetKey={state.resetKey}>
        <div className="min-w-0 overflow-x-hidden">
          <MountedApplet
            appId={appId}
            instanceId={instanceId}
            refreshData={refreshData}
          />
        </div>
      </AppletErrorBoundary>
    </div>
  );
}

export function useAppletInstanceId(appId: string) {
  const [instanceId, setInstanceId] = useState(() =>
    storedAppletInstanceId(appId),
  );

  useEffect(() => {
    setInstanceId(storedAppletInstanceId(appId));
  }, [appId]);

  return instanceId;
}

function storedAppletInstanceId(appId: string) {
  const key = `thinkwork:applet-instance:${appId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const next =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

export function AppletLoading() {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-6 text-sm text-muted-foreground">
      Loading artifact...
    </div>
  );
}

export function AppletFailure({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-background p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function appletSource(applet: AppletPayload | null): string | null {
  if (!applet) return null;
  if (typeof applet.source === "string" && applet.source.trim()) {
    return applet.source;
  }
  if (applet.files && typeof applet.files["App.tsx"] === "string") {
    return applet.files["App.tsx"];
  }
  return null;
}
