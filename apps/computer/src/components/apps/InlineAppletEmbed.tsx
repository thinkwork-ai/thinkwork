import { useMemo } from "react";
import { useQuery } from "urql";
import {
  AppletFailure,
  AppletLoading,
  AppletMount,
  appletSource,
  useAppletInstanceId,
  type AppletModuleLoader,
} from "@/applets/mount";
import {
  resolveGeneratedAppRuntimeMode,
  type AppletPayload,
} from "@/lib/app-artifacts";
import { AppletQuery } from "@/lib/graphql-queries";

interface AppletResult {
  applet?: AppletPayload | null;
}

interface InlineAppletEmbedProps {
  appId: string;
  // Initial/minimum pixel height before the iframe reports its content height.
  // After mount, inline embeds grow to content to avoid nested scroll regions
  // inside thread transcripts.
  height?: number;
  // Test seam: lets unit tests inject a fake module loader so tests don't have
  // to spin up the real applet transform pipeline. Plan-012 U11.5: this is
  // intentionally NOT defaulted to defaultAppletModuleLoader — production
  // renders MUST pass undefined so AppletMount routes to the iframe substrate.
  loadModule?: AppletModuleLoader;
}

export function InlineAppletEmbed({
  appId,
  height = 480,
  loadModule,
}: InlineAppletEmbedProps) {
  const [{ data, fetching, error }] = useQuery<AppletResult>({
    query: AppletQuery,
    variables: { appId },
    requestPolicy: "cache-and-network",
  });
  const applet = data?.applet ?? null;
  const source = useMemo(() => appletSource(applet), [applet]);
  const runtimeMode = resolveGeneratedAppRuntimeMode(applet?.metadata);
  const version = applet?.applet?.version ?? 1;
  const instanceId = useAppletInstanceId(appId);

  if (error) {
    return (
      <AppletFailure>
        Failed to load app: {error.message}
      </AppletFailure>
    );
  }
  if (!applet) {
    return fetching ? (
      <AppletLoading />
    ) : (
      <AppletFailure>Artifact not found.</AppletFailure>
    );
  }
  if (!source) {
    return (
      <AppletFailure>
        This artifact does not include a source file that can be mounted.
      </AppletFailure>
    );
  }

  return (
    <div
      className="overflow-visible bg-background"
      data-runtime-mode={runtimeMode}
      data-testid="inline-applet-embed"
      style={{ minHeight: height }}
    >
      <AppletMount
        appId={appId}
        instanceId={instanceId}
        source={source}
        version={version}
        // Forward only when supplied — production renders pass
        // undefined so AppletMount routes to the iframe substrate.
        {...(loadModule ? { loadModule } : {})}
        hideRefreshControl
        fitContentHeight
      />
    </div>
  );
}
