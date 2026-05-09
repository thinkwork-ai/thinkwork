import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import type { AppletRefreshResult } from "@thinkwork/computer-stdlib";
import { registerAppletRefreshHandler } from "@/applets/host-applet-api";
import { loadAppletHostExternals } from "@/applets/host-registry";
import { transformApplet } from "@/applets/transform/transform";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { AppRefreshControl } from "@/components/apps/AppRefreshControl";
import { AppletErrorBoundary } from "@/components/apps/AppletErrorBoundary";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import type { AppletPayload } from "@/lib/app-artifacts";
import { AppletQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/artifacts/$id")({
  component: AppArtifactPage,
});

interface AppletResult {
  applet?: AppletPayload | null;
}

type AppletModule = {
  default?: ComponentType<AppletComponentProps>;
  refresh?: () => Promise<AppletRefreshResult>;
};

type AppletModuleLoader = (moduleUrl: string) => Promise<AppletModule>;

interface AppletComponentProps {
  appId: string;
  instanceId: string;
  refreshData?: unknown;
}

const defaultAppletModuleLoader: AppletModuleLoader = (moduleUrl) =>
  import(/* @vite-ignore */ moduleUrl) as Promise<AppletModule>;

function AppArtifactPage() {
  const { id } = Route.useParams();
  return <AppletRouteContent appId={id} />;
}

export function AppletRouteContent({
  appId,
  loadModule = defaultAppletModuleLoader,
}: {
  appId: string;
  loadModule?: AppletModuleLoader;
}) {
  const [{ data, fetching, error }, reexecuteAppletQuery] =
    useQuery<AppletResult>({
      query: AppletQuery,
      variables: { appId },
      requestPolicy: "cache-and-network",
    });
  const applet = data?.applet ?? null;
  const title = applet?.applet?.name?.trim() || "Artifact";
  const source = useMemo(() => appletSource(applet), [applet]);
  const latestVersion = applet?.applet?.version ?? null;
  const instanceId = useAppletInstanceId(appId);
  const [mountedSnapshot, setMountedSnapshot] = useState<{
    appId: string;
    instanceId: string;
    source: string;
    version: number;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  usePageHeaderActions({ title, backHref: "/artifacts" });

  useEffect(() => {
    const interval = window.setInterval(() => {
      reexecuteAppletQuery({ requestPolicy: "network-only" });
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [reexecuteAppletQuery]);

  useEffect(() => {
    if (!source) return;
    setMountedSnapshot((current) => {
      if (current?.appId === appId) return current;
      return {
        appId,
        instanceId,
        source,
        version: latestVersion ?? 1,
      };
    });
  }, [appId, instanceId, latestVersion, source]);

  if (!applet) {
    return (
      <main className="flex h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          {fetching
            ? "Loading artifact..."
            : error?.message || "Artifact not found."}
        </p>
      </main>
    );
  }

  if (!source) {
    return (
      <AppArtifactSplitShell title={title}>
        <AppletFailure>
          This artifact does not include a source file that can be mounted.
        </AppletFailure>
      </AppArtifactSplitShell>
    );
  }

  const hasNewerVersion =
    typeof latestVersion === "number" &&
    typeof mountedSnapshot?.version === "number" &&
    latestVersion > mountedSnapshot.version;

  return (
    <AppArtifactSplitShell title={title}>
      <div className="grid min-w-0 gap-4">
        {hasNewerVersion ? (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-primary">
              A newer version of this artifact is available.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="justify-self-start"
              onClick={() => {
                if (source) {
                  setMountedSnapshot({
                    appId,
                    instanceId,
                    source,
                    version: latestVersion ?? 1,
                  });
                }
                setReloadNonce((value) => value + 1);
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              Reload
            </Button>
          </div>
        ) : null}
        {mountedSnapshot ? (
          <AppletMount
            key={`${mountedSnapshot.appId}:${mountedSnapshot.version}:${reloadNonce}`}
            appId={mountedSnapshot.appId}
            instanceId={mountedSnapshot.instanceId}
            source={mountedSnapshot.source}
            version={mountedSnapshot.version}
            loadModule={loadModule}
          />
        ) : (
          <AppletLoading />
        )}
      </div>
    </AppArtifactSplitShell>
  );
}

export function AppletMount({
  appId,
  instanceId,
  source,
  version,
  loadModule = defaultAppletModuleLoader,
}: {
  appId: string;
  instanceId: string;
  source: string;
  version: number;
  loadModule?: AppletModuleLoader;
}) {
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

  if (state.status === "loading") {
    return <AppletLoading />;
  }

  if (state.status === "error") {
    return <AppletFailure>{state.message}</AppletFailure>;
  }

  const MountedApplet = state.Component;
  return (
    <div className="grid min-w-0 gap-4">
      {state.refresh ? (
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

function useAppletInstanceId(appId: string) {
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

function AppletLoading() {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-6 text-sm text-muted-foreground">
      Loading artifact...
    </div>
  );
}

function AppletFailure({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-background p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function appletSource(applet: AppletPayload | null): string | null {
  if (!applet) return null;
  if (typeof applet.source === "string" && applet.source.trim()) {
    return applet.source;
  }
  if (applet.files && typeof applet.files["App.tsx"] === "string") {
    return applet.files["App.tsx"];
  }
  return null;
}
