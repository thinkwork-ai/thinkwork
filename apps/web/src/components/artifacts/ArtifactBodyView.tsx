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

import { InlineAppletEmbed } from "@/components/apps/InlineAppletEmbed";
import { CanvasArtifactView } from "@/components/artifacts/canvas/CanvasArtifactView";
import { isAppArtifact } from "@/components/workbench/GeneratedArtifactCard";
import type { CanvasVersion } from "@/components/artifacts/canvas/CanvasVersionHistory";
import type { CanvasBinding } from "@/components/artifacts/canvas/binding-display";
import { isLivingCanvasMetadata } from "@/components/artifacts/canvas/canvas-content";
import { DocumentFrame } from "@/components/workbench/DocumentFrame";
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
}: {
  artifact: Pick<
    ArtifactBodyNode,
    "title" | "type" | "status" | "headVersion" | "renderHtml" | "updatedAt"
  >;
}) {
  const statusChip =
    artifact.status === "FINAL"
      ? `Final · v${artifact.headVersion ?? 0}`
      : "Draft";

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium capitalize">
          {artifact.type.toLowerCase()}
        </span>
        <span data-testid="document-status-chip">{statusChip}</span>
        <span>· Updated {relativeTime(artifact.updatedAt)}</span>
      </div>
      {artifact.renderHtml ? (
        <DocumentFrame
          html={artifact.renderHtml}
          title={artifact.title}
          fullHeight
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            This document&apos;s render is unavailable. The markdown record is
            preserved; try re-emitting the document from its thread.
          </p>
        </div>
      )}
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
