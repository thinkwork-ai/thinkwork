import { useState } from "react";
import { CheckIcon, CopyIcon, Database, Waypoints } from "lucide-react";
import { Button } from "@thinkwork/ui/button";
import { type DataCitation } from "@/lib/data-citation-panel";

/**
 * Detail view for one data citation (brain_ask analytics/graph query),
 * rendered inside the docked artifact panel: the executed query text plus
 * the execution metadata the server reported. Everything shown comes from
 * the encoded `data-cite:` panel id — there is nothing to fetch.
 */

function CopyQueryButton({ query }: { query: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — leave the button in its idle state.
    }
  };
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="absolute right-2 top-2 shrink-0"
      aria-label="Copy query"
      onClick={copy}
    >
      <Icon size={14} />
    </Button>
  );
}

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (value === null) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-foreground">{value}</dd>
    </>
  );
}

export function DataCitationViewer({ citation }: { citation: DataCitation }) {
  const isGraph = citation.kind === "graph";
  const Icon = isGraph ? Waypoints : Database;
  return (
    <div className="grid content-start gap-4 p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 rounded border border-border/70 px-1.5 py-0.5 font-mono text-[11px] uppercase text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {isGraph ? "graph" : "SQL"}
        </span>
        {(citation.tables ?? []).map((table) => (
          <span
            key={table}
            className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
            title={table}
          >
            {table}
          </span>
        ))}
      </div>
      {citation.query ? (
        <div className="relative min-w-0 rounded-md border border-border/70 bg-muted/40">
          <pre className="max-h-96 overflow-auto p-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
            {citation.query}
          </pre>
          <CopyQueryButton query={citation.query} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Query text not available for this key.
        </p>
      )}
      {citation.truncated ? (
        <p className="text-xs text-muted-foreground">
          Results were truncated — the agent saw only the first{" "}
          {citation.rowCount} {citation.rowCount === 1 ? "row" : "rows"}.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-xs">
        <MetadataRow label="Database" value={citation.database ?? null} />
        <MetadataRow label="Rows" value={String(citation.rowCount)} />
        <MetadataRow
          label="Athena execution"
          value={citation.queryExecutionId ?? null}
        />
        <MetadataRow
          label="Pack sequence"
          value={
            citation.packSequence != null ? String(citation.packSequence) : null
          }
        />
        <MetadataRow
          label="Elapsed"
          value={`${Math.round(citation.elapsedMs)}ms`}
        />
      </dl>
    </div>
  );
}
