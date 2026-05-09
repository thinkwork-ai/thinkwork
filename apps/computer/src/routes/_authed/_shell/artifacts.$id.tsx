import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import {
  AppletFailure,
  AppletLoading,
  AppletMount,
  appletSource,
  defaultAppletModuleLoader,
  useAppletInstanceId,
  type AppletModuleLoader,
} from "@/applets/mount";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import type { AppletPayload } from "@/lib/app-artifacts";
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

// Re-export AppletMount for any external consumers that imported it from this
// route module before the extraction. Prefer importing directly from
// `@/applets/mount` for new code.
export { AppletMount } from "@/applets/mount";
