/**
 * Analyst connection probe (THINK-229 U5 — R7/R8, KTD8).
 *
 * A scheduled reconciler (analyst-connection-reconciler.ts) runs this probe
 * against the `analyst_reader` Aurora connection and stamps its verdict onto
 * every tenant's analyst connector row under
 * `tenant_mcp_servers.runtime_metadata.analyst_probe`. Dispatch
 * (mcp-configs.ts) then withholds the connection loudly on a failing or
 * stale verdict — a new capability drop reason in the inspector and a
 * model-visible detail — so the model reports an outage instead of
 * fabricating results.
 *
 * The probe connects EXACTLY as the broker does (RDS IAM token, verified
 * TLS) by reusing `getAnalystReaderClient` from
 * `@thinkwork/lambda/analyst-reader-db` — the broker's own connect module —
 * rather than duplicating the credential chain here. Every check is
 * strictly read-only: `has_table_privilege`, `information_schema`
 * introspection, and an `information_schema.columns` descriptor hash.
 * There is NEVER a live INSERT/write probe (sequences advance, triggers
 * fire, KTD8).
 */

import { createHash } from "node:crypto";

import { listAnalystTables } from "@thinkwork/database-pg/analyst";

/** The broker route pathname — how an analyst connector row is identified. */
export const ANALYST_BROKER_PATHNAME = "/mcp/analyst";

/** A verdict older than this is treated as reconciler-death and withheld. */
export const PROBE_STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Postgres role the broker connects as; the GRANT surface is scoped to it. */
function analystReaderRole(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANALYST_DB_USER?.trim() || "analyst_reader";
}

export type ConnectionProbeStatus = "ok" | "fail";

/**
 * Failure reason vocabulary — short slugs; `detail` carries the
 * human-readable string surfaced identically in the inspector and the
 * model-visible context.
 */
export type ConnectionProbeReason =
  | "unreachable"
  | "select_revoked"
  | "write_privilege"
  | "schema_drift"
  | "probe_error";

export interface ConnectionProbeVerdict {
  status: ConnectionProbeStatus;
  reason?: ConnectionProbeReason;
  detail?: string;
  /** ISO 8601 timestamp of when the probe ran. */
  checkedAt: string;
}

/** Minimal `pg.Client`-shaped surface the probe needs (mockable in tests). */
export interface ProbePgClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A granted table + its granted columns, for the privilege + drift checks. */
export interface AnalystTableDescriptor {
  name: string;
  columns: { name: string; type: string }[];
}

export interface ConnectionProbeDeps {
  /** Connect exactly as the broker does. Default: getAnalystReaderClient. */
  getClient?: () => Promise<ProbePgClient>;
  /** Granted manifest. Default: derived from the committed semantic model. */
  grantedTables?: AnalystTableDescriptor[];
  /** Injectable clock for staleness/timestamp determinism in tests. */
  now?: () => Date;
  /** Role name override (default env ANALYST_DB_USER or analyst_reader). */
  role?: string;
}

/**
 * The granted manifest derived from the committed semantic model — the same
 * source of truth `generateAnalystSchemaMarkdown` and the GRANT generator
 * walk, so probe and grants cannot drift. Denied columns are already
 * filtered out of `AnalystTable.columns`, so this is exactly the granted
 * (table, column) surface.
 */
export function grantedTablesFromModel(): AnalystTableDescriptor[] {
  return listAnalystTables().map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({ name: c.name, type: c.pgType })),
  }));
}

/**
 * Normalize a Postgres type spelling so a benign representational
 * difference (Drizzle `getSQLType()` vs `information_schema.data_type`)
 * doesn't read as drift, while a genuine type change (text → integer) still
 * does. Deliberately conservative: only collapses whitespace/length
 * modifiers and maps a small set of known equivalent spellings.
 */
export function normalizePgType(raw: string): string {
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\(\s*\d+(\s*,\s*\d+)?\s*\)/g, "") // strip length/precision
    .replace(/^character varying$/, "varchar")
    .replace(/^character$/, "char")
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^time with time zone$/, "timetz")
    .replace(/\[\]$/, " array")
    .replace(/^array$/, " array")
    .trim();
}

/**
 * Canonical descriptor hash over `{table, column, normalizedType}` for the
 * granted surface. Deterministic: sorted tables, sorted columns.
 */
