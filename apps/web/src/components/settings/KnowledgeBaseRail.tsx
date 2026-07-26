// THINK-345 U5/U6: the KB detail page's side panel. Deliberately NOT a
// `Sheet` — that primitive wraps Radix Dialog and renders a `fixed inset-0`
// scrim, so it always overlays. R16 requires the panel to narrow the table
// instead, because the operator judges filename truncation against the
// table's actual width. So this is a plain flex sibling of the table, inside
// the content area and matching the table's height (the Ontology pattern) —
// not a full-height rail hanging off the page header.
//
// Two modes, branched on selection (KTD-2): Knowledge Base settings when no
// document is selected, that document's indexing state when one is.
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, TooltipIconButton } from "@thinkwork/ui";
import type { KbManifestDocument } from "@/lib/kb-files-api";

function docStatusVariant(
  status: string,
): "secondary" | "destructive" | "outline" {
  if (status === "indexed") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/**
 * R21: an operator needs to tell "indexed, but nothing was extractable" apart
 * from "not indexed yet". Page count is the signal the transcription pipeline
 * leaves behind, so status and page count are read together.
 */
export function documentContentSummary(doc: KbManifestDocument): string {
  if (doc.status === "failed") return "Indexing failed";
  if (doc.status !== "indexed") return "Not indexed yet";
  if (doc.pageCount === 0) return "Indexed, but no content was extracted";
  if (doc.pageCount == null) return "Indexed";
  return `Indexed · ${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`;
}

/** Label above value, not beside it — the panel is too narrow for a long
 * document key to share a line with its label without colliding. */
function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="border-b border-border px-3 py-2 last:border-b-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div
        className={
          mono
            ? "mt-0.5 break-all font-mono text-xs text-foreground"
            : "mt-0.5 break-words text-sm text-foreground"
        }
      >
        {children}
      </div>
    </div>
  );
}

function DocumentDetail({ doc }: { doc: KbManifestDocument }) {
  return (
    <div>
      <Field label="Name">{doc.name}</Field>
      <Field label="Key" mono>
        {doc.documentKey}
      </Field>
      <Field label="Source">
        {doc.sourceKind === "s3-connect" ? "Connected bucket" : "Upload"}
      </Field>
      <Field label="Status">
        <Badge variant={docStatusVariant(doc.status)}>{doc.status}</Badge>
      </Field>
      <Field label="Content">{documentContentSummary(doc)}</Field>
      <Field label="Projection">{doc.projectionStatus ?? "—"}</Field>
      <Field label="Edition">
        <span className="tabular-nums">{doc.edition ?? "—"}</span>
      </Field>
      <Field label="Pages">
        <span className="tabular-nums">{doc.pageCount ?? "—"}</span>
      </Field>
      <Field label="Last indexed">
        {formatTimestamp(doc.effectiveFrom ?? doc.updatedAt)}
      </Field>
      {doc.lastError ? (
        <div className="border-t border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-destructive">
            Last error
          </p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {doc.lastError}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeBaseRail({
  selectedDocument,
  settings,
  onClose,
}: {
  /** When set, the panel shows this document instead of KB settings. */
  selectedDocument: KbManifestDocument | null;
  /** KB settings content, owned by the page so the panel stays presentational. */
  settings: ReactNode;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label={
        selectedDocument ? "Document details" : "Knowledge Base settings"
      }
      data-testid="kb-rail"
      className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">
          {selectedDocument ? "Document" : "Settings"}
        </h2>
        <TooltipIconButton
          size="icon"
          aria-label="Close panel"
          label="Close panel"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </TooltipIconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedDocument ? (
          <DocumentDetail doc={selectedDocument} />
        ) : (
          <div className="p-3">{settings}</div>
        )}
      </div>
    </aside>
  );
}
