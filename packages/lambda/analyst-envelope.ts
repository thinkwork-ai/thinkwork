/**
 * Analyst query envelope (THINK-228 U3, KTD2).
 *
 * One envelope serves three consumers:
 *   (a) the model reads it as the stub — schema + capped preview +
 *       per-column stats (R7);
 *   (b) GenUI widgets bind to `columns`/`rows` (R12/R13);
 *   (c) when the result exceeds the inline cap the broker stages the full
 *       CSV to S3 and `result_file` carries the object key (the container
 *       lands it into the sandbox — U6).
 *
 * All keys are ALWAYS present (`result_file` is null when not staged) —
 * consumers never branch on key existence.
 *
 * KTD2: bindings must hash the value-invariant `columns` descriptor
 * (`{name, pg_type}` only), never the raw envelope — nullable-key churn
 * (result_file null→string, a stats min null→number) must not change the
 * bound shape. `columnsDescriptor` is that purpose-built extraction.
 */

import type { FieldDef } from "pg";

/** Rows included inline in the envelope (model preview + GenUI binding). */
export const INLINE_ROW_CAP = 200;

export interface AnalystColumnDescriptor {
  name: string;
  pg_type: string;
}

export interface AnalystColumnStats {
  nulls: number;
  min: number | string | null;
  max: number | string | null;
}

export type AnalystCell = string | number | boolean | null;

export interface AnalystEnvelope {
  columns: AnalystColumnDescriptor[];
  rows: AnalystCell[][];
  row_count: number;
  truncated: boolean;
  stats: Record<string, AnalystColumnStats>;
  result_file: string | null;
  /**
   * THINK-229 U4 (R13): remaining tenant-day query budget, surfaced
   * per-call so the model self-paces. Present only when the signed
   * caller context carried a day cap. `remaining` decrements for every
   * attempt including rejected ones (matching the in-loop cap
   * semantics); the live counter is broker/ledger-owned — never a
   * workspace file.
   */
  budget?: { remaining: number; limit: number };
}

/**
 * Postgres type OID → type name for the common built-ins. Unknown OIDs
 * render as `oid:<n>` — still deterministic, so the bound descriptor stays
 * stable for exotic types.
 */
const PG_TYPE_NAMES: Record<number, string> = {
  16: "bool",
  17: "bytea",
  18: "char",
  19: "name",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  26: "oid",
  114: "json",
  700: "float4",
  701: "float8",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  1266: "timetz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
  1000: "bool[]",
  1007: "int4[]",
  1009: "text[]",
  1015: "varchar[]",
  1016: "int8[]",
  2951: "uuid[]",
  3807: "jsonb[]",
};

export function pgTypeName(dataTypeID: number): string {
  return PG_TYPE_NAMES[dataTypeID] ?? `oid:${dataTypeID}`;
}

export function columnsFromFields(
  fields: readonly FieldDef[],
): AnalystColumnDescriptor[] {
  return fields.map((f) => ({
    name: f.name,
    pg_type: pgTypeName(f.dataTypeID),
  }));
}

/**
 * The value-invariant bound descriptor (KTD2): exactly the `columns` array.
 * Exported under its own name so binding-side code (packages/api, U7) and
 * broker tests share one definition of "the shape that matters".
 */
export function columnsDescriptor(
  envelope: Pick<AnalystEnvelope, "columns">,
): AnalystColumnDescriptor[] {
  return envelope.columns.map(({ name, pg_type }) => ({ name, pg_type }));
}

/** JSON-safe cell serialization. Deterministic for a given value. */
export function serializeCell(value: unknown): AnalystCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  // json/jsonb objects, arrays — stable stringification.
  return JSON.stringify(value);
}

function comparable(cell: AnalystCell): number | string | null {
  if (cell === null || typeof cell === "boolean") return null;
  return cell;
}

/** Per-column stats over ALL fetched rows (not just the inline preview). */
export function computeStats(
  columns: AnalystColumnDescriptor[],
  rows: AnalystCell[][],
): Record<string, AnalystColumnStats> {
  const stats: Record<string, AnalystColumnStats> = {};
  columns.forEach((column, index) => {
    let nulls = 0;
    let min: number | string | null = null;
    let max: number | string | null = null;
    for (const row of rows) {
      const value = comparable(row[index] ?? null);
      if (row[index] === null) {
        nulls += 1;
        continue;
      }
      if (value === null) continue; // booleans — counted, not ordered
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
    stats[column.name] = { nulls, min, max };
  });
  return stats;
}

/** RFC 4180 CSV of the full fetched result (header = column names). */
export function toCsv(
  columns: AnalystColumnDescriptor[],
  rows: AnalystCell[][],
): string {
  const escape = (cell: AnalystCell): string => {
    if (cell === null) return "";
    const text = typeof cell === "string" ? cell : String(cell);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => escape(c.name)).join(",")];
  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function buildEnvelope(input: {
  columns: AnalystColumnDescriptor[];
  rows: AnalystCell[][];
  /** True when the fetch stopped at a broker cap with rows remaining. */
  fetchExhausted: boolean;
  resultFile: string | null;
  /** THINK-229 U4: tenant-day budget view, when a cap is in force. */
  budget?: { remaining: number; limit: number };
}): AnalystEnvelope {
  const { columns, rows, fetchExhausted, resultFile } = input;
  return {
    columns,
    rows: rows.slice(0, INLINE_ROW_CAP),
    row_count: rows.length,
    truncated: rows.length > INLINE_ROW_CAP || fetchExhausted,
    stats: computeStats(columns, rows),
    result_file: resultFile,
    ...(input.budget ? { budget: input.budget } : {}),
  };
}
