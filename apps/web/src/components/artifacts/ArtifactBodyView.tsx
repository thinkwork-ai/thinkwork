/**
 * Shared chrome-free artifact body renderer (THINK-168 U4).
 *
 * Extracted from the /artifacts/$id route so the same post-declutter views
 * render both on the full page and in the in-thread docked panel:
 *   - HTML documents → status strip + zero-grant DocumentFrame (THINK-147)
 *   - living canvases → CanvasArtifactView (THINK-145 U10)
 *   - anything else → the full page's "cannot be opened here" fallback
 *
 * Header actions (save/pin/refresh/download) stay with the host — the route
 * composes them into the page header, the thread panel into its own header.
 */

import { useState } from "react";
import { useQuery } from "urql";
import { InlineAppletEmbed } from "@/components/apps/InlineAppletEmbed";
import { CanvasArtifactView } from "@/components/artifacts/canvas/CanvasArtifactView";
import { isAppArtifact } from "@/components/workbench/GeneratedArtifactCard";
import type { CanvasVersion } from "@/components/artifacts/canvas/CanvasVersionHistory";
import type { CanvasBinding } from "@/components/artifacts/canvas/binding-display";
import { isLivingCanvasMetadata } from "@/components/artifacts/canvas/canvas-content";
import { DocumentFrame } from "@/components/workbench/DocumentFrame";
import { DocumentVersionRenderQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export interface ArtifactBodyNode {
  id: string;
  title: string;
  type: string;
  status: string;
  headVersion?: number | null;
  spaceId?: string | null;
  content?: string | null;
  renderHtml?: string | null;
  summary?: string | null;
  metadata?: unknown;
  updatedAt: string;
  // THINK-155: scheduled-refresh observability. refreshFailedAt newer than
  // lastRefreshAt means the document is stale (a scheduled refresh failed
  // since the last success).
  lastRefreshAt?: string | null;
  refreshFailedAt?: string | null;
  bindings?: CanvasBinding[] | null;
  versions?: CanvasVersion[] | null;
}

/** HTML Document Artifacts (THINK-147): dual-body document detection. */
export function isDocumentArtifactMetadata(metadata: unknown): boolean {
  const parsed =
    typeof metadata === "string"
      ? (() => {
          try {
            return JSON.parse(metadata) as unknown;
          } catch {
            return null;
          }
        })()
      : metadata;
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as { kind?: unknown }).kind === "document"
  );
}

/** True when the artifact renders as a living GenUI canvas. */
export function isCanvasArtifactNode(artifact: {
  type: string;
  metadata?: unknown;
}): boolean {
  return (
    artifact.type === "DATA_VIEW" && isLivingCanvasMetadata(artifact.metadata)
  );
}

/**
 * The document reader body (THINK-147 U6): status strip + access-gated
 * renderHtml in the zero-grant DocumentFrame. Shared verbatim between the
 * full-page route and the thread panel.
 */
