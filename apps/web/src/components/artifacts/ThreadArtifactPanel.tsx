/**
 * THINK-168 U4: the docked in-thread artifact panel.
 *
 * Clicking an ArtifactCard in a transcript opens the referenced artifact here,
 * beside the conversation, instead of navigating away. The body reuses the
 * post-declutter shared views (ArtifactBodyView); canvas save/pin/refresh
 * reuse CanvasHeaderActions as muted header icons. The full /artifacts/$id
 * page remains for deep links — the header keeps an explicit "Open full page"
 * affordance.
 *
 * Live updates: when the agent re-emits the canvas in this thread (same
 * stable json-render part id), the host bumps `jsonRenderPartVersions` from
 * the onThreadTurnStep subscription fold and the panel refetches its
 * artifact — no visible polling.
 */

import { useCallback, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { SquareArrowOutUpRight, X } from "lucide-react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import {
  ArtifactBodyView,
  coerceArtifactMetadataRecord,
  isCanvasArtifactNode,
  type ArtifactBodyNode,
} from "@/components/artifacts/ArtifactBodyView";
import { bornCanvasStablePartId } from "@/components/artifacts/ArtifactCard";
import { CanvasHeaderActions } from "@/components/artifacts/canvas/CanvasHeaderActions";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { ArtifactDetailForRouteQuery } from "@/lib/graphql-queries";

/** Trailing debounce for live re-emission refetches — a streamed emission can
 *  arrive as several subscription chunks; collapse them into one refetch that
 *  also gives the born-as-artifact upsert a beat to persist the new head. */
const LIVE_REFRESH_DEBOUNCE_MS = 400;

interface PanelArtifactResult {
  artifact?: (ArtifactBodyNode & { threadId?: string | null }) | null;
}

export function ThreadArtifactPanel({
  artifactId,
  onClose,
  jsonRenderPartVersions,
}: {
  artifactId: string;
  onClose: () => void;
  /** partId → bump counter from the host's onThreadTurnStep fold. */
  jsonRenderPartVersions?: ReadonlyMap<string, number>;
}) {
  const [{ data, fetching, error }, reexecuteQuery] =
    useQuery<PanelArtifactResult>({
      query: ArtifactDetailForRouteQuery,
      variables: { id: artifactId },
      requestPolicy: "cache-and-network",
    });
  const artifact = data?.artifact ?? null;

  const refetch = useCallback(() => {
    reexecuteQuery({ requestPolicy: "network-only" });
  }, [reexecuteQuery]);

  // Same stable part id re-emitted in the open thread → refresh the panel.
  // Metadata may arrive as an AWSJSON string — coerce before reading.
  const stablePartId = useMemo(
    () =>
      artifact
        ? bornCanvasStablePartId({
            metadata: coerceArtifactMetadataRecord(artifact.metadata),
          })
        : null,
    [artifact],
  );
  const liveVersion = stablePartId
    ? (jsonRenderPartVersions?.get(stablePartId) ?? 0)
    : 0;
  useEffect(() => {
    if (!liveVersion) return;
    const timeout = window.setTimeout(refetch, LIVE_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [liveVersion, refetch]);

  const isCanvas = artifact ? isCanvasArtifactNode(artifact) : false;
  const hasBindings = (artifact?.bindings ?? []).length > 0;

  return (
    <aside
      // Fills its ResizablePanel — TaskThreadView owns the split and the
      // drag handle (which draws the divider line, so no border-l here).
      className="relative flex h-full w-full min-w-0 flex-col bg-background"
      aria-label="Artifact panel"
      data-testid="thread-artifact-panel"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border/70 py-1.5 pl-4 pr-2">
        <h2
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          data-testid="thread-artifact-panel-title"
        >
          {artifact?.title ?? "Artifact"}
        </h2>
        {artifact && isCanvas ? (
          <CanvasHeaderActions
            artifact={{
              id: artifact.id,
              title: artifact.title,
              status: artifact.status,
              // THINK-167 owner-refresh dispatch target: the canvas's thread.
              threadId: artifact.threadId ?? null,
            }}
            hasBindings={hasBindings}
            onChanged={refetch}
          />
        ) : null}
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link
            to="/artifacts/$id"
            params={{ id: artifactId }}
            title="Open full page"
            aria-label="Open full page"
            data-testid="thread-artifact-panel-full-page"
          >
            <SquareArrowOutUpRight className="size-4" />
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Close artifact panel"
          aria-label="Close artifact panel"
          onClick={onClose}
          data-testid="thread-artifact-panel-close"
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {artifact ? (
          <ArtifactBodyView artifact={artifact} />
        ) : fetching ? (
          <div className="flex h-full items-center justify-center p-6">
            <LoadingShimmer
              text="Loading artifact..."
              ariaLabel="Loading artifact"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">
              {error?.message || "Artifact not found."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
