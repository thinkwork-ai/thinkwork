/**
 * Shared helper for mutations to `tenant_mcp_servers` that may affect
 * approval state (plan §U11, SI-5).
 *
 * Any admin-facing update that changes `url` or `auth_config` on an
 * approved row must revert the row to `status='pending'` and clear the
 * approval metadata (`url_hash`, `approved_by`, `approved_at`). Callers
 * can rely on this helper rather than re-implementing the check inline
 * — every MCP mutation path in the codebase routes through it, which
 * keeps the invariant debuggable from one place.
 *
 * Usage:
 *
 *   await applyMcpServerFieldUpdate(db, serverId, {
 *     name: body.name,
 *     url: body.url,
 *     auth_config: body.auth_config,
 *     enabled: body.enabled,
 *   });
 *
 * The helper:
 *   1. Loads the current row to capture pre-image url + auth_config +
 *      status.
 *   2. Detects whether url or auth_config is actually changing (deep
 *      equality on auth_config via canonicalized JSON).
 *   3. If changing on an approved row, merges revert-to-pending fields
 *      into the UPDATE.
 *   4. Applies the UPDATE atomically via a single statement.
 *
 * Not exported publicly as "silently updates approval state" — the name
 * is explicit so callers know this path is SI-5-aware.
 */

import { eq } from "drizzle-orm";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";

export interface McpServerFieldUpdate {
  name?: string;
  url?: string;
  transport?: string;
  auth_type?: string;
  auth_config?: Record<string, unknown> | null;
  oauth_provider?: string | null;
  enabled?: boolean;
  tools?: unknown;
}

export interface McpServerUpdateOptions {
  /**
   * Set true to bypass the SI-5 revert-to-pending logic. Intended for
   * system paths that mutate only non-human-intent fields (e.g. cached
   * DCR endpoint metadata the OAuth flow discovers). Callers must have
   * a documented reason to opt out — the default is safe.
   */
  skipApprovalRevert?: boolean;
}

export interface McpServerUpdateResult {
  /** True when this call reverted an approved row back to pending. */
  revertedToPending: boolean;
}

/**
 * Apply an update to a tenant_mcp_servers row and — if url or
 * auth_config is changing on an approved row — revert the approval.
 *
 * Returns `{ revertedToPending: true }` when the helper clears
 * approval state so callers can echo the revert to the UI or log it.
 *
 * The `db` parameter accepts both a module-level Drizzle db handle and
 * a transaction handle; typed as `any` here so this helper stays
 * callable from either context without wrestling Drizzle's generic
 * constraints. The narrow API surface (select + update) is stable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyMcpServerFieldUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  serverId: string,
  updates: McpServerFieldUpdate,
  options: McpServerUpdateOptions = {},
): Promise<McpServerUpdateResult> {
  const rows = await db
    .select()
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.id, serverId))
    .limit(1);
  const before = rows[0] as
    | { url: string; auth_config: unknown; status: string }
    | undefined;
  if (!before) {
    return { revertedToPending: false };
  }

  const urlChanged = updates.url !== undefined && updates.url !== before.url;
  const authChanged =
    updates.auth_config !== undefined &&
    !jsonEquals(updates.auth_config, before.auth_config);

  const shouldRevert =
    !options.skipApprovalRevert &&
    before.status === "approved" &&
    (urlChanged || authChanged);

  const set: Record<string, unknown> = {
    ...cleanUpdates(updates),
    updated_at: new Date(),
  };
  if (shouldRevert) {
    set.status = "pending";
    set.url_hash = null;
    set.approved_by = null;
    set.approved_at = null;
  }

  await db
    .update(tenantMcpServers)
    .set(set)
    .where(eq(tenantMcpServers.id, serverId));

  if (shouldRevert) {
    console.log(
      `[mcp-server-update] reverted approved→pending server=${serverId} urlChanged=${urlChanged} authChanged=${authChanged}`,
    );
  }

  return { revertedToPending: shouldRevert };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanUpdates(updates: McpServerFieldUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Deep-equality check for jsonb fields. Sort keys recursively before
 * comparing so `{a:1,b:2}` and `{b:2,a:1}` compare equal — mirrors the
 * canonicalization in computeMcpUrlHash.
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonical(v);
    return out;
  }
  return value;
}
