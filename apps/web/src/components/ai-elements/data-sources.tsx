import { useState } from "react";
import { ChevronDown, Database, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  parseDataCitation,
  type DataCitation,
} from "@/lib/data-citation-panel";

/**
 * Data-source citations for one agent turn: "Used N data sources"
 * collapsible (sibling of KnowledgeSourcesCard), one row per distinct
 * analytics/graph query a brain_ask call executed. Clicking a row opens the
 * citation detail in the docked artifact panel via the caller's opener.
 */

/** One deduped citation, numbered 1..k in first-seen order. */
export interface DataCitationRow extends DataCitation {
  n: number;
}

/**
 * dataCitations arrays from a turn's brain_ask / brain_ask_result MCP
 * invocations. Recognition mirrors mcpKnowledgeRows in sources.tsx: the
 * container records the full MCP response under `result.details.raw`, and
 * the server's REAL tool name lives in `details.mcp_tool_name` (the exposed
 * AgentTool name may be hash-truncated).
 */
function brainAskCitations(record: Record<string, unknown>): DataCitation[] {
  const result = record.result as Record<string, unknown> | undefined;
  const details = result?.details as Record<string, unknown> | undefined;
  const mcpTool =
    typeof details?.mcp_tool_name === "string" ? details.mcp_tool_name : "";
  if (!/brain_ask/i.test(mcpTool)) return [];
  const raw = details?.raw as Record<string, unknown> | undefined;
  const structured = raw?.structuredContent as
    Record<string, unknown> | undefined;
  const rows = structured?.dataCitations;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseDataCitation)
    .filter((citation): citation is DataCitation => citation !== null);
}

/**
 * Extract the data citations of one turn's tool invocations, deduped:
 * brain_ask_result re-reports the citations of the brain_ask submission it
 * resolves, so identical (kind, query, tables, rowCount) rows collapse to
 * the first occurrence.
 */
export function dataCitationsFromInvocations(
  invocations: unknown[],
): DataCitationRow[] {
  const rows: DataCitationRow[] = [];
  const seen = new Set<string>();
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    for (const citation of brainAskCitations(
      value as Record<string, unknown>,
    )) {
      const identity = JSON.stringify([
        citation.kind,
        citation.query ?? null,
        citation.tables ?? null,
        citation.rowCount,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push({ ...citation, n: rows.length + 1 });
    }
  }
  return rows;
}

function rowLabel(citation: DataCitation): string {
  if (citation.tables && citation.tables.length > 0) {
    return citation.tables.join(", ");
  }
  if (citation.database) return citation.database;
  return citation.kind === "graph" ? "graph query" : "analytics query";
}

export function DataSourcesCard({
  citations,
  onOpen,
  className,
}: {
  citations: DataCitationRow[];
  /** Open one citation's detail (docked panel). */
  onOpen: (citation: DataCitationRow) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        Used {citations.length} data{" "}
        {citations.length === 1 ? "source" : "sources"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", {
            "rotate-180": open,
          })}
        />
      </button>
      {open ? (
        <ul className="mt-1.5 grid gap-1">
          {citations.map((citation) => {
            const Icon = citation.kind === "graph" ? Waypoints : Database;
            return (
              <li key={citation.n} className="min-w-0">
                <button
                  type="button"
                  className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-primary hover:underline"
                  title={citation.query}
                  onClick={() => onOpen(citation)}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="shrink-0 rounded border border-border/70 px-1 font-mono text-[10px] uppercase text-muted-foreground">
                    {citation.kind === "graph" ? "graph" : "SQL"}
                  </span>
                  <span className="truncate">{rowLabel(citation)}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {citation.rowCount}{" "}
                    {citation.rowCount === 1 ? "row" : "rows"} ·{" "}
                    {Math.round(citation.elapsedMs)}ms
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
