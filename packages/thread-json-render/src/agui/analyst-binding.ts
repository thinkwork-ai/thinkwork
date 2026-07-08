/**
 * Analyst run_query binding helpers (THINK-228 U7, KTD2).
 *
 * The generic `resultShapeHash` is TYPE-SENSITIVE by design: it encodes
 * `null` as a distinct token, so nullable-but-present keys flip the hash on
 * ordinary data churn (`result_file` null→string when a result crosses the
 * staging cap, a `stats.min` null→number, a nullable column's preview
 * gaining/losing a null variant). Binding a run_query widget on that hash
 * would trip SCHEMA_STALE on value churn and permanently break refresh
 * (the AE3 demo).
 *
 * run_query bindings therefore hash a purpose-built VALUE-INVARIANT
 * descriptor: the envelope's `columns` array of `{name, pg_type}` only. It
 * changes exactly when the result's column set changes — a genuine schema
 * change — and never on data volume, nullability, or staging churn.
 *
 * This module also owns the envelope → chart/table props projection the
 * renderer uses to merge refreshed `boundData` into a bound element
 * (the render half of AE3).
 */

import { createThreadJsonRenderSpecHash } from "../hash.js";

export const ANALYST_QUERY_TOOL_NAME = "run_query";

export interface AnalystEnvelopeColumn {
  name: string;
  pg_type: string;
}

export interface AnalystBindingEnvelope {
  columns: AnalystEnvelopeColumn[];
  rows: Array<Array<string | number | boolean | null>>;
  row_count: number;
  truncated: boolean;
  result_file: string | null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse a run_query envelope out of a raw MCP JSON-RPC tool result
 * (`{content: [{type: "text", text: <envelope JSON>}], ...}`) or out of an
 * already-parsed envelope object. Returns null for anything else.
 */
export function analystEnvelopeFromRaw(
  raw: unknown,
): AnalystBindingEnvelope | null {
  let candidate = recordValue(raw);
  if (!candidate) return null;

  if (!Array.isArray(candidate.columns) && Array.isArray(candidate.content)) {
    const textBlock = (candidate.content as Array<unknown>)
      .map(recordValue)
      .find(
        (block) => block?.type === "text" && typeof block.text === "string",
      );
    if (!textBlock) return null;
    try {
      candidate = recordValue(JSON.parse(textBlock.text as string));
    } catch {
      return null;
    }
    if (!candidate) return null;
  }

  if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)) {
    return null;
  }
  const columns: AnalystEnvelopeColumn[] = [];
  for (const entry of candidate.columns) {
    const column = recordValue(entry);
    if (
      !column ||
      typeof column.name !== "string" ||
      typeof column.pg_type !== "string"
    ) {
      return null;
    }
    columns.push({ name: column.name, pg_type: column.pg_type });
  }
  return {
    columns,
    rows: candidate.rows as AnalystBindingEnvelope["rows"],
    row_count:
      typeof candidate.row_count === "number" ? candidate.row_count : 0,
    truncated: candidate.truncated === true,
    result_file:
      typeof candidate.result_file === "string" ? candidate.result_file : null,
  };
}

function fnv1a(serialized: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Hash of the value-invariant `{name, pg_type}` columns descriptor. */
export function analystColumnsShapeHash(
  columns: readonly AnalystEnvelopeColumn[],
): string {
  const serialized = JSON.stringify(
    columns.map(({ name, pg_type }) => ({ name, pg_type })),
  );
  return `analyst-cols-fnv1a:${fnv1a(serialized)}`;
}

/**
 * Tool-aware binding shape hash. run_query results hash the columns
 * descriptor; everything else keeps the generic structural hash supplied by
 * the caller (kept injected so this module stays dependency-free).
 */
export function canvasShapeHashForToolResult(input: {
  toolName: string;
  raw: unknown;
  genericHash: (value: unknown) => string;
}): string {
  if (input.toolName === ANALYST_QUERY_TOOL_NAME) {
    const envelope = analystEnvelopeFromRaw(input.raw);
    if (envelope) return analystColumnsShapeHash(envelope.columns);
  }
  return input.genericHash(input.raw);
}

/** GenUI component row cap (mirrors the chart/table catalog schemas). */
const COMPONENT_ROW_CAP = 50;

/** Project the envelope into flat row records keyed by column name. */
export function projectAnalystEnvelopeRows(
  envelope: AnalystBindingEnvelope,
): Array<Record<string, string | number | boolean | null>> {
  return envelope.rows
    .slice(0, COMPONENT_ROW_CAP)
    .map((row) =>
      Object.fromEntries(
        envelope.columns.map((column, index) => [
          column.name,
          row[index] ?? null,
        ]),
      ),
    );
}

interface SpecElement {
  type?: unknown;
  props?: unknown;
  [key: string]: unknown;
}

/**
 * Merge refreshed bound data into a persisted json-render part's data (the
 * AE3 render half). `boundData` is the additive map the headless refresh
 * writes (`canvas-refresh`): elementId → {payload}. v1 binds one primary
 * source per part under elementId "", so the projected rows are applied to
 * every chart/table element in the spec (their xKey/series/columns reference
 * column NAMES, which are guaranteed unchanged — a column-set change would
 * have escalated SCHEMA_STALE instead of refreshing).
 *
 * Returns the original object untouched when there is nothing applicable —
 * renderers can call this unconditionally.
 */
export function applyCanvasBoundData(
  data: unknown,
  boundData: unknown,
): unknown {
  const dataRecord = recordValue(data);
  const boundRecord = recordValue(boundData);
  if (!dataRecord || !boundRecord) return data;
  const primary = recordValue(boundRecord[""]);
  const payload = primary?.payload;
  if (payload === undefined) return data;
  const envelope = analystEnvelopeFromRaw(payload);
  if (!envelope) return data;

  const spec = recordValue(dataRecord.spec);
  const elements = recordValue(spec?.elements);
  if (!spec || !elements) return data;

  const projected = projectAnalystEnvelopeRows(envelope);
  let changed = false;
  const nextElements: Record<string, unknown> = { ...elements };
  for (const [elementId, rawElement] of Object.entries(elements)) {
    const element = recordValue(rawElement) as SpecElement | null;
    if (!element) continue;
    const props = recordValue(element.props);
    if (!props) continue;
    if (element.type === "chart" && Array.isArray(props.data)) {
      nextElements[elementId] = {
        ...element,
        props: { ...props, data: projected },
      };
      changed = true;
    } else if (element.type === "table" && Array.isArray(props.rows)) {
      nextElements[elementId] = {
        ...element,
        props: { ...props, rows: projected },
      };
      changed = true;
    }
  }
  if (!changed) return data;
  const nextSpec = { ...spec, elements: nextElements };
  return {
    ...dataRecord,
    spec: nextSpec,
    // The part's stamped specHash covers the canonical spec — recompute it
    // for the merged spec or the renderer's validator rejects the part and
    // falls back (observed in the AE3 DOM test).
    ...(typeof dataRecord.specHash === "string"
      ? { specHash: createThreadJsonRenderSpecHash(nextSpec) }
      : {}),
  };
}