function descriptorHash(perTable: Map<string, Map<string, string>>): string {
  const parts: string[] = [];
  for (const table of [...perTable.keys()].sort()) {
    const cols = perTable.get(table)!;
    for (const column of [...cols.keys()].sort()) {
      parts.push(`${table}\t${column}\t${cols.get(column)}`);
    }
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function expectedDescriptors(
  granted: AnalystTableDescriptor[],
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const table of granted) {
    const cols = new Map<string, string>();
    for (const column of table.columns) {
      cols.set(column.name, normalizePgType(column.type));
    }
    out.set(table.name, cols);
  }
  return out;
}

/**
 * Run the read-only health probe. Short-circuits on the first failing
 * check (connect → SELECT grant → zero write privilege → schema drift) so
 * the verdict names the most fundamental fault.
 */
export async function probeAnalystConnection(
  deps: ConnectionProbeDeps = {},
): Promise<ConnectionProbeVerdict> {
  const now = deps.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const role = deps.role ?? analystReaderRole();
  const granted = deps.grantedTables ?? grantedTablesFromModel();
  const getClient = deps.getClient ?? defaultGetClient;

  const fail = (
    reason: ConnectionProbeReason,
    detail: string,
  ): ConnectionProbeVerdict => ({ status: "fail", reason, detail, checkedAt });

  // 1. Reachability + auth: the broker's IAM-first/password-fallback chain
  //    IS the check. A connect failure is a withhold-worthy outage.
  let client: ProbePgClient;
  try {
    client = await getClient();
  } catch (err) {
    return fail(
      "unreachable",
      `analyst connection unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    // 2. SELECT grant across the granted (table, column) manifest. A revoked
    //    grant is a withhold (the model would otherwise get a runtime
    //    permission error mid-query and may improvise around it). The check
    //    is per-COLUMN, not per-table: the grant migration (0227) issues
    //    column-level GRANT SELECT (col, ...) on tables with denied columns,
    //    and has_table_privilege(..., 'SELECT') is false for column-only
    //    grants — a table-level check reads every column-granted table as
    //    revoked (routines, observed on dev 2026-07-09). has_column_privilege
    //    subsumes both grant shapes. Tables ABSENT from the live DB are
    //    skipped, mirroring the migration's own to_regclass tolerance (dev
    //    drifts from the Drizzle schema — crm_work_links, 2026-07-08); a
    //    granted column missing from an existing table falls through to the
    //    schema-drift check below rather than reading as a revocation. The
    //    pg_attribute join resolves (attrelid, attnum) so the privilege call
    //    can never throw on a nonexistent relation or column.
    const tableNames = granted.map((t) => t.name);
    const pairTables: string[] = [];
    const pairColumns: string[] = [];
    for (const table of granted) {
      for (const column of table.columns) {
        pairTables.push(table.name);
        pairColumns.push(column.name);
      }
    }
    if (pairTables.length > 0) {
      const privResult = await client.query(
        `SELECT u.t AS tbl, u.c AS col,
                to_regclass(format('public.%I', u.t)) IS NOT NULL AS table_exists,
                a.attnum IS NOT NULL AS column_exists,
                CASE WHEN a.attnum IS NOT NULL
                     THEN has_column_privilege($1, a.attrelid, a.attnum, 'SELECT')
                     ELSE NULL END AS can_select
         FROM unnest($2::text[], $3::text[]) AS u(t, c)
         LEFT JOIN pg_attribute a
           ON a.attrelid = to_regclass(format('public.%I', u.t))
          AND a.attname = u.c AND a.attnum > 0 AND NOT a.attisdropped`,
        [role, pairTables, pairColumns],
      );
      const revoked = privResult.rows.find(
        (r) =>
          r.table_exists === true &&
          r.column_exists === true &&
          r.can_select !== true,
      );
      if (revoked) {
        return fail(
          "select_revoked",
          `analyst_reader lost SELECT on granted column "${String(revoked.tbl)}.${String(revoked.col)}" — connection withheld until the grant is restored`,
        );
      }
    }

    // 3. Zero write-privilege assertion. ANY non-SELECT grant on the reader
    //    role is a grant-surface breach → withhold, not warn.
    const writeResult = await client.query(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = $1 AND privilege_type <> 'SELECT'`,
      [role],
    );
    if (writeResult.rows.length > 0) {
      const breach = writeResult.rows
        .slice(0, 5)
        .map((r) => `${String(r.table_name)}:${String(r.privilege_type)}`)
        .join(", ");
      return fail(
        "write_privilege",
        `analyst_reader holds unexpected write privileges (${breach}) — connection withheld (grant-surface breach)`,
      );
    }

    // 4. Schema drift: hash live column descriptors against the committed
    //    semantic model. A column type change on a granted table means the
    //    model's SQL assumptions are stale.
    const expected = expectedDescriptors(granted);
    const columnsResult = await client.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [tableNames],
    );
    const liveByTable = new Map<string, Map<string, string>>();
    for (const rawRow of columnsResult.rows) {
      const table = String(rawRow.table_name);
      const column = String(rawRow.column_name);
      const type = normalizePgType(String(rawRow.data_type));
      const cols = liveByTable.get(table) ?? new Map<string, string>();
      cols.set(column, type);
      liveByTable.set(table, cols);
    }
    // Restrict the live descriptor to the granted (table, column) surface —
    // column-denied columns are ungranted and out of the drift contract.
    const liveGranted = new Map<string, Map<string, string>>();
    for (const [table, expectedCols] of expected) {
      // A table entirely ABSENT from the live DB is the tolerated
      // dev-drift class (same to_regclass semantics as the grant
      // migration and the privilege check above): never granted, never
      // queryable, not a drift withhold. Exclude it from BOTH sides of
      // the comparison. A missing/retyped COLUMN on an existing table
      // remains real drift.
      const liveCols = liveByTable.get(table);
      if (liveCols === undefined) {
        expected.delete(table);
        continue;
      }
      const restricted = new Map<string, string>();
      for (const column of expectedCols.keys()) {
        const liveType = liveCols.get(column);
        if (liveType !== undefined) restricted.set(column, liveType);
      }
      liveGranted.set(table, restricted);
    }

    if (descriptorHash(expected) !== descriptorHash(liveGranted)) {
      const detail = firstDriftDetail(expected, liveGranted);
      return fail("schema_drift", detail);
    }

    return { status: "ok", checkedAt };
  } catch (err) {
    return fail(
      "probe_error",
      `analyst connection probe errored: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Produce a human-readable detail naming the first drifted column. */
function firstDriftDetail(
  expected: Map<string, Map<string, string>>,
  live: Map<string, Map<string, string>>,
): string {
  for (const table of [...expected.keys()].sort()) {
    const expectedCols = expected.get(table)!;
    const liveCols = live.get(table) ?? new Map<string, string>();
    for (const column of [...expectedCols.keys()].sort()) {
      const want = expectedCols.get(column)!;
      const got = liveCols.get(column);
      if (got === undefined) {
        return `analyst schema drift: granted column "${table}.${column}" is missing on the live database — connection withheld`;
      }
      if (got !== want) {
        return `analyst schema drift: "${table}.${column}" type changed (model expects ${want}, live is ${got}) — connection withheld`;
      }
    }
  }
  return "analyst schema drift: live column descriptors diverged from the committed semantic model — connection withheld";
}

/** Default connect: reuse the broker's own connect module (never duplicated). */
async function defaultGetClient(): Promise<ProbePgClient> {
  const { getAnalystReaderClient } =
    await import("@thinkwork/lambda/analyst-reader-db");
  return (await getAnalystReaderClient()) as unknown as ProbePgClient;
}

// ── Dispatch-side gate (R8 / KTD8) ──────────────────────────────────────────

/** True when a row's URL is exactly the analyst broker route. */
export function isAnalystBrokerUrl(url: string): boolean {
  try {
    return new URL(url).pathname === ANALYST_BROKER_PATHNAME;
  } catch {
    return false;
  }
}

/** Read a stamped verdict out of a row's `runtime_metadata`, if present. */
export function readAnalystProbeVerdict(
  runtimeMetadata: unknown,
): ConnectionProbeVerdict | null {
  if (!runtimeMetadata || typeof runtimeMetadata !== "object") return null;
  const raw = (runtimeMetadata as Record<string, unknown>).analyst_probe;
  if (!raw || typeof raw !== "object") return null;
  const verdict = raw as Record<string, unknown>;
  if (verdict.status !== "ok" && verdict.status !== "fail") return null;
  return {
    status: verdict.status,
    reason:
      typeof verdict.reason === "string"
        ? (verdict.reason as ConnectionProbeReason)
        : undefined,
    detail: typeof verdict.detail === "string" ? verdict.detail : undefined,
    checkedAt: typeof verdict.checkedAt === "string" ? verdict.checkedAt : "",
  };
}

export interface AnalystProbeGateResult {
  /** Human-readable string surfaced verbatim in the inspector + child context. */
  detail: string;
}

/**
 * Decide whether dispatch must withhold this row on the reconciler verdict.
 *
 * Fail-closed but narrow (KTD8):
 *  - No `analyst_probe` key → served (non-analyst rows AND the pre-first-probe
 *    window must keep working). Never withheld on absence.
 *  - Key present + status "fail" → withheld with the verdict's own detail.
 *  - Key present + verdict older than 24h → withheld ("stale", reconciler
 *    death must not silently keep serving).
 *  - Key present + fresh "ok" → served.
 *
 * The verdict key is only ever written to analyst rows, but the URL-pathname
 * check is an extra guard so a mislabeled verdict on a foreign row can never
 * withhold it.
 */
export function evaluateAnalystProbeGate(
  runtimeMetadata: unknown,
  url: string,
  now: number = Date.now(),
): AnalystProbeGateResult | null {
  const verdict = readAnalystProbeVerdict(runtimeMetadata);
  if (!verdict) return null;
  if (!isAnalystBrokerUrl(url)) return null;

  if (verdict.status === "fail") {
    return {
      detail:
        verdict.detail ??
        `analyst connection probe failed (${verdict.reason ?? "unknown"})`,
    };
  }

  const checkedAtMs = Date.parse(verdict.checkedAt);
  if (
    !Number.isFinite(checkedAtMs) ||
    now - checkedAtMs > PROBE_STALE_AFTER_MS
  ) {
    return {
      detail:
        "analyst connection probe verdict is stale — the reconciler has not re-verified the connection within 24h, so it is withheld until the next successful probe",
    };
  }

  return null;
}
