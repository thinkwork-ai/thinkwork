/**
 * Analyst query gate + execution pipeline (THINK-228 U3, KTD8).
 *
 * Per-call pipeline on the reused analyst_reader connection:
 *
 *   1. `DISCARD ALL` — resets session GUCs + deallocates prepared
 *      statements from the previous invocation (KTD7: role-level GUCs are
 *      user-overridable within a session, so a `SET statement_timeout`
 *      from one delegation must not persist into the next).
 *   2. EXPLAIN (FORMAT JSON) via pg-cursor, which always issues an
 *      extended-protocol Parse. node-postgres only takes the extended
 *      query protocol when a query requires preparation; parameterless
 *      model SQL via plain `client.query(text)` falls back to the simple
 *      protocol, which happily executes stacked statements — silently
 *      voiding the single-statement guarantee exactly when it matters.
 *      Parse rejects multi-command text server-side with "cannot insert
 *      multiple commands into a prepared statement" (named and unnamed
 *      statements alike; the cursor's unnamed statement avoids
 *      node-postgres's client-side named-statement cache, which errors on
 *      name reuse before ever reaching the server). Planner errors
 *      (unknown table/column, syntax) return verbatim for in-turn
 *      self-repair (R6).
 *   3. Execute the SAME sql text via pg-cursor — extended-protocol again,
 *      so the multi-statement guarantee holds at execution too — streaming
 *      rows under the broker row/byte caps.
 *
 * The write barrier is the analyst_reader role (SELECT-only grants +
 * read-only default transaction mode); this gate is accuracy tooling and
 * wire-level single-statement enforcement, not the security layer.
 */

import type { Client as PgClientType, FieldDef } from "pg";
import Cursor from "pg-cursor";

import {
  columnsFromFields,
  serializeCell,
  type AnalystCell,
  type AnalystColumnDescriptor,
} from "./analyst-envelope.js";

/** Max rows fetched from the DB per query (broker cap, not the inline cap). */
export const DEFAULT_MAX_FETCH_ROWS = 10_000;
/** Max accumulated cell bytes fetched per query. */
export const DEFAULT_MAX_FETCH_BYTES = 5 * 1024 * 1024;

const CURSOR_BATCH_SIZE = 500;

/** A rejected query. `detail` is the verbatim server error (R6). */
export class AnalystQueryRejection extends Error {
  constructor(
    readonly stage: "explain" | "execute",
    message: string,
    readonly code?: string,
    readonly position?: string,
  ) {
    super(message);
    this.name = "AnalystQueryRejection";
  }
}

function rejectionFrom(
  stage: "explain" | "execute",
  err: unknown,
): AnalystQueryRejection {
  if (err instanceof Error) {
    const pgErr = err as Error & { code?: string; position?: string };
    return new AnalystQueryRejection(
      stage,
      err.message,
      pgErr.code,
      pgErr.position,
    );
  }
  return new AnalystQueryRejection(stage, String(err));
}

export interface GatedQueryResult {
  columns: AnalystColumnDescriptor[];
  rows: AnalystCell[][];
  /** True when the fetch stopped at a cap with rows remaining unread. */
  fetchExhausted: boolean;
  explainPlan: unknown;
  durationMs: number;
}

function approximateRowBytes(row: AnalystCell[]): number {
  let bytes = 0;
  for (const cell of row) {
    if (cell === null) continue;
    bytes += typeof cell === "string" ? cell.length : 8;
  }
  return bytes;
}

/**
 * Run the full gate + execute pipeline for one model-authored statement.
 * Throws AnalystQueryRejection with the verbatim server error on any
 * failure so the model can self-correct in-turn.
 */
export async function gateAndExecute(
  client: PgClientType,
  sql: string,
  options?: { maxRows?: number; maxBytes?: number },
): Promise<GatedQueryResult> {
  const maxRows = options?.maxRows ?? DEFAULT_MAX_FETCH_ROWS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_FETCH_BYTES;
  const startedAt = Date.now();

  // 1. Session reset — KTD7. Broker-authored constant, simple protocol ok.
  await client.query("DISCARD ALL");

  // 2. EXPLAIN gate — cursor forces the extended protocol (unnamed Parse).
  let explainPlan: unknown;
  const explainCursor = client.query(
    new Cursor(`EXPLAIN (FORMAT JSON) ${sql}`),
  );
  try {
    const explainRows = await explainCursor.read(10);
    explainPlan =
      (explainRows[0] as Record<string, unknown> | undefined)?.["QUERY PLAN"] ??
      null;
  } catch (err) {
    throw rejectionFrom("explain", err);
  } finally {
    await new Promise<void>((resolve) => {
      explainCursor.close(() => resolve());
    });
  }

  // 3. Execute the same sql text via cursor (extended protocol) under caps.
  const cursor = client.query(new Cursor(sql));
  const rows: AnalystCell[][] = [];
  let fields: readonly FieldDef[] = [];
  let bytes = 0;
  let fetchExhausted = false;
  try {
    for (;;) {
      const batch = await cursor.read(CURSOR_BATCH_SIZE);
      // pg-cursor exposes result metadata after the first read.
      const cursorResult = (
        cursor as unknown as { _result?: { fields?: readonly FieldDef[] } }
      )._result;
      if (cursorResult?.fields?.length) fields = cursorResult.fields;
      if (batch.length === 0) break;
      for (const raw of batch) {
        const row = fields.map((f) =>
          serializeCell((raw as Record<string, unknown>)[f.name]),
        );
        rows.push(row);
        bytes += approximateRowBytes(row);
        if (rows.length >= maxRows || bytes >= maxBytes) {
          fetchExhausted = true;
          break;
        }
      }
      if (fetchExhausted) break;
    }
  } catch (err) {
    throw rejectionFrom("execute", err);
  } finally {
    await new Promise<void>((resolve) => {
      cursor.close(() => resolve());
    });
  }

  return {
    columns: columnsFromFields(fields),
    rows,
    fetchExhausted,
    explainPlan,
    durationMs: Date.now() - startedAt,
  };
}
