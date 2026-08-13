/**
 * Data citations: the analytics/graph queries a brain_ask call executed to
 * produce its answer, as reported by the ThinkWork Brain MCP server under
 * `structuredContent.dataCitations`.
 *
 * Clicking one opens the docked artifact panel (same flow as cited knowledge
 * documents, THINK-168). The panel store only holds a string "artifact id"
 * and a citation has no backing artifact row or URL, so the whole citation
 * rides through the store as a `data-cite:` id carrying urlencoded JSON —
 * the panel re-parses it with the same shape gate applied at encode time.
 */

export interface DataCitation {
  kind: "analytics" | "graph";
  /** Executed SQL/cypher. Absent when the server's redaction gate held it back. */
  query?: string;
  /** Analytics logical database, e.g. "mart_analytics". */
  database?: string;
  tables?: string[];
  rowCount: number;
  truncated?: boolean;
  /** Athena query execution id. */
  queryExecutionId?: string;
  packSequence?: number;
  elapsedMs: number;
}

export const DATA_CITE_PANEL_ID_PREFIX = "data-cite:";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Shape gate for one dataCitations entry. `kind`, `rowCount` and `elapsedMs`
 * are the server contract's required fields — rows missing them are dropped
 * rather than rendered with invented values. Optional fields are kept only
 * when they have the contract's type.
 */
export function parseDataCitation(value: unknown): DataCitation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "analytics" && record.kind !== "graph") return null;
  const rowCount = finiteNumber(record.rowCount);
  const elapsedMs = finiteNumber(record.elapsedMs);
  if (rowCount === null || elapsedMs === null) return null;
  const citation: DataCitation = { kind: record.kind, rowCount, elapsedMs };
  if (typeof record.query === "string" && record.query) {
    citation.query = record.query;
  }
  if (typeof record.database === "string" && record.database) {
    citation.database = record.database;
  }
  if (Array.isArray(record.tables)) {
    const tables = record.tables.filter(
      (table): table is string => typeof table === "string" && table !== "",
    );
    if (tables.length > 0) citation.tables = tables;
  }
  if (record.truncated === true) citation.truncated = true;
  if (typeof record.queryExecutionId === "string" && record.queryExecutionId) {
    citation.queryExecutionId = record.queryExecutionId;
  }
  const packSequence = finiteNumber(record.packSequence);
  if (packSequence !== null) citation.packSequence = packSequence;
  return citation;
}

/** Panel-store id for a data citation. Explicit field copy keeps the id
 * canonical — callers may pass rows carrying extra display fields. */
export function dataCitePanelId(citation: DataCitation): string {
  const target = parseDataCitation(citation) ?? {
    kind: citation.kind,
    rowCount: citation.rowCount,
    elapsedMs: citation.elapsedMs,
  };
  return `${DATA_CITE_PANEL_ID_PREFIX}${encodeURIComponent(JSON.stringify(target))}`;
}

export function parseDataCitePanelId(id: string): DataCitation | null {
  if (!id.startsWith(DATA_CITE_PANEL_ID_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decodeURIComponent(id.slice(DATA_CITE_PANEL_ID_PREFIX.length)),
    );
  } catch {
    return null;
  }
  return parseDataCitation(parsed);
}

/** Panel header title for a citation: the most specific name available. */
export function dataCitationTitle(citation: DataCitation): string {
  if (citation.tables && citation.tables.length > 0) {
    return citation.tables.join(", ");
  }
  if (citation.database) return citation.database;
  return citation.kind === "graph" ? "Graph query" : "Analytics query";
}
