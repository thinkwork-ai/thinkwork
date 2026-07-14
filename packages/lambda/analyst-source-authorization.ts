/**
 * Action-time analyst source authorization (THINK-283 U7).
 *
 * A signed source claim proves what the source looked like WHEN THE CLAIM
 * WAS MINTED — it cannot see a refresh, drift withhold, disablement, or
 * generation change that happened afterwards. This module closes that hole:
 * before every sourced broker query — and before the warehouse credential is
 * resolved or the source connection opened — the broker re-reads the
 * tenant's CURRENT source row from the platform database and requires:
 *
 *   - the exact (tenant, slug) row to exist, approved and enabled;
 *   - no probe gate (failed or stale scheduled verdict withholds);
 *   - no refresh gate (running/failed/malformed `analyst_refresh` withholds);
 *   - generation equality: a row stamped with a `sourceGeneration` accepts
 *     ONLY claims carrying that exact generation. A legacy row with no
 *     generation accepts only legacy claims with none — the first successful
 *     refresh stamps a generation and permanently ends that fallback.
 *
 * The read rides the broker's existing platform `analyst_reader` connection
 * under the tenant_mcp_servers RLS policy (drizzle/0230_analyst_rls.sql):
 * the tenant GUC is set with `set_config(..., true)` inside an explicit
 * transaction, so the scope is transaction-local and cannot leak across
 * sequential invocations on a reused connection — including when the query
 * throws (the transaction is rolled back in that path).
 *
 * FAIL CLOSED: a missing row, tenant mismatch (RLS returns nothing),
 * malformed metadata, stale generation, or a platform control-database
 * outage all DENY. The broker never falls through to the source connection
 * on an authorization lookup error — control-state unavailability is a
 * surfaced broker outage, not a reason to serve stale state.
 *
 * Deliberately uncached (plan KTD): one tenant-scoped indexed read per
 * sourced query keeps refresh/revocation immediate for new calls.
 */

import { type AnalystSourceClaims } from "./analyst-caller-context.js";

/** Matches the probe's staleness window (packages/api connection-probe.ts). */
export const SOURCE_PROBE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Minimal pg.Client surface (mockable; default = platform reader client). */
export interface AuthzPgClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export type AnalystSourceAuthzReason =
  | "source_not_found"
  | "source_disabled"
  | "probe_gate"
  | "refresh_gate"
  | "generation_mismatch"
  | "malformed_metadata"
  | "authz_unavailable";

export type AnalystSourceAuthzResult =
  | { ok: true }
  | { ok: false; reason: AnalystSourceAuthzReason };

export interface AuthorizeAnalystSourceCallInput {
  /** Verified caller-context tenant (never the raw header). */
  tenantId: string;
  /** Path slug — already proven equal to claims.slug by the broker. */
  slug: string;
  /** The verified signed source claims. */
  claims: AnalystSourceClaims;
  /** Injectable for tests; default = the broker's platform reader client. */
  client?: AuthzPgClient;
  nowMs?: number;
}

/** Read `analyst_probe` and decide the gate (self-contained — packages/lambda
 * must not import packages/api, so the reader is duplicated minimally). */
function probeGateDenies(
  meta: Record<string, unknown>,
  nowMs: number,
): boolean {
  const raw = meta.analyst_probe;
  if (!raw || typeof raw !== "object") return false; // pre-first-probe window
  const verdict = raw as Record<string, unknown>;
  if (verdict.status === "fail") return true;
  if (verdict.status !== "ok") return true; // malformed → fail closed
  const checkedAt = Date.parse(String(verdict.checkedAt ?? ""));
  return (
    !Number.isFinite(checkedAt) ||
    nowMs - checkedAt > SOURCE_PROBE_STALE_AFTER_MS
  );
}

/** Read `analyst_refresh` and decide the gate (running/failed/malformed deny). */
function refreshGateDenies(meta: Record<string, unknown>): boolean {
  const raw = meta.analyst_refresh;
  if (!raw || typeof raw !== "object") return false; // never refreshed
  const state = raw as Record<string, unknown>;
  return state.status !== "ok";
}

/**
 * Authorize one sourced broker call against CURRENT tenant-scoped control
 * state. See module docs for the contract. Every deny carries a typed
 * reason for the broker's structured auth log; the HTTP response stays a
 * uniform 401.
 */
export async function authorizeAnalystSourceCall(
  input: AuthorizeAnalystSourceCallInput,
): Promise<AnalystSourceAuthzResult> {
  const nowMs = input.nowMs ?? Date.now();
  let client: AuthzPgClient;
  try {
    client = input.client ?? (await defaultAuthzClient());
  } catch {
    return { ok: false, reason: "authz_unavailable" };
  }

  let row: Record<string, unknown> | undefined;
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Transaction-local tenant scope (third arg TRUE): reverts at
    // COMMIT/ROLLBACK, so a reused connection can never leak it.
    await client.query(
      "SELECT set_config('thinkwork.analyst_tenant', $1, true)",
      [input.tenantId],
    );
    const result = await client.query(
      `SELECT tenant_id, slug, enabled, status, runtime_metadata
         FROM tenant_mcp_servers
        WHERE tenant_id = $1::uuid AND slug = $2
        LIMIT 1`,
      [input.tenantId, input.slug],
    );
    await client.query("COMMIT");
    inTransaction = false;
    row = result.rows[0];
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection-level failure — nothing more to clean up here
      }
    }
    console.error(
      "analyst-source-authorization: control-state read failed — denying",
      err,
    );
    return { ok: false, reason: "authz_unavailable" };
  }

  if (!row) return { ok: false, reason: "source_not_found" };
  if (row.status !== "approved" || row.enabled !== true) {
    return { ok: false, reason: "source_disabled" };
  }

  const meta =
    row.runtime_metadata && typeof row.runtime_metadata === "object"
      ? (row.runtime_metadata as Record<string, unknown>)
      : null;
  const source =
    meta &&
    meta.analyst_source &&
    typeof meta.analyst_source === "object" &&
    !Array.isArray(meta.analyst_source)
      ? (meta.analyst_source as Record<string, unknown>)
      : null;
  if (!meta || !source) {
    return { ok: false, reason: "malformed_metadata" };
  }

  if (probeGateDenies(meta, nowMs)) return { ok: false, reason: "probe_gate" };
  if (refreshGateDenies(meta)) return { ok: false, reason: "refresh_gate" };

  // Generation binding (THINK-283): exact equality once the row has one;
  // legacy-only fallback while BOTH row and claim are legacy-shaped.
  const rowGeneration =
    typeof source.sourceGeneration === "string" &&
    source.sourceGeneration.length > 0
      ? source.sourceGeneration
      : null;
  const claimGeneration = input.claims.sourceGeneration ?? null;
  if (rowGeneration !== null) {
    if (claimGeneration !== rowGeneration) {
      return { ok: false, reason: "generation_mismatch" };
    }
  } else if (claimGeneration !== null) {
    // A claim carrying a generation for a row that has none is inconsistent
    // control state — deny rather than guess.
    return { ok: false, reason: "generation_mismatch" };
  }

  return { ok: true };
}

async function defaultAuthzClient(): Promise<AuthzPgClient> {
  const { getAnalystReaderClient } = await import("./analyst-reader-db.js");
  return (await getAnalystReaderClient()) as unknown as AuthzPgClient;
}
