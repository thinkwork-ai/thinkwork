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
 * List state: `artifactId === THREAD_ARTIFACT_PANEL_LIST` renders a compact
 * vertical list of the thread's card-rendered artifacts (newest first);
 * choosing one loads it in this same panel. When a list exists (>1 artifact)
 * the artifact view shows a back-to-list button.
 *
 * Live updates: when the agent re-emits the canvas in this thread (same
 * stable json-render part id), the host bumps `jsonRenderPartVersions` from
 * the onThreadTurnStep subscription fold and the panel refetches its
 * artifact — no visible polling.
 */

import { useCallback, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Maximize2, SquareArrowOutUpRight, X } from "lucide-react";
import { useQuery } from "urql";
import { TooltipIconButton } from "@thinkwork/ui";
import {
  ArtifactBodyView,
  coerceArtifactMetadataRecord,
  isCanvasArtifactNode,
  type ArtifactBodyNode,
} from "@/components/artifacts/ArtifactBodyView";
import {
  ArtifactCard,
  bornCanvasStablePartId,
  type ArtifactCardData,
} from "@/components/artifacts/ArtifactCard";
import { CanvasHeaderActions } from "@/components/artifacts/canvas/CanvasHeaderActions";
import { KnowledgeDocumentViewer } from "@/components/documents/KnowledgeDocumentViewer";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { THREAD_ARTIFACT_PANEL_LIST } from "@/components/artifacts/thread-artifact-panel-store";
import {
  knowledgeDocumentFileName,
  opensInDocumentViewer,
  parseKbDocPanelId,
} from "@/lib/knowledge-doc-viewer";
import {
  ArtifactDetailForRouteQuery,
  DocumentArtifactForPanelQuery,
} from "@/lib/graphql-queries";

/** Trailing debounce for live re-emission refetches — a streamed emission can
 *  arrive as several subscription chunks; collapse them into one refetch that
 *  also gives the born-as-artifact upsert a beat to persist the new head. */
const LIVE_REFRESH_DEBOUNCE_MS = 400;

interface PanelArtifactResult {
  artifact?: (ArtifactBodyNode & { threadId?: string | null }) | null;
}

