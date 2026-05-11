import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import {
  AppletFailure,
  AppletLoading,
  AppletMount,
  appletSource,
  useAppletInstanceId,
  type AppletModuleLoader,
} from "@/applets/mount";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { ArtifactDetailActions } from "@/components/artifacts/ArtifactDetailActions";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  resolveGeneratedAppRuntimeMode,
  type AppletPayload,
} from "@/lib/app-artifacts";
import { AppletQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/artifacts/$id")({
  component: AppArtifactPage,
});

interface AppletResult {
  applet?: AppletPayload | null;
}

function AppArtifactPage() {
  const { id } = Route.useParams();
  return <AppletRouteContent appId={id} />;
}

export function AppletRouteContent({
  appId,
  loadModule,
}: {
  appId: string;
  // Plan-012 U11.5: do NOT default to defaultAppletModuleLoader. The
  // production AppletMount routes by `loadModule === undefined` —
  // defaulting here would force every production render through the
  // legacy same-origin path and bypass the iframe substrate. Tests
  // pass an explicit loader to opt into the legacy code path.
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
  const runtimeMode = resolveGeneratedAppRuntimeMode(applet?.metadata);
  const latestVersion = applet?.applet?.version ?? null;
  const artifactId = applet?.applet?.artifact?.id ?? null;
  const favoritedAt = applet?.applet?.artifact?.favoritedAt ?? null;
  const instanceId = useAppletInstanceId(appId);
  const [mountedSnapshot, setMountedSnapshot] = useState<{
    appId: string;
    instanceId: string;
    source: string;
    version: number;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [headerAction, setHeaderAction] = useState<ReactNode>(null);
  const handleHeaderActionChange = useCallback((action: ReactNode | null) => {
    setHeaderAction(action);
  }, []);

  // Compose the page-header action slot: any applet-defined action
  // (rendered by AppletMount) plus the artifact-management dropdown on
  // the far right. Hide the dropdown until we know the underlying
  // artifact id — the favorite/delete mutations need it.
  const composedHeaderAction = useMemo<ReactNode>(() => {
    const detailActions = artifactId ? (
      <ArtifactDetailActions
        artifactId={artifactId}
        artifactTitle={title}
        favoritedAt={favoritedAt}
      />
    ) : null;
    if (!headerAction && !detailActions) return null;
    return (
      <div className="flex items-center gap-1">
        {headerAction}
        {detailActions}
      </div>
    );
  }, [artifactId, favoritedAt, headerAction, title]);

  usePageHeaderActions({
    title,
    backHref: "/artifacts",
    backBehavior: "history",
    action: composedHeaderAction,
    actionKey: composedHeaderAction
      ? `artifact-actions:${artifactId ?? "_"}:${favoritedAt ?? "_"}:${headerAction ? "1" : "0"}`
      : "",
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      reexecuteAppletQuery({ requestPolicy: "network-only" });
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [reexecuteAppletQuery]);

  useEffect(() => {
    if (!source) return;
    setHeaderAction(null);
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
      <AppArtifactSplitShell title={title} runtimeMode={runtimeMode}>
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
    <AppArtifactSplitShell title={title} runtimeMode={runtimeMode}>
      <div className="grid h-full min-h-0 min-w-0 p-4">
        {hasNewerVersion ? (
          <div className="m-4 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
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
            // Forward only when supplied — production renders pass
            // undefined so AppletMount routes to the iframe path.
            {...(loadModule ? { loadModule } : {})}
            onHeaderActionChange={handleHeaderActionChange}
          />
        ) : (
          <AppletLoading />
        )}
      </div>
    </AppArtifactSplitShell>
  );
}

// Re-export AppletMount for any external consumers that imported it from this
// route module before the extraction. Prefer importing directly from
// `@/applets/mount` for new code.
export { AppletMount } from "@/applets/mount";
