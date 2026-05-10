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
  Artifact,
  ArtifactContent,
} from "@/components/ai-elements/artifact";
import type { AppletPayload } from "@/lib/app-artifacts";
import { AppletQuery } from "@/lib/graphql-queries";

interface AppletResult {
  applet?: AppletPayload | null;
}

interface InlineAppletEmbedProps {
  appId: string;
  // Pixel height of the embed surface. Default sized to fit a chart or small
  // dashboard inside a thread message bubble without dominating the transcript.
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
  const version = applet?.applet?.version ?? 1;
  const instanceId = useAppletInstanceId(appId);

  if (error) {
    return (
      <AppletFailure>
        Failed to load applet: {error.message}
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

  // Plan-012 U12: lighter <Artifact> variant for inline embeds. The
  // surrounding thread message bubble already provides regenerate /
  // branch chrome via useChat, so the inline variant drops the header
  // entirely; the wrapper exists so future stylesheet passes can
  // target inline applets uniformly with canvas applets.
  return (
    <Artifact
      className="overflow-hidden rounded-md border border-border/70 bg-background shadow-none"
      data-testid="inline-applet-embed"
      style={{ height, maxHeight: "70vh" }}
    >
      <ArtifactContent className="h-full overflow-auto p-0">
        <AppletMount
          appId={appId}
          instanceId={instanceId}
          source={source}
          version={version}
          // Forward only when supplied — production renders pass
          // undefined so AppletMount routes to the iframe substrate.
          {...(loadModule ? { loadModule } : {})}
          hideRefreshControl
        />
      </ArtifactContent>
    </Artifact>
  );
}
