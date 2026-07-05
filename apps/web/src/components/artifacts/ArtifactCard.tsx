/**
 * Shared compact artifact card (THINK-166 U3).
 *
 * ONE rendering pattern for every artifact reference in the chat transcript:
 * title, open-string type badge, "status · vN" when available, and an
 * "Open →" affordance linking to /artifacts/$id.
 *
 * `artifact.type` is an OPEN string (plugin types included) — render it
 * verbatim; never switch exhaustively over it.
 *
 * Generalized from the THINK-147 document card (DocumentCard now delegates
 * here) so documents, canvases, and unknown plugin artifact types all share
 * the same in-thread presentation.
 */

import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { isLivingCanvasMetadata } from "@/components/artifacts/canvas/canvas-content";

export interface ArtifactCardData {
  id: string;
  title: string;
  /** Open string artifact type — plugin types allowed. */
  type?: string | null;
  status?: string | null;
  headVersion?: number | null;
}

export function ArtifactCard({
  artifact,
  badge,
  statusLabel,
  description,
  openLabel = "Open →",
  testId = "artifact-card",
}: {
  artifact: ArtifactCardData;
  /**
   * Badge text override. Omit to show the artifact's type (falling back to
   * "Artifact"); pass `null` to hide the badge entirely.
   */
  badge?: string | null;
  /** Overrides the derived "Status · vN" label. */
  statusLabel?: string | null;
  description?: string | null;
  openLabel?: string;
  testId?: string;
}) {
  const badgeLabel =
    badge === null ? null : (badge ?? artifact.type ?? "Artifact");
  const resolvedStatus =
    statusLabel === null
      ? null
      : (statusLabel ??
        deriveStatusLabel(artifact.status, artifact.headVersion));
  return (
    <Link
      to="/artifacts/$id"
      params={{ id: artifact.id }}
      className="not-prose group my-1 flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      data-testid={testId}
    >
      <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground group-hover:text-foreground">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {artifact.title}
          </span>
          {badgeLabel ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {badgeLabel}
            </span>
          ) : null}
          {resolvedStatus ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {resolvedStatus}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
        <span className="mt-1 inline-block text-xs font-medium text-primary">
          {openLabel}
        </span>
      </div>
    </Link>
  );
}

/** "Draft", "Final · v3", … — status is an open string too. */
export function deriveStatusLabel(
  status?: string | null,
  headVersion?: number | null,
): string | null {
  const trimmed = status?.trim();
  if (!trimmed) return null;
  const pretty =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  const version =
    typeof headVersion === "number" && headVersion > 0
      ? ` · v${headVersion}`
      : "";
  return `${pretty}${version}`;
}

/**
 * Born-as-artifact linkage (THINK-145 R10): a message's durable artifact is a
 * living GenUI canvas iff its metadata carries `kind: "json_render_canvas"`;
 * its `metadata.stablePartId` is the emission's stable json-render part id
 * ("json-render:<hash>"), which lets the transcript collapse that inline
 * emission down to this card.
 */
export function bornCanvasStablePartId(artifact: {
  metadata?: Record<string, unknown> | null;
}): string | null {
  if (!isLivingCanvasMetadata(artifact.metadata)) return null;
  const stablePartId = artifact.metadata?.stablePartId;
  return typeof stablePartId === "string" && stablePartId.length > 0
    ? stablePartId
    : null;
}

/**
 * Stable-part-id prefix the runtime stamps on GFM-table safety-net
 * conversions (wire contract with `packages/agentcore-pi` server.ts:
 * `json-render:safety-net:<specHash>`). Safety-net renders are transient
 * transcript furniture — they keep rendering inline and never collapse to an
 * artifact card, even though the born-as-artifact upsert mints a draft row
 * for them (titled by their generic fallback, e.g. "Table").
 */
export const SAFETY_NET_PART_ID_PREFIX = "json-render:safety-net:";

export function isSafetyNetPartId(partId: string | null | undefined): boolean {
  return Boolean(partId?.startsWith(SAFETY_NET_PART_ID_PREFIX));
}