export function ThreadArtifactPanel({
  artifactId,
  fallbackDocumentId = null,
  listArtifacts = [],
  onOpenArtifact,
  onBackToList,
  onClose,
  jsonRenderPartVersions,
}: {
  /** Artifact to show, or THREAD_ARTIFACT_PANEL_LIST for the list state. */
  artifactId: string;
  /**
   * The card's logical documentId (when the opened card carried one). Used
   * only as a self-heal: if `artifactId` no longer resolves (the card
   * pointed at a fork that was cleaned up), the panel re-resolves the LIVING
   * document by this id instead of showing "Artifact not found."
   */
  fallbackDocumentId?: string | null;
  /** The thread's card-rendered artifacts, newest first (list state). */
  listArtifacts?: ArtifactCardData[];
  /** Load an artifact picked from the list (in this same panel). */
  onOpenArtifact?: (artifactId: string) => void;
  /** Present only when a list exists (>1 artifacts) — renders the ← button. */
  onBackToList?: () => void;
  onClose: () => void;
  /** partId → bump counter from the host's onThreadTurnStep fold. */
  jsonRenderPartVersions?: ReadonlyMap<string, number>;
}) {
  const isListState = artifactId === THREAD_ARTIFACT_PANEL_LIST;
  // Cited knowledge documents ride through the store as `kb-doc:` ids — no
  // artifact row exists for them, so both queries stay paused.
  const kbDoc = useMemo(() => parseKbDocPanelId(artifactId), [artifactId]);
  const [{ data, fetching, error }, reexecuteQuery] =
    useQuery<PanelArtifactResult>({
      query: ArtifactDetailForRouteQuery,
      variables: { id: artifactId },
      requestPolicy: "cache-and-network",
      pause: isListState || !!kbDoc,
    });
  const primaryMissing = !isListState && !kbDoc && !fetching && !data?.artifact;
  const [{ data: fallbackData, fetching: fallbackFetching }] = useQuery<{
    documentArtifact?: (ArtifactBodyNode & { threadId?: string | null }) | null;
  }>({
    query: DocumentArtifactForPanelQuery,
    variables: { documentId: fallbackDocumentId ?? "" },
    requestPolicy: "cache-and-network",
    pause: isListState || !!kbDoc || !fallbackDocumentId || !primaryMissing,
  });
  const artifact = isListState
    ? null
    : (data?.artifact ??
      (primaryMissing && fallbackDocumentId
        ? (fallbackData?.documentArtifact ?? null)
        : null));

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
      <header className="flex shrink-0 items-center gap-1 border-b border-border/70 py-1.5 pl-2 pr-2">
        {!isListState && onBackToList ? (
          <TooltipIconButton
            type="button"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            label="Back to artifact list"
            onClick={onBackToList}
            data-testid="thread-artifact-panel-back"
          >
            <ArrowLeft className="size-4" />
          </TooltipIconButton>
        ) : null}
        <h2
          className="min-w-0 flex-1 truncate pl-2 text-sm font-medium text-foreground"
          data-testid="thread-artifact-panel-title"
        >
          {isListState
            ? "Artifacts"
            : kbDoc
              ? `${knowledgeDocumentFileName(kbDoc.key)}${kbDoc.page ? ` · p.${kbDoc.page}` : ""}`
              : (artifact?.title ?? "Artifact")}
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
        {kbDoc ? (
          <TooltipIconButton
            asChild
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            label="Full screen"
          >
            <Link
              to="/documents/view"
              search={{
                src: kbDoc.src,
                key: kbDoc.key,
                ...(kbDoc.page ? { page: kbDoc.page } : {}),
              }}
              data-testid="thread-artifact-panel-full-page"
            >
              <Maximize2 className="size-4" />
            </Link>
          </TooltipIconButton>
        ) : !isListState ? (
          <TooltipIconButton
            asChild
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            label="Open full page"
          >
            <Link
              to="/artifacts/$id"
              params={{ id: artifact?.id ?? artifactId }}
              data-testid="thread-artifact-panel-full-page"
            >
              <SquareArrowOutUpRight className="size-4" />
            </Link>
          </TooltipIconButton>
        ) : null}
        <TooltipIconButton
          type="button"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          label="Close artifact panel"
          onClick={onClose}
          data-testid="thread-artifact-panel-close"
        >
          <X className="size-4" />
        </TooltipIconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {kbDoc ? (
          opensInDocumentViewer(kbDoc.key) ? (
            // Office/CSV: no native browser renderer — embedded Zrimo viewer.
            <KnowledgeDocumentViewer
              embedded
              src={kbDoc.src}
              documentKey={kbDoc.key}
              page={kbDoc.page}
            />
          ) : (
            // pdf/txt/md…: the browser renders the signed link natively, and
            // its PDF viewer honours the #page= deep link. Not sandboxed —
            // sandbox would disable the PDF viewer; the content is
            // cross-origin (S3 presign) so it gets no app privileges.
            <iframe
              title={knowledgeDocumentFileName(kbDoc.key)}
              src={kbDoc.page ? `${kbDoc.src}#page=${kbDoc.page}` : kbDoc.src}
              className="h-full w-full border-0"
              data-testid="thread-artifact-panel-doc-frame"
            />
          )
        ) : isListState ? (
          <div
            className="grid content-start gap-1 p-3"
            data-testid="thread-artifact-panel-list"
          >
            {listArtifacts.map((card) => (
              <ArtifactCard
                key={`panel-list-${card.id}`}
                artifact={card}
                onOpen={
                  onOpenArtifact ? () => onOpenArtifact(card.id) : undefined
                }
              />
            ))}
          </div>
        ) : artifact ? (
          <ArtifactBodyView artifact={artifact} />
        ) : fetching || (primaryMissing && fallbackFetching) ? (
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