export function DocumentArtifactBody({
  artifact,
  historyPlacement = "bottom",
}: {
  artifact: Pick<
    ArtifactBodyNode,
    | "id"
    | "title"
    | "type"
    | "status"
    | "headVersion"
    | "renderHtml"
    | "updatedAt"
    | "lastRefreshAt"
    | "refreshFailedAt"
    | "versions"
  >;
  /**
   * Where "Show all" opens the change log. The full-page route has spare
   * horizontal room — a right-hand vertical timeline ("side"). The docked
   * thread panel is narrow and keeps the bottom sheet ("bottom", default).
   */
  historyPlacement?: "side" | "bottom";
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  // The pinned version being viewed read-only; null = the living head.
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [{ data: versionData, fetching: versionFetching }] = useQuery<{
    documentVersionRender?: string | null;
  }>({
    query: DocumentVersionRenderQuery,
    variables: { artifactId: artifact.id, version: viewVersion ?? 0 },
    pause: viewVersion === null,
  });

  const statusChip =
    artifact.status === "FINAL"
      ? `Final · v${artifact.headVersion ?? 0}`
      : "Draft";
  // THINK-155 R8: stale when a scheduled refresh failed since the last
  // success. Never-refreshed documents (both fields null) show nothing new.
  const refreshedAt = artifact.lastRefreshAt ?? null;
  const failedAt = artifact.refreshFailedAt ?? null;
  const isStale =
    !!failedAt && (!refreshedAt || new Date(failedAt) > new Date(refreshedAt));
  // Activity lives in the footer, not the header: the header identifies the
  // document (type + status); timestamps are updates. One freshness entry —
  // for a scheduled document the refresh IS the update, so "Refreshed"
  // replaces "Updated" whenever refresh state exists.
  const freshness = refreshedAt
    ? `Refreshed ${relativeTime(refreshedAt)}`
    : `Updated ${relativeTime(artifact.updatedAt)}`;

  const versions = artifact.versions ?? [];
  const headVersion = artifact.headVersion ?? 0;
  const versionRender =
    viewVersion !== null ? (versionData?.documentVersionRender ?? null) : null;
  const displayHtml =
    viewVersion !== null && versionRender !== null
      ? versionRender
      : artifact.renderHtml;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 font-medium capitalize">
          {artifact.type.toLowerCase()}
        </span>
        <span className="whitespace-nowrap" data-testid="document-status-chip">
          {statusChip}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {displayHtml ? (
            <DocumentFrame
              html={displayHtml}
              title={artifact.title}
              fullHeight
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-sm text-muted-foreground">
                {viewVersion !== null && versionFetching
                  ? "Loading version…"
                  : "This document's render is unavailable. The markdown record is preserved; try re-emitting the document from its thread."}
              </p>
            </div>
          )}
        </div>
        {historyOpen && historyPlacement === "side" && versions.length > 0 ? (
          <aside
            data-testid="document-history-timeline"
            className="w-64 shrink-0 overflow-y-auto border-l border-border/70 bg-muted/20 px-4 py-3 motion-safe:animate-in motion-safe:slide-in-from-right-4"
          >
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Change log
            </p>
            <ol className="relative ml-1 space-y-4 border-l border-border pl-4">
              {versions.map((v) => {
                const isHead = v.version === headVersion;
                const isViewing =
                  viewVersion === v.version || (viewVersion === null && isHead);
                return (
                  <li key={v.id} className="relative">
                    <span
                      aria-hidden
                      className={`absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full border ${
                        isViewing
                          ? "border-foreground bg-foreground"
                          : "border-muted-foreground/50 bg-background"
                      }`}
                    />
                    <button
                      type="button"
                      data-testid={`document-history-version-${v.version}`}
                      onClick={() => setViewVersion(isHead ? null : v.version)}
                      className="block w-full rounded px-1 py-0.5 text-left hover:bg-muted"
                    >
                      <span
                        className={`block text-xs ${
                          isViewing
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        v{v.version}
                        {isHead ? " · current" : ""}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {v.createdByName ?? "System"}
                      </span>
                      {v.createdAt ? (
                        <span className="block text-[11px] text-muted-foreground/70">
                          {relativeTime(v.createdAt)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        ) : null}
      </div>
      {historyOpen && historyPlacement === "bottom" && versions.length > 0 ? (
        <div
          data-testid="document-history-panel"
          className="max-h-48 overflow-y-auto border-t border-border/70 bg-muted/30 px-4 py-2 motion-safe:animate-in motion-safe:slide-in-from-bottom-2"
        >
          <ul className="space-y-0.5">
            {versions.map((v) => {
              const isHead = v.version === headVersion;
              const isViewing =
                viewVersion === v.version || (viewVersion === null && isHead);
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    data-testid={`document-history-version-${v.version}`}
                    onClick={() => setViewVersion(isHead ? null : v.version)}
                    className={`flex w-full items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-[11px] hover:bg-muted ${
                      isViewing
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="w-8 shrink-0 tabular-nums">
                      v{v.version}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {v.createdByName ?? "System"}
                      {isHead ? " · current" : ""}
                    </span>
                    {v.createdAt ? (
                      <span className="shrink-0 text-muted-foreground/70">
                        {relativeTime(v.createdAt)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="flex items-center gap-x-3 border-t border-border/70 px-4 py-1 text-[11px] text-muted-foreground/80">
        {viewVersion !== null ? (
          <button
            type="button"
            data-testid="document-back-to-latest"
            onClick={() => setViewVersion(null)}
            className="whitespace-nowrap font-medium text-foreground underline-offset-2 hover:underline"
          >
            Viewing v{viewVersion} — back to latest
          </button>
        ) : (
          <span
            className="whitespace-nowrap"
            data-testid="document-refreshed-chip"
          >
            {freshness}
          </span>
        )}
        {isStale && failedAt && viewVersion === null ? (
          <span
            data-testid="document-stale-chip"
            className="whitespace-nowrap font-medium text-amber-600 dark:text-amber-500"
          >
            Scheduled refresh failed {relativeTime(failedAt)}
          </span>
        ) : null}
        {versions.length > 0 ? (
          <button
            type="button"
            data-testid="document-history-toggle"
            onClick={() => setHistoryOpen((open) => !open)}
            className="ml-auto whitespace-nowrap text-muted-foreground/60 underline-offset-2 hover:text-muted-foreground hover:underline"
          >
            {historyOpen ? "Hide history" : "Show all"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** AWSJSON metadata may arrive as a string — coerce to a record for reads. */
export function coerceArtifactMetadataRecord(
  metadata: unknown,
): Record<string, unknown> | null {
  const parsed =
    typeof metadata === "string"
      ? (() => {
          try {
            return JSON.parse(metadata) as unknown;
          } catch {
            return null;
          }
        })()
      : metadata;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Body dispatch for every artifact type an in-thread ArtifactCard can open.
 * App artifacts (applets, research dashboards) embed their live applet —
 * the same inline embed the retired GeneratedArtifact side panel used.
 * Unknown/unsupported types show the same fallback the full page shows.
 */
export function ArtifactBodyView({ artifact }: { artifact: ArtifactBodyNode }) {
  if (isDocumentArtifactMetadata(artifact.metadata)) {
    return <DocumentArtifactBody artifact={artifact} />;
  }

  if (
    isAppArtifact({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      metadata: coerceArtifactMetadataRecord(artifact.metadata),
    })
  ) {
    return (
      <div className="p-4" data-testid="artifact-body-applet">
        <InlineAppletEmbed appId={artifact.id} />
      </div>
    );
  }

  if (isCanvasArtifactNode(artifact)) {
    return (
      <CanvasArtifactView
        artifact={{
          id: artifact.id,
          title: artifact.title,
          status: artifact.status,
          spaceId: artifact.spaceId ?? null,
          headVersion: artifact.headVersion ?? 0,
          content: artifact.content ?? null,
          summary: artifact.summary ?? null,
          bindings: artifact.bindings ?? [],
          versions: artifact.versions ?? [],
        }}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">
        This artifact type cannot be opened here.
      </p>
    </div>
  );
}
